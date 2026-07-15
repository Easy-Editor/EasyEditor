import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))

const readJson = async relativePath =>
  JSON.parse(await readFile(new URL(relativePath, `${new URL(repositoryRoot, 'file:')}/`), 'utf8'))

test('Phase 0 keeps the Core package surface finite and Agent-free', async () => {
  const manifest = await readJson('packages/core/package.json')
  const sourceExports = Object.keys(manifest.exports).sort()
  const publishedExports = Object.keys(manifest.publishConfig.exports).sort()

  assert.deepEqual(sourceExports, ['.', './instance'])
  assert.deepEqual(publishedExports, sourceExports)
  for (const entry of [...sourceExports, ...publishedExports]) {
    assert.doesNotMatch(entry, /agent|ai/i)
  }
})

test('Phase 0 preserves separate Core and repository package API gates', async () => {
  const frameworkEntryTest = await readFile(
    new URL('packages/core/test/framework-entry.test.mjs', `${new URL(repositoryRoot, 'file:')}/`),
    'utf8',
  )
  const instanceTypeTest = await readFile(
    new URL('packages/core/test/instance-entry.test-d.ts', `${new URL(repositoryRoot, 'file:')}/`),
    'utf8',
  )
  const repositoryBaseline = await readFile(
    new URL('test/public-package-api-baseline.mjs', `${new URL(repositoryRoot, 'file:')}/`),
    'utf8',
  )

  assert.match(frameworkEntryTest, /reviewed source API allowlist must not drift/)
  assert.match(frameworkEntryTest, /AgentCapabilityManager/)
  assert.match(instanceTypeTest, /engine\.agentCapabilities/)
  assert.match(repositoryBaseline, /A published package API changed/)
  assert.match(repositoryBaseline, /packages\/core\/test\/framework-entry\.test\.mjs/)
})
