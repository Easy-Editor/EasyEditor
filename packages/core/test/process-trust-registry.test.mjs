import assert from 'node:assert/strict'
import test from 'node:test'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

const marker = () => true
const makeIntegrityMarker = value =>
  function integrityMarker() {
    return value
  }

test('process extension registry is idempotent and rejects conflicting fingerprints', async t => {
  const core = await loadCore()
  const first = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const identical = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const conflicting = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => {
    await first.destroy()
    await identical.destroy()
    await conflicting.destroy()
  })

  for (const engine of [first, identical]) {
    await engine.plugins.register({
      name: 'registered-extension',
      extend(api) {
        api.extend('Node', { registeredMarker: marker })
      },
      init() {},
    })
  }
  await first.init()
  await identical.init()

  await conflicting.plugins.register({
    name: 'conflicting-extension',
    extend(api) {
      api.extend('Node', {
        registeredMarker() {
          return false
        },
      })
    },
    init() {},
  })
  const conflict = await captureFailure(() => conflicting.init())
  assert.match(conflict.message, /prototype|extension|conflict|fingerprint/i)

  const document = first.project.createDocument({ componentName: 'Page', id: 'root' })
  assert.equal(document.root.registeredMarker(), true)
})

test('a tampered registered descriptor is rejected before an identical legacy extension is reused', async t => {
  const core = await loadCore()
  const legacy = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const retry = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const lease = { descriptor: undefined }
  const registeredIntegrityMarker = makeIntegrityMarker(true)
  t.after(async () => {
    if (lease.descriptor) {
      Object.defineProperty(core.Node.prototype, 'integrityMarker', lease.descriptor)
    }
    await legacy.destroy()
    await retry.destroy()
  })
  const plugin = {
    name: 'integrity-extension',
    extensionFingerprint: 'integrity-extension:v1',
    extend(api) {
      api.extend('Node', {
        integrityMarker: { configurable: true, value: registeredIntegrityMarker },
      })
    },
    init() {},
  }
  await legacy.plugins.register(plugin)
  await legacy.init()

  const document = legacy.project.createDocument({ componentName: 'Page', id: 'root' })
  lease.descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(document.root), 'integrityMarker')
  Object.defineProperty(Object.getPrototypeOf(document.root), 'integrityMarker', {
    configurable: true,
    value: makeIntegrityMarker(false),
  })

  await retry.plugins.register(plugin)
  const error = await captureFailure(() => retry.init())
  assert.equal(error.name, 'PrototypeExtensionConflictError')
  assert.match(error.message, /integrity|prototype|tamper|violation/i)
})
