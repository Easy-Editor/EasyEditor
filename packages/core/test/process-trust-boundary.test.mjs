import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCore } from './helpers/kernel.mjs'

const sharedLegacyMarker = () => true

const flattenErrors = error => {
  const errors = [error]
  for (let index = 0; index < errors.length; index += 1) {
    const nested = errors[index]?.errors
    if (Array.isArray(nested)) errors.push(...nested)
  }
  return errors
}

test('restricted engine creation fails closed only while a leased legacy prototype extension exists', async t => {
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

  await legacy.destroy()

  assert.equal(core.Node.prototype.legacyRealmMarker, undefined)
  const restricted = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  await restricted.init()
  await restricted.destroy()
})

test('identical legacy extensions remain installed until the final owning engine is destroyed', async t => {
  const core = await loadCore()
  const first = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const second = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => {
    await first.destroy()
    await second.destroy()
  })
  const extension = {
    name: 'shared-legacy-extension',
    extensionFingerprint: 'shared-legacy-extension:v1',
    extend(api) {
      api.extend('Node', { sharedLegacyMarker })
    },
    init() {},
  }

  await first.plugins.register(extension)
  await second.plugins.register(extension)
  await first.init()
  await second.init()

  assert.equal(typeof core.Node.prototype.sharedLegacyMarker, 'function')
  await first.destroy()
  assert.equal(typeof core.Node.prototype.sharedLegacyMarker, 'function')
  await second.destroy()
  assert.equal(core.Node.prototype.sharedLegacyMarker, undefined)
})

test('same-source extensions with different closures are rejected instead of sharing captured state', async t => {
  const core = await loadCore()
  const first = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const second = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => {
    await first.destroy()
    await second.destroy()
  })
  const makeExtension = captured => ({
    name: 'captured-legacy-extension',
    extend(api) {
      api.extend('Node', {
        capturedLegacyMarker() {
          return captured
        },
      })
    },
    init() {},
  })

  await first.plugins.register(makeExtension('first'))
  await second.plugins.register(makeExtension('second'))
  await first.init()

  await assert.rejects(
    second.init(),
    error =>
      error?.name === 'PrototypeExtensionConflictError' && /prototype|extension|identity|conflict/i.test(error.message),
  )

  const document = first.project.createDocument({ componentName: 'Page', id: 'root' })
  assert.equal(document.root.capturedLegacyMarker(), 'first')
  await first.destroy()
  assert.equal(core.Node.prototype.capturedLegacyMarker, undefined)
})

test('a legacy engine reacquires its prototype extension lease after restart', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  await engine.plugins.register({
    name: 'restartable-legacy-extension',
    extend(api) {
      api.extend('Node', {
        restartableLegacyMarker() {
          return this.id
        },
      })
    },
    init() {},
  })

  await engine.init()
  const first = engine.project.createDocument({ componentName: 'Page', id: 'first' })
  assert.equal(first.root.restartableLegacyMarker(), 'first')
  await engine.destroy()
  assert.equal(core.Node.prototype.restartableLegacyMarker, undefined)

  await engine.init()
  const second = engine.project.createDocument({ componentName: 'Page', id: 'second' })
  assert.equal(second.root.restartableLegacyMarker(), 'second')
  await engine.destroy()
  assert.equal(core.Node.prototype.restartableLegacyMarker, undefined)
})

test('the final owner restores a descriptor that existed before the extension lease', async t => {
  const core = await loadCore()
  const original = {
    configurable: true,
    enumerable: false,
    value() {
      return 'original'
    },
    writable: false,
  }
  Object.defineProperty(core.Node.prototype, 'restoredLegacyMarker', original)
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => {
    await engine.destroy()
    Object.defineProperty(core.Node.prototype, 'restoredLegacyMarker', original)
    Reflect.deleteProperty(core.Node.prototype, 'restoredLegacyMarker')
  })

  await engine.plugins.register({
    name: 'restored-legacy-extension',
    extend(api) {
      api.extend('Node', {
        restoredLegacyMarker: {
          enumerable: true,
          value() {
            return 'extended'
          },
          writable: true,
        },
      })
    },
    init() {},
  })
  await engine.init()
  assert.equal(core.Node.prototype.restoredLegacyMarker(), 'extended')

  await engine.destroy()

  const restored = Object.getOwnPropertyDescriptor(core.Node.prototype, 'restoredLegacyMarker')
  assert.equal(restored?.value, original.value)
  assert.equal(restored?.configurable, original.configurable)
  assert.equal(restored?.enumerable, original.enumerable)
  assert.equal(restored?.writable, original.writable)
  assert.equal(core.Node.prototype.restoredLegacyMarker(), 'original')
})

test('descriptor tampering makes lease release fail closed and remains retryable', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const lease = { descriptor: undefined }
  t.after(async () => {
    if (lease.descriptor) {
      Object.defineProperty(core.Node.prototype, 'retryableLegacyMarker', lease.descriptor)
    }
    await engine.destroy()
  })
  await engine.plugins.register({
    name: 'retryable-legacy-extension',
    extend(api) {
      api.extend('Node', {
        retryableLegacyMarker() {
          return true
        },
      })
    },
    init() {},
  })
  await engine.init()
  lease.descriptor = Object.getOwnPropertyDescriptor(core.Node.prototype, 'retryableLegacyMarker')
  Object.defineProperty(core.Node.prototype, 'retryableLegacyMarker', {
    configurable: true,
    value() {
      return false
    },
  })

  await assert.rejects(
    engine.destroy(),
    error =>
      error instanceof AggregateError &&
      flattenErrors(error).some(
        nested =>
          nested?.name === 'PrototypeExtensionConflictError' &&
          /prototype|integrity|extension/i.test(String(nested.message)),
      ),
  )
  assert.equal(engine.lifecycleState, 'failed')

  Object.defineProperty(core.Node.prototype, 'retryableLegacyMarker', lease.descriptor)
  lease.descriptor = undefined
  await engine.destroy()
  assert.equal(core.Node.prototype.retryableLegacyMarker, undefined)
})
