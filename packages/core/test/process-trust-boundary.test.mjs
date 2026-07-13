import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCore } from './helpers/kernel.mjs'

test('restricted engine creation fails closed after a legacy prototype extension exists', async t => {
  const core = await loadCore()
  const legacy = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => legacy.destroy())
  await legacy.plugins.register({
    name: 'legacy-extension',
    extend(api) {
      api.extend('Node', {
        legacyRealmMarker() {
          return true
        },
      })
    },
    init() {},
  })
  await legacy.init()

  assert.equal(typeof core.Node.prototype.legacyRealmMarker, 'function')
  assert.throws(
    () => core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null }),
    error => error?.name === 'PolicyViolation' && error.capability === 'plugin.extension',
  )
})
