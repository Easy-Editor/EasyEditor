import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const templateRoot = join(packageRoot, 'template/dashboard/react')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const packages = [
  ['@easy-editor/core', 'core'],
  ['@easy-editor/plugin-dashboard', 'plugin-dashboard'],
  ['@easy-editor/plugin-hotkey', 'plugin-hotkey'],
  ['@easy-editor/renderer-core', 'renderer-core'],
  ['@easy-editor/react-renderer', 'react-renderer'],
  ['@easy-editor/react-renderer-dashboard', 'react-renderer-dashboard'],
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

const verifyTarball = (tarball, packageName) => {
  const entries = run('tar', ['-tzf', tarball], { capture: true }).trim().split('\n')
  for (const required of ['package/dist/index.js', 'package/dist/index.cjs', 'package/dist/index.d.ts']) {
    assert.ok(entries.includes(required), `${basename(tarball)} is missing ${required}`)
  }
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
  const instanceBundle = `${readTarballFile(tarball, 'dist/instance.js')}\n${readTarballFile(
    tarball,
    'dist/instance.cjs',
  )}`
  assert.doesNotMatch(instanceBundle, /\bdefaultEngine\b/)
  const manifest = JSON.parse(readTarballFile(tarball, 'package.json'))
  assert.deepEqual(Object.keys(manifest.exports['./instance']).sort(), ['import', 'require', 'types'])
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'easy-editor-template-pack-'))
try {
  const packDirectory = join(temporaryRoot, 'packs')
  const projectDirectory = join(temporaryRoot, 'project')
  await mkdir(packDirectory)
  await cp(templateRoot, projectDirectory, { recursive: true })

  const tarballs = new Map()
  for (const [packageName, packageDirectory] of packages) {
    const tarball = await packPackage(packageDirectory, packDirectory)
    verifyTarball(tarball, packageName)
    tarballs.set(packageName, tarball)
  }

  const manifestPath = join(projectDirectory, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  for (const [packageName, tarball] of tarballs) manifest.dependencies[packageName] = `file:${tarball}`
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  run(pnpm, ['install', '--frozen-lockfile=false', '--config.engine-strict=true'], { cwd: projectDirectory })
  run(pnpm, ['build'], { cwd: projectDirectory })
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
