import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('CLI accepts the first declared scenario and framework without prompting', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'easy-editor-create-options-'))
  const targetName = 'generated-project'
  const targetDirectory = join(temporaryRoot, targetName)

  try {
    const result = spawnSync(
      process.execPath,
      [join(packageRoot, 'dist/index.js'), '--scenarios', 'dashboard', '--template', 'react', targetName],
      {
        cwd: temporaryRoot,
        encoding: 'utf8',
        timeout: 15_000,
      },
    )

    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

    const manifest = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8'))
    assert.equal(manifest.name, basename(targetDirectory))
    assert.match(result.stdout, /Done\. Now run:/)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})
