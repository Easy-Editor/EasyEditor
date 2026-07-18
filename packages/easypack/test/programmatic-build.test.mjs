import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { buildEasypack } from '../dist/index.js'

const workspaces = new Set()
const execFileAsync = promisify(execFile)
const cliPath = fileURLToPath(new URL('../dist/bin.js', import.meta.url))
const toImportSpecifier = path => {
  const normalized = path.split(sep).join('/')
  return normalized.startsWith('.') ? normalized : `./${normalized}`
}

const createWorkspace = async ({ source = 'export const answer: number = 42\n' } = {}) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'easypack-programmatic-'))
  workspaces.add(rootDir)
  await mkdir(join(rootDir, 'src'))
  await writeFile(
    join(rootDir, 'package.json'),
    `${JSON.stringify({ name: '@fixture/programmatic-build', version: '1.2.3', type: 'module' }, null, 2)}\n`,
  )
  await writeFile(join(rootDir, 'src/index.ts'), source)
  return rootDir
}

const libraryConfig = {
  preset: 'library',
  entry: { main: 'src/index.ts' },
  output: {
    dir: 'dist',
    esm: true,
    cjs: true,
    umd: false,
    minify: false,
    sourcemap: false,
    types: false,
  },
}

test.afterEach(async () => {
  await Promise.all([...workspaces].map(rootDir => rm(rootDir, { force: true, recursive: true })))
  workspaces.clear()
})

test('programmatic build uses only explicit inputs and returns deterministic artifact metadata', async () => {
  const rootDir = await createWorkspace()
  const originalArgv = process.argv
  const originalExit = process.exit

  process.argv = ['node', '--poisoned-global-argv']
  process.exit = code => {
    throw new Error(`programmatic build called process.exit(${String(code)})`)
  }

  try {
    const first = await buildEasypack({ rootDir, config: libraryConfig })
    const second = await buildEasypack({ rootDir, config: libraryConfig })

    assert.deepEqual(second, first)
    assert.deepEqual(first.package, { name: '@fixture/programmatic-build', version: '1.2.3' })
    assert.equal(first.preset, 'library')
    assert.deepEqual(
      first.artifacts.map(artifact => ({ path: artifact.path, type: artifact.type })),
      [
        { path: 'dist/index.cjs', type: 'chunk' },
        { path: 'dist/index.esm.js', type: 'chunk' },
      ],
    )
    for (const artifact of first.artifacts) {
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/)
      assert.equal(artifact.bytes, (await readFile(join(rootDir, artifact.path))).byteLength)
    }
    assert.match(await readFile(join(rootDir, 'dist/index.esm.js'), 'utf8'), /const answer = 42/)
  } finally {
    process.argv = originalArgv
    process.exit = originalExit
  }
})

test('programmatic build rejects paths outside its workspace before writing', async () => {
  const rootDir = await createWorkspace()
  const outsideDir = await mkdtemp(join(tmpdir(), 'easypack-outside-'))
  workspaces.add(outsideDir)

  await assert.rejects(
    buildEasypack({
      rootDir,
      config: {
        ...libraryConfig,
        output: { ...libraryConfig.output, dir: outsideDir },
      },
    }),
    /Output directory must stay inside the Easypack workspace/,
  )
  assert.deepEqual(await readdir(outsideDir), [])
})

test('programmatic build rejects output directories that symlink outside its workspace', async () => {
  const rootDir = await createWorkspace()
  const outsideDir = await mkdtemp(join(tmpdir(), 'easypack-symlink-outside-'))
  workspaces.add(outsideDir)
  await symlink(outsideDir, join(rootDir, 'dist'), 'dir')

  await assert.rejects(
    buildEasypack({ rootDir, config: libraryConfig }),
    /Output directory must stay inside the Easypack workspace/,
  )
  assert.deepEqual(await readdir(outsideDir), [])
})

test('programmatic build rejects relative source imports outside its workspace', async () => {
  const rootDir = await createWorkspace()
  const outsideDir = await mkdtemp(join(tmpdir(), 'easypack-module-outside-'))
  workspaces.add(outsideDir)
  const outsideModule = join(outsideDir, 'secret.ts')
  await writeFile(outsideModule, "export const secret = 'outside'\n")
  await writeFile(
    join(rootDir, 'src/index.ts'),
    `export { secret } from '${toImportSpecifier(relative(join(rootDir, 'src'), outsideModule))}'\n`,
  )

  await assert.rejects(
    buildEasypack({ rootDir, config: libraryConfig }),
    /Module import must stay inside the Easypack workspace/,
  )
})

test('programmatic build rejects source imports through a symlink outside its workspace', async () => {
  const rootDir = await createWorkspace()
  const outsideDir = await mkdtemp(join(tmpdir(), 'easypack-module-symlink-'))
  workspaces.add(outsideDir)
  const outsideModule = join(outsideDir, 'secret.ts')
  await writeFile(outsideModule, "export const secret = 'outside'\n")
  await symlink(outsideModule, join(rootDir, 'src/linked.ts'), 'file')
  await writeFile(join(rootDir, 'src/index.ts'), "export { secret } from './linked.ts'\n")

  await assert.rejects(
    buildEasypack({ rootDir, config: libraryConfig }),
    /Resolved module must stay inside the Easypack workspace/,
  )
})

test('programmatic build still bundles package dependencies installed inside its workspace', async () => {
  const rootDir = await createWorkspace()
  const dependencyRoot = await mkdtemp(join(tmpdir(), 'easypack-package-store-'))
  workspaces.add(dependencyRoot)
  await writeFile(
    join(dependencyRoot, 'package.json'),
    `${JSON.stringify({ name: 'fixture-dependency', version: '1.0.0', type: 'module', exports: './index.js' })}\n`,
  )
  await writeFile(join(dependencyRoot, 'index.js'), 'export const dependencyValue = 7\n')
  await mkdir(join(rootDir, 'node_modules'))
  await symlink(dependencyRoot, join(rootDir, 'node_modules/fixture-dependency'), 'dir')
  await writeFile(
    join(rootDir, 'src/index.ts'),
    "import { dependencyValue } from 'fixture-dependency'\nexport const answer = dependencyValue\n",
  )

  await buildEasypack({ rootDir, config: libraryConfig })

  assert.match(await readFile(join(rootDir, 'dist/index.esm.js'), 'utf8'), /dependencyValue = 7/)
})

test('auto-discovered config symlinks are rejected before evaluation', async () => {
  const rootDir = await createWorkspace()
  const outsideDir = await mkdtemp(join(tmpdir(), 'easypack-config-symlink-'))
  workspaces.add(outsideDir)
  const marker = join(outsideDir, 'evaluated.txt')
  const outsideConfig = join(outsideDir, 'easypack.config.mjs')
  await writeFile(
    outsideConfig,
    `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'evaluated')\nexport default ${JSON.stringify(libraryConfig)}\n`,
  )
  await symlink(outsideConfig, join(rootDir, 'easypack.config.mjs'), 'file')

  await assert.rejects(buildEasypack({ rootDir }), /Config file must stay inside the Easypack workspace/)
  await assert.rejects(readFile(marker), error => error?.code === 'ENOENT')
})

test('the build CLI also rejects auto-discovered config symlinks before evaluation', async () => {
  const rootDir = await createWorkspace()
  const outsideDir = await mkdtemp(join(tmpdir(), 'easypack-cli-config-symlink-'))
  workspaces.add(outsideDir)
  const marker = join(outsideDir, 'evaluated.txt')
  const outsideConfig = join(outsideDir, 'easypack.config.mjs')
  await writeFile(
    outsideConfig,
    `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'evaluated')\nexport default ${JSON.stringify(libraryConfig)}\n`,
  )
  await symlink(outsideConfig, join(rootDir, 'easypack.config.mjs'), 'file')

  await assert.rejects(execFileAsync(process.execPath, [cliPath, 'build'], { cwd: rootDir }), error => {
    assert.match(error?.stderr ?? '', /Config file must stay inside the Easypack workspace/)
    return true
  })
  await assert.rejects(readFile(marker), error => error?.code === 'ENOENT')
})

test('failed config evaluation removes Easypack temporary config files', async () => {
  const rootDir = await createWorkspace()
  await writeFile(
    join(rootDir, 'easypack.config.ts'),
    "throw new Error('fixture config exploded')\nexport default { preset: 'library' }\n",
  )

  await assert.rejects(buildEasypack({ rootDir }), /fixture config exploded/)

  assert.deepEqual(
    (await readdir(rootDir)).filter(name => name.includes('easypack.config') && name.endsWith('.tmp.mjs')),
    [],
  )
})

test('failed output writes release the workspace for immediate cleanup', async () => {
  const rootDir = await createWorkspace()
  await writeFile(join(rootDir, 'dist'), 'not a directory')

  await assert.rejects(buildEasypack({ rootDir, config: libraryConfig }))
  await rm(rootDir, { recursive: true })
  workspaces.delete(rootDir)
})

test('the build CLI preserves the programmatic runner output behavior', async () => {
  const rootDir = await createWorkspace()
  await writeFile(join(rootDir, 'easypack.config.mjs'), `export default ${JSON.stringify(libraryConfig)}\n`)

  const { stdout } = await execFileAsync(process.execPath, [cliPath, 'build'], { cwd: rootDir })

  assert.match(stdout, /Build completed!/)
  assert.match(await readFile(join(rootDir, 'dist/index.cjs'), 'utf8'), /const answer = 42/)
  assert.match(await readFile(join(rootDir, 'dist/index.esm.js'), 'utf8'), /const answer = 42/)
})
