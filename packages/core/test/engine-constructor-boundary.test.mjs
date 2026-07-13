import assert from 'node:assert/strict'
import test from 'node:test'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

test('constructor rollback releases an acquired restricted-realm lease', async t => {
  const core = await loadCore()
  const constructorError = await captureFailure(() =>
    core.createEngine({
      hostWindow: null,
      services: {
        eventBus: {
          setDeliveryScheduler() {
            throw new Error('constructor boundary probe')
          },
        },
      },
    }),
  )
  assert.match(constructorError.message, /constructor boundary probe/)

  const plugins = new core.Plugins()
  t.after(async () => plugins.dispose())
  let selectionClass
  await plugins.register({
    extensionFingerprint: 'constructor-rollback-lease-probe-v1',
    name: 'constructor-rollback-lease-probe',
    init() {},
    extend({ extend, extendClass }) {
      selectionClass = extendClass.Selection
      extend('Selection', {
        constructorRollbackLeaseProbe() {
          return true
        },
      })
    },
  })

  await plugins.extend()
  assert.equal(typeof selectionClass.prototype.constructorRollbackLeaseProbe, 'function')
})
