import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCore } from './helpers/kernel.mjs'

test('an active restricted engine blocks legacy process extension until it is destroyed', async t => {
  const core = await loadCore()
  const restricted = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  const legacy = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => {
    await restricted.destroy()
    await legacy.destroy()
  })
  let extended = false
  await legacy.plugins.register({
    name: 'late-extension',
    extend(api) {
      api.extend('Node', {
        lateRegisteredMarker() {
          return true
        },
      })
      extended = true
    },
    init() {},
  })

  await restricted.init()
  const error = await (async () => {
    try {
      await legacy.init()
    } catch (caught) {
      return caught
    }
    assert.fail('legacy extension must not enter a live restricted realm')
  })()

  assert.match(error.message, /restricted|prototype|extension|boundary/i)
  assert.equal(extended, false, 'the boundary must fail before the extension callback executes')
  assert.equal(core.Node.prototype.lateRegisteredMarker, undefined)
  assert.equal(restricted.lifecycleState, 'ready')

  await restricted.destroy()
  await legacy.init()
  assert.equal(legacy.lifecycleState, 'ready')
  assert.equal(typeof core.Node.prototype.lateRegisteredMarker, 'function')

  await legacy.destroy()
  assert.equal(core.Node.prototype.lateRegisteredMarker, undefined)
})
