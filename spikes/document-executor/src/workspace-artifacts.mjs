import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const DEFAULT_BROWSER_ARTIFACT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../.browser-dist')
const BROWSER_ARTIFACT_PACKAGE_JSON = 'spikes/document-executor/package.json'

export const MATERIAL_MANIFEST_BINDING_VERSION = '1'

const ARTIFACTS = Object.freeze({
  runtime: {
    packageJson: 'packages/agent-runtime/package.json',
    directory: 'packages/agent-runtime/dist',
  },
  core: {
    packageJson: 'packages/core/package.json',
    directory: 'packages/core/dist',
  },
  renderer: {
    packageJson: 'packages/react-renderer-dashboard/package.json',
    directory: 'packages/react-renderer-dashboard/dist',
  },
  dashboardAgentHost: {
    packageJson: 'packages/dashboard-agent-host/package.json',
    directory: 'packages/dashboard-agent-host/dist',
  },
})

const canonicalJson = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`
}

const collectFiles = async (directory, accept = () => true) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(path, accept)))
    else if (entry.isFile() && accept(entry.name)) files.push(path)
  }
  return files.sort((left, right) => relative(directory, left).localeCompare(relative(directory, right), 'en'))
}

export const hashWorkspaceArtifactDirectory = async directory => {
  const absoluteDirectory = resolve(directory)
  const files = await collectFiles(absoluteDirectory, name => name.endsWith('.js') || name.endsWith('.cjs'))
  if (files.length === 0) throw new Error(`Workspace artifact directory is empty: ${absoluteDirectory}`)
  const hash = createHash('sha256')
  for (const filename of files) {
    const relativeFilename = relative(absoluteDirectory, filename).replaceAll('\\', '/')
    const contents = await readFile(filename)
    hash.update(`${Buffer.byteLength(relativeFilename, 'utf8')}:${relativeFilename}:`)
    hash.update(`${contents.byteLength}:`)
    hash.update(contents)
  }
  return hash.digest('hex')
}

export const createBrowserArtifactManifest = async directory => {
  const absoluteDirectory = resolve(directory)
  const files = await collectFiles(absoluteDirectory)
  if (files.length === 0) throw new Error(`Workspace artifact directory is empty: ${absoluteDirectory}`)
  const hash = createHash('sha256')
  const digests = {}
  for (const filename of files) {
    const relativeFilename = relative(absoluteDirectory, filename).replaceAll('\\', '/')
    const contents = await readFile(filename)
    digests[relativeFilename] = createHash('sha256').update(contents).digest('hex')
    hash.update(`${Buffer.byteLength(relativeFilename, 'utf8')}:${relativeFilename}:`)
    hash.update(`${contents.byteLength}:`)
    hash.update(contents)
  }
  return Object.freeze({
    directory: absoluteDirectory,
    sha256: hash.digest('hex'),
    files: Object.freeze(digests),
  })
}

export const hashMaterialManifestBinding = binding => {
  if (!binding || !Array.isArray(binding.writableManifests)) {
    throw new TypeError('material manifest binding must expose writableManifests')
  }
  return createHash('sha256')
    .update(
      canonicalJson({
        schemaVersion: Number(MATERIAL_MANIFEST_BINDING_VERSION),
        writableManifests: binding.writableManifests,
      }),
      'utf8',
    )
    .digest('hex')
}

const readVersion = async packageJsonPath => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error(`Workspace artifact package has no version: ${packageJsonPath}`)
  }
  return packageJson.version
}

const artifactIdentity = async (artifact, workspaceRoot) => {
  const packageJsonPath = resolve(workspaceRoot, artifact.packageJson)
  const directory = resolve(workspaceRoot, artifact.directory)
  return {
    version: await readVersion(packageJsonPath),
    sha256: await hashWorkspaceArtifactDirectory(directory),
  }
}

export const computeWorkspaceArtifactCompatibility = async (
  { materialManifestVersion, materialManifestSha256 },
  { workspaceRoot = WORKSPACE_ROOT, browserArtifactDirectory = DEFAULT_BROWSER_ARTIFACT_DIRECTORY } = {},
) => {
  const [runtime, core, renderer, dashboardAgentHost, browserArtifact, browserArtifactVersion] = await Promise.all([
    ...Object.values(ARTIFACTS).map(artifact => artifactIdentity(artifact, workspaceRoot)),
    createBrowserArtifactManifest(browserArtifactDirectory),
    readVersion(resolve(workspaceRoot, BROWSER_ARTIFACT_PACKAGE_JSON)),
  ])
  return {
    runtimeVersion: runtime.version,
    runtimeSha256: runtime.sha256,
    coreVersion: core.version,
    coreSha256: core.sha256,
    rendererVersion: renderer.version,
    rendererSha256: renderer.sha256,
    dashboardAgentHostVersion: dashboardAgentHost.version,
    dashboardAgentHostSha256: dashboardAgentHost.sha256,
    browserArtifactVersion,
    browserArtifactSha256: browserArtifact.sha256,
    materialManifestVersion: String(materialManifestVersion),
    materialManifestSha256,
  }
}
