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
