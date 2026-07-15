import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const templateRoot = join(packageRoot, 'template/dashboard/react')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const supportsEasypack = Number.parseInt(process.versions.node.split('.')[0], 10) >= 20
const runtimePackages = [
  ['@easy-editor/core', 'core'],
  ['@easy-editor/plugin-dashboard', 'plugin-dashboard'],
  ['@easy-editor/plugin-datasource', 'plugin-datasource'],
  ['@easy-editor/plugin-hotkey', 'plugin-hotkey'],
  ['@easy-editor/renderer-core', 'renderer-core'],
  ['@easy-editor/react-renderer', 'react-renderer'],
  ['@easy-editor/react-renderer-dashboard', 'react-renderer-dashboard'],
]
const toolPackages = [
  ['@easy-editor/create', 'create-easy-editor'],
  ...(supportsEasypack ? [['@easy-editor/easypack', 'easypack']] : []),
]

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options,
  })

const packPackage = async (packageDirectory, packDirectory) => {
  const before = new Set(await readdir(packDirectory))
  run(pnpm, ['--dir', join(repositoryRoot, 'packages', packageDirectory), 'pack', '--pack-destination', packDirectory])
  const created = (await readdir(packDirectory)).filter(name => name.endsWith('.tgz') && !before.has(name))
  assert.equal(created.length, 1, `Expected one tarball for ${packageDirectory}`)
  return join(packDirectory, created[0])
}

const readTarballFile = (tarball, path) => run('tar', ['-xOzf', tarball, `package/${path}`], { capture: true })

const collectRelativeDeclarationReferences = source => {
  const sourceFile = ts.createSourceFile('package.d.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const references = new Set(
    sourceFile.referencedFiles.map(reference => reference.fileName).filter(reference => reference.startsWith('.')),
  )
  const addStringLiteral = literal => {
    if (literal && ts.isStringLiteralLike(literal) && literal.text.startsWith('.')) references.add(literal.text)
  }
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) addStringLiteral(node.moduleSpecifier)
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addStringLiteral(node.moduleReference.expression)
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) addStringLiteral(node.argument.literal)
    if (ts.isModuleDeclaration(node)) addStringLiteral(node.name)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return references
}

const declarationReferenceCandidates = (declarationPath, reference) => {
  const resolved = posix.normalize(posix.join(posix.dirname(declarationPath), reference))
  const candidates = new Set([resolved])
  const extensionReplacements = [
    [/\.jsx?$/, '.d.ts'],
    [/\.mjs$/, '.d.mts'],
    [/\.cjs$/, '.d.cts'],
  ]
  for (const [extension, replacement] of extensionReplacements) {
    if (extension.test(resolved)) candidates.add(resolved.replace(extension, replacement))
  }
  if (!posix.extname(resolved)) {
    for (const extension of ['.d.ts', '.d.mts', '.d.cts']) candidates.add(`${resolved}${extension}`)
  }
  for (const filename of ['index.d.ts', 'index.d.mts', 'index.d.cts']) candidates.add(posix.join(resolved, filename))
  return { candidates, resolved }
}

const verifyDeclarationClosure = async (tarball, entries, extractionDirectory) => {
  await mkdir(extractionDirectory)
  run('tar', ['-xzf', tarball, '-C', extractionDirectory])
  const entrySet = new Set(entries)
  const declarationEntries = entries.filter(entry => /\.d\.(?:ts|mts|cts)$/.test(entry))
  assert.ok(declarationEntries.length > 0, `${basename(tarball)} has no declaration files`)

  for (const declarationPath of declarationEntries) {
    const source = await readFile(join(extractionDirectory, ...declarationPath.split('/')), 'utf8')
    for (const reference of collectRelativeDeclarationReferences(source)) {
      const { candidates, resolved } = declarationReferenceCandidates(declarationPath, reference)
      assert.ok(
        resolved.startsWith('package/'),
        `${declarationPath} has a relative declaration reference outside the package: ${reference}`,
      )
      assert.ok(
        [...candidates].some(candidate => entrySet.has(candidate)),
        `${declarationPath} has an unresolved relative declaration reference: ${reference}`,
      )
    }
  }
}

const assertConditionalExport = (manifest, subpath, outputName) => {
  assert.deepEqual(manifest.exports[subpath], {
    types: `./dist/${outputName}.d.ts`,
    import: `./dist/${outputName}.js`,
    require: `./dist/${outputName}.cjs`,
  })
}

const listTarballEntries = tarball => run('tar', ['-tzf', tarball], { capture: true }).trim().split('\n')

const verifyRuntimeTarball = async (tarball, packageName, extractionDirectory) => {
  const entries = listTarballEntries(tarball)
  for (const required of ['package/dist/index.js', 'package/dist/index.cjs', 'package/dist/index.d.ts']) {
    assert.ok(entries.includes(required), `${basename(tarball)} is missing ${required}`)
  }
  await verifyDeclarationClosure(tarball, entries, extractionDirectory)
  if (packageName !== '@easy-editor/core') {
    const esm = readTarballFile(tarball, 'dist/index.js')
    const cjs = readTarballFile(tarball, 'dist/index.cjs')
    assert.match(esm, /@easy-editor\/core\/instance/)
    assert.match(cjs, /@easy-editor\/core\/instance/)
    assert.doesNotMatch(`${esm}\n${cjs}`, /\bdefaultEngine\b/)
    assert.doesNotMatch(`${esm}\n${cjs}`, /(?:from|require\()\s*['"]@easy-editor\/core['"]/)
    return
  }

  for (const required of ['package/dist/instance.js', 'package/dist/instance.cjs', 'package/dist/instance.d.ts']) {
    assert.ok(entries.includes(required), `${basename(tarball)} is missing ${required}`)
  }
  assert.deepEqual(
    entries.filter(entry => /^package\/dist\/agent(?:[-./]|$)/i.test(entry)),
    [],
    `${basename(tarball)} must not publish Agent runtime files`,
  )
  const instanceBundle = `${readTarballFile(tarball, 'dist/instance.js')}\n${readTarballFile(
    tarball,
    'dist/instance.cjs',
  )}`
  assert.doesNotMatch(instanceBundle, /\bdefaultEngine\b/)
  const manifest = JSON.parse(readTarballFile(tarball, 'package.json'))
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './instance'])
  assertConditionalExport(manifest, '.', 'index')
  assertConditionalExport(manifest, './instance', 'instance')
}

const assertNoBuildGarbage = (tarball, entries) => {
  assert.deepEqual(
    entries.filter(
      entry => /(?:^|\/)(?:node_modules|\.turbo|\.vite|coverage)(?:\/|$)/.test(entry) || entry.endsWith('.tsbuildinfo'),
    ),
    [],
    `${basename(tarball)} contains local build garbage`,
  )
}

const verifyCreateTarball = tarball => {
  const entries = listTarballEntries(tarball)
  for (const required of [
    'package/dist/index.js',
    'package/dist/index.cjs',
    'package/template/dashboard/react/package.json',
  ]) {
    assert.ok(entries.includes(required), `${basename(tarball)} is missing ${required}`)
  }
  assertNoBuildGarbage(tarball, entries)
  assert.match(readTarballFile(tarball, 'dist/index.js'), /^#!\/usr\/bin\/env node/)
  assert.match(readTarballFile(tarball, 'dist/index.cjs'), /^#!\/usr\/bin\/env node/)
  const manifest = JSON.parse(readTarballFile(tarball, 'package.json'))
  assert.equal(manifest.main, 'dist/index.js')
  assert.equal(manifest.module, 'dist/index.js')
  assert.equal(manifest.exports, './dist/index.js')
  assert.equal(manifest.bin['@easy-editor/create'], './dist/index.js')
}

const verifyEasypackTarball = async (tarball, extractionDirectory) => {
  const entries = listTarballEntries(tarball)
  for (const required of [
    'package/dist/index.js',
    'package/dist/index.d.ts',
    'package/dist/bin.js',
    'package/dist/bin.d.ts',
  ]) {
    assert.ok(entries.includes(required), `${basename(tarball)} is missing ${required}`)
  }
  assertNoBuildGarbage(tarball, entries)
  await verifyDeclarationClosure(tarball, entries, extractionDirectory)
  assert.match(readTarballFile(tarball, 'dist/bin.js'), /^#!\/usr\/bin\/env node/)
  const manifest = JSON.parse(readTarballFile(tarball, 'package.json'))
  assert.equal(manifest.main, 'dist/index.js')
  assert.equal(manifest.types, 'dist/index.d.ts')
  assert.deepEqual(manifest.exports, {
    '.': {
      types: './dist/index.d.ts',
      import: './dist/index.js',
    },
  })
  assert.equal(manifest.bin.easypack, './dist/bin.js')
}

const verifyInstalledConditionalExports = projectDirectory => {
  const esmContract = `
    const root = await import('@easy-editor/core')
    const instance = await import('@easy-editor/core/instance')
    const assertUnavailable = async subpath => {
      try {
        await import(subpath)
      } catch (error) {
        if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return
        throw error
      }
      throw new Error(\`ESM core unexpectedly exposed \${subpath}\`)
    }
    if (!root.defaultEngine || root.project !== root.defaultEngine.project) {
      throw new Error('ESM core root did not expose the legacy engine facade')
    }
    if (typeof instance.createEngine !== 'function' || 'defaultEngine' in instance) {
      throw new Error('ESM core/instance did not expose the isolated engine contract')
    }
    const engine = instance.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
    try {
      if (engine === root.defaultEngine || typeof engine.destroy !== 'function') {
        throw new Error('ESM core/instance did not create an isolated engine')
      }
    } finally {
      await engine.destroy()
    }
    await assertUnavailable('@easy-editor/core/agent')
    await assertUnavailable('@easy-editor/core/agent-channel')
  `
  const cjsContract = `
    void (async () => {
      const root = require('@easy-editor/core')
      const instance = require('@easy-editor/core/instance')
      const assertUnavailable = subpath => {
        try {
          require(subpath)
        } catch (error) {
          if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return
          throw error
        }
        throw new Error(\`CJS core unexpectedly exposed \${subpath}\`)
      }
      if (!root.defaultEngine || root.project !== root.defaultEngine.project) {
        throw new Error('CJS core root did not expose the legacy engine facade')
      }
      if (typeof instance.createEngine !== 'function' || 'defaultEngine' in instance) {
        throw new Error('CJS core/instance did not expose the isolated engine contract')
      }
      const engine = instance.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
      try {
        if (engine === root.defaultEngine || typeof engine.destroy !== 'function') {
          throw new Error('CJS core/instance did not create an isolated engine')
        }
      } finally {
        await engine.destroy()
      }
      assertUnavailable('@easy-editor/core/agent')
      assertUnavailable('@easy-editor/core/agent-channel')
    })().catch(error => {
      console.error(error)
      process.exitCode = 1
    })
  `
  run(process.execPath, ['--input-type=module', '--eval', esmContract], { cwd: projectDirectory })
  run(process.execPath, ['--input-type=commonjs', '--eval', cjsContract], { cwd: projectDirectory })
}

const verifyInstalledTools = async (projectDirectory, tarballs) => {
  await mkdir(projectDirectory)
  const manifest = {
    name: 'easy-editor-release-tool-consumer',
    private: true,
    type: 'module',
    devDependencies: Object.fromEntries(
      toolPackages.map(([packageName]) => [packageName, `file:${tarballs.get(packageName)}`]),
    ),
  }
  await writeFile(join(projectDirectory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  run(pnpm, ['install', '--frozen-lockfile=false', '--ignore-scripts', '--config.engine-strict=true'], {
    cwd: projectDirectory,
  })

  const createHelp = run(pnpm, ['exec', 'create', '--help'], { cwd: projectDirectory, capture: true })
  assert.match(createHelp, /Create a new Easy Editor project/)

  if (!tarballs.has('@easy-editor/easypack')) return
  const easypackContract = `
    const easypack = await import('@easy-editor/easypack')
    for (const exportName of ['defineConfig', 'createRollupConfig', 'createViteConfig']) {
      if (typeof easypack[exportName] !== 'function') {
        throw new Error(\`@easy-editor/easypack did not expose \${exportName}\`)
      }
    }
  `
  run(process.execPath, ['--input-type=module', '--eval', easypackContract], { cwd: projectDirectory })
  const easypackHelp = run(pnpm, ['exec', 'easypack', '--help'], { cwd: projectDirectory, capture: true })
  assert.match(easypackHelp, /Build and dev tools for EasyEditor ecosystem/)
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'easy-editor-template-pack-'))
try {
  const packDirectory = join(temporaryRoot, 'packs')
  const extractionDirectory = join(temporaryRoot, 'extracted')
  const projectDirectory = join(temporaryRoot, 'project')
  const toolProjectDirectory = join(temporaryRoot, 'tool-project')
  await mkdir(packDirectory)
  await mkdir(extractionDirectory)
  await cp(templateRoot, projectDirectory, { recursive: true })

  const runtimeTarballs = new Map()
  for (const [packageName, packageDirectory] of runtimePackages) {
    const tarball = await packPackage(packageDirectory, packDirectory)
    await verifyRuntimeTarball(tarball, packageName, join(extractionDirectory, packageDirectory))
    runtimeTarballs.set(packageName, tarball)
  }

  const toolTarballs = new Map()
  for (const [packageName, packageDirectory] of toolPackages) {
    const tarball = await packPackage(packageDirectory, packDirectory)
    if (packageName === '@easy-editor/create') verifyCreateTarball(tarball)
    if (packageName === '@easy-editor/easypack') {
      await verifyEasypackTarball(tarball, join(extractionDirectory, packageDirectory))
    }
    toolTarballs.set(packageName, tarball)
  }

  const manifestPath = join(projectDirectory, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  for (const [packageName, tarball] of runtimeTarballs) manifest.dependencies[packageName] = `file:${tarball}`
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  run(pnpm, ['install', '--frozen-lockfile=false', '--config.engine-strict=true'], { cwd: projectDirectory })
  verifyInstalledConditionalExports(projectDirectory)
  run(pnpm, ['build'], { cwd: projectDirectory })
  await verifyInstalledTools(toolProjectDirectory, toolTarballs)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
