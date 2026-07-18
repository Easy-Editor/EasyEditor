import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type OutputOptions, type Plugin, type RollupOptions, rollup } from 'rollup'
import { findConfigFile, loadConfig } from '../config'
import { resolveConfig } from '../config/defaults'
import type { EasypackConfig, Preset, ResolvedConfig } from '../config/types'
import { createRollupConfig } from '../rollup'

export interface BuildEasypackOptions {
  /** Existing workspace that contains package.json and all build inputs/outputs. */
  rootDir: string
  /** Trusted in-memory configuration. Mutually exclusive with configFile. */
  config?: EasypackConfig
  /** Trusted configuration file, resolved relative to rootDir and confined to it. */
  configFile?: string
}

export interface EasypackBuildArtifact {
  /** POSIX-style path relative to rootDir. */
  path: string
  type: 'asset' | 'chunk'
  bytes: number
  sha256: string
}

export interface EasypackBuildResult {
  package: {
    name: string
    version: string
  }
  preset: Preset
  artifacts: EasypackBuildArtifact[]
}

const isInside = (rootDir: string, candidate: string): boolean => {
  const relative = path.relative(rootDir, candidate)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

const resolveInside = (rootDir: string, candidate: string, label: string): string => {
  const resolved = path.resolve(rootDir, candidate)
  if (!isInside(rootDir, resolved)) {
    throw new Error(`${label} must stay inside the Easypack workspace: ${candidate}`)
  }
  let existingAncestor = resolved
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor)
    if (parent === existingAncestor) break
    existingAncestor = parent
  }
  if (!isInside(rootDir, fs.realpathSync(existingAncestor))) {
    throw new Error(`${label} must stay inside the Easypack workspace: ${candidate}`)
  }
  return resolved
}

const readPackageMetadata = (rootDir: string): { name: string; version: string } => {
  const packagePath = path.join(rootDir, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { name?: unknown; version?: unknown }
  return {
    name: typeof manifest.name === 'string' ? manifest.name : 'unknown',
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
  }
}

const resolveBuildConfig = async (options: BuildEasypackOptions, rootDir: string): Promise<ResolvedConfig> => {
  if (options.config && options.configFile) {
    throw new Error('buildEasypack accepts either config or configFile, not both')
  }
  if (options.config) {
    return resolveConfig(options.config, readPackageMetadata(rootDir))
  }
  const discoveredConfigFile = findConfigFile(rootDir, options.configFile)
  if (!discoveredConfigFile) return loadConfig(undefined, rootDir)
  const configFile = resolveInside(rootDir, discoveredConfigFile, 'Config file')
  return loadConfig(configFile, rootDir)
}

const validateConfigPaths = (rootDir: string, config: ResolvedConfig): void => {
  resolveInside(rootDir, config.output.dir, 'Output directory')
  for (const entry of Object.values(config.entry)) {
    resolveInside(rootDir, entry, 'Entry file')
  }
  for (const alias of Object.values(config.alias)) {
    resolveInside(rootDir, alias, 'Alias target')
  }
}

const resolveInput = (rootDir: string, input: RollupOptions['input']): RollupOptions['input'] => {
  if (typeof input === 'string') return resolveInside(rootDir, input, 'Rollup input')
  if (Array.isArray(input)) return input.map(item => resolveInside(rootDir, item, 'Rollup input'))
  if (input) {
    return Object.fromEntries(
      Object.entries(input).map(([name, item]) => [name, resolveInside(rootDir, item, 'Rollup input')]),
    )
  }
  return input
}

const resolveOutput = (rootDir: string, output: OutputOptions): OutputOptions => ({
  ...output,
  ...(output.file ? { file: resolveInside(rootDir, output.file, 'Rollup output') } : {}),
  ...(output.dir ? { dir: resolveInside(rootDir, output.dir, 'Rollup output') } : {}),
})

const stripQuery = (id: string): string => id.split('?', 1)[0]

const toLocalFilePath = (id: string): string | null => {
  const cleanId = stripQuery(id)
  if (!cleanId || cleanId.startsWith('\0')) return null
  if (cleanId.startsWith('file:')) return fileURLToPath(cleanId)
  return path.isAbsolute(cleanId) ? cleanId : null
}

const isPackageModulePath = (rootDir: string, filePath: string): boolean => {
  if (!isInside(rootDir, filePath)) return false
  return path.relative(rootDir, filePath).split(path.sep).includes('node_modules')
}

const validateResolvedModule = (rootDir: string, id: string): void => {
  const filePath = toLocalFilePath(id)
  if (!filePath || !fs.existsSync(filePath)) return
  if (!isInside(rootDir, filePath)) {
    throw new Error(`Resolved module must stay inside the Easypack workspace: ${id}`)
  }
  const realPath = fs.realpathSync(filePath)
  if (!isInside(rootDir, realPath) && !isPackageModulePath(rootDir, filePath)) {
    throw new Error(`Resolved module must stay inside the Easypack workspace: ${id}`)
  }
}

const validateImportSpecifier = (rootDir: string, source: string, importer?: string): void => {
  const cleanSource = stripQuery(source)
  const importerPath = importer ? toLocalFilePath(importer) : null
  let candidate: string | null = null
  if (cleanSource.startsWith('file:')) {
    candidate = fileURLToPath(cleanSource)
  } else if (path.isAbsolute(cleanSource)) {
    candidate = cleanSource
  } else if (cleanSource.startsWith('.') && importerPath) {
    candidate = path.resolve(path.dirname(importerPath), cleanSource)
  }
  if (candidate && !isInside(rootDir, candidate)) {
    throw new Error(`Module import must stay inside the Easypack workspace: ${source}`)
  }
}

const createWorkspaceConfinementPlugin = (rootDir: string): Plugin => ({
  name: 'easypack-workspace-confinement',
  resolveId: {
    order: 'pre',
    handler(source, importer) {
      validateImportSpecifier(rootDir, source, importer)
      return null
    },
  },
  resolveDynamicImport: {
    order: 'pre',
    handler(specifier, importer) {
      if (typeof specifier === 'string') validateImportSpecifier(rootDir, specifier, importer)
      return null
    },
  },
  load: {
    order: 'pre',
    handler(id) {
      validateResolvedModule(rootDir, id)
      return null
    },
  },
})

const materializeRollupConfig = (rootDir: string, config: RollupOptions): RollupOptions => ({
  ...config,
  preserveSymlinks: true,
  input: resolveInput(rootDir, config.input),
  plugins: [createWorkspaceConfinementPlugin(rootDir), config.plugins ?? []],
  output: Array.isArray(config.output)
    ? config.output.map(output => resolveOutput(rootDir, output))
    : config.output
      ? resolveOutput(rootDir, config.output)
      : config.output,
})

const getGeneratedPath = (rootDir: string, output: OutputOptions, fileName: string): string => {
  if (output.dir) return resolveInside(rootDir, path.join(output.dir, fileName), 'Generated artifact')
  if (output.file) {
    const generatedPath =
      fileName === path.basename(output.file) ? output.file : path.join(path.dirname(output.file), fileName)
    return resolveInside(rootDir, generatedPath, 'Generated artifact')
  }
  throw new Error('Easypack requires Rollup output.file or output.dir')
}

const toRelativePath = (rootDir: string, filePath: string): string =>
  path.relative(rootDir, filePath).split(path.sep).join('/')

const resolveWorkspaceBuild = async (
  options: BuildEasypackOptions,
): Promise<{ rootDir: string; config: ResolvedConfig }> => {
  const rootDir = fs.realpathSync(path.resolve(options.rootDir))
  resolveInside(rootDir, 'package.json', 'Package manifest')
  return {
    rootDir,
    config: await resolveBuildConfig(options, rootDir),
  }
}

/** Internal CLI seam; package consumers use buildEasypack. */
export async function loadEasypackWorkspaceConfig(options: BuildEasypackOptions): Promise<ResolvedConfig> {
  return (await resolveWorkspaceBuild(options)).config
}

/**
 * Runs Easypack without consulting argv, changing cwd, or terminating the process.
 * All Easypack-owned inputs and outputs are resolved from the explicit workspace.
 */
export async function buildEasypack(options: BuildEasypackOptions): Promise<EasypackBuildResult> {
  const { rootDir, config } = await resolveWorkspaceBuild(options)
  validateConfigPaths(rootDir, config)

  const generated = new Map<string, { path: string; type: 'asset' | 'chunk' }>()
  const rollupConfigs = createRollupConfig({
    config,
    cwd: rootDir,
    workspaceConfinement: true,
  }).map(rollupConfig => materializeRollupConfig(rootDir, rollupConfig))

  for (const rollupConfig of rollupConfigs) {
    const bundle = await rollup(rollupConfig)
    try {
      const outputs = Array.isArray(rollupConfig.output) ? rollupConfig.output : [rollupConfig.output]
      for (const output of outputs) {
        if (!output) continue
        const result = await bundle.write(output)
        for (const artifact of result.output) {
          const filePath = getGeneratedPath(rootDir, output, artifact.fileName)
          generated.set(toRelativePath(rootDir, filePath), { path: filePath, type: artifact.type })
        }
      }
    } finally {
      await bundle.close()
    }
  }

  const artifacts = [...generated.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([artifactPath, artifact]) => {
      const contents = fs.readFileSync(artifact.path)
      return {
        path: artifactPath,
        type: artifact.type,
        bytes: contents.byteLength,
        sha256: createHash('sha256').update(contents).digest('hex'),
      }
    })

  return {
    package: config.pkg,
    preset: config.preset,
    artifacts,
  }
}
