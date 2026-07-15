import assert from 'node:assert/strict'
import test from 'node:test'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

test('prototype extension graph is preflighted before any callback operation mutates the realm', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.plugins.register({
    name: 'atomic-extension',
    extend(api) {
      api.extend('Node', {
        mustNotLeak() {
          return true
        },
      })
      api.extend('Node', {
        collision() {
          return 1
        },
      })
      api.extend('Node', {
        collision() {
          return 2
        },
      })
    },
    init() {},
  })

  const error = await captureFailure(() => engine.init())
  assert.match(error.message, /prototype|extension|batch|conflict|fingerprint/i)

  const document = engine.project.createDocument({ componentName: 'Page', id: 'root' })
  assert.equal(Object.hasOwn(Object.getPrototypeOf(document.root), 'mustNotLeak'), false)
  assert.equal(Object.hasOwn(Object.getPrototypeOf(document.root), 'collision'), false)
})

test('an invalid MobX descriptor rolls back every earlier property in the batch', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.plugins.register({
    name: 'atomic-invalid-mobx-extension',
    extend(api) {
      api.extend('Node', {
        mustRollbackAfterMobxFailure() {
          return true
        },
      })
      api.extend('Node', {
        invalidMobxExtension: {
          [core.MOBX_EXTEND_SYMBOL]: true,
          config: { type: 'not-a-mobx-extension-type' },
        },
      })
    },
    init() {},
  })

  const error = await captureFailure(() => engine.init())
  assert.match(error.message, /invalid|mobx|extension|type/i)
  assert.equal(Object.hasOwn(core.Node.prototype, 'mustRollbackAfterMobxFailure'), false)
  assert.equal(Object.hasOwn(core.Node.prototype, 'invalidMobxExtension'), false)

  await engine.destroy()
  const restricted = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  await restricted.init()
  await restricted.destroy()
})
