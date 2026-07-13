import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const templateManifest = JSON.parse(readFileSync(join(packageRoot, 'template/dashboard/react/package.json'), 'utf8'))
const enginePackages = [
  '@easy-editor/core',
  '@easy-editor/plugin-dashboard',
  '@easy-editor/plugin-hotkey',
  '@easy-editor/renderer-core',
  '@easy-editor/react-renderer',
  '@easy-editor/react-renderer-dashboard',
]

const readReleasePlan = () => {
  const temporaryDirectory = mkdtempSync(join(repositoryRoot, '.release-plan-contract-'))
  const outputPath = join(temporaryDirectory, 'release-plan.json')
  const changeset = join(
    repositoryRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'changeset.cmd' : 'changeset',
  )

  try {
    execFileSync(changeset, ['status', '--output', relative(repositoryRoot, outputPath)], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return JSON.parse(readFileSync(outputPath, 'utf8'))
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

test('React dashboard template follows the explicit 2.0.0 engine release plan', () => {
  const releasePlan = readReleasePlan()
  const actualReleases = new Map(releasePlan.releases.map(release => [release.name, release]))

  for (const packageName of enginePackages) {
    const explicitlyMajor = releasePlan.changesets.some(changeset =>
      changeset.releases.some(release => release.name === packageName && release.type === 'major'),
    )
    assert.ok(explicitlyMajor, `${packageName} must be explicitly declared as major in a changeset`)

    const plannedRelease = actualReleases.get(packageName)
    assert.ok(plannedRelease, `${packageName} must be present in the Changesets release plan`)
    assert.equal(plannedRelease.type, 'major')
    assert.equal(plannedRelease.newVersion, '2.0.0')
    assert.equal(templateManifest.dependencies[packageName], `^${plannedRelease.newVersion}`)
  }
})
