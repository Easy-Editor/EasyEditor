import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { coreBundleUrl } from './helpers/kernel.mjs'

test('the core bundle is importable in a headless Node process', () => {
  const script = `await import(${JSON.stringify(coreBundleUrl().href)})`
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
  })

  assert.equal(
    result.status,
    0,
    `headless import must not read window, document, location, or navigator at module evaluation time\n${result.stderr}`,
  )
})
