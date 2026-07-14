import assert from 'node:assert/strict'
import test from 'node:test'
import { createExecutableSchema, createProjectSchema } from './fixtures/project-schema.mjs'
import { assertKernelApi, assertStructuredPolicyViolation, captureFailure, loadCore } from './helpers/kernel.mjs'

test('agentRestricted rejects deeply nested executable schema before project mutation', async t => {
  const core = await loadCore()
  assertKernelApi(core)
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  const before = structuredClone(engine.project.export())

  const error = await captureFailure(() => engine.loadProject(createExecutableSchema(), true))
  assertStructuredPolicyViolation(error, /schema|executable/i)
  assert.match(
    JSON.stringify({ message: error.message, path: error.path, details: error.details }),
    /componentsTree.*props.*safe.*nested.*handler/,
  )
  assert.deepEqual(engine.project.export(), before)
})

test('agentRestricted rejects executable command payload before node mutation', async t => {
  const core = await loadCore()
  assertKernelApi(core)
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  engine.loadProject(createProjectSchema(), true)
  const root = engine.project.currentDocument.root
  const before = engine.project.currentDocument.export()

  const error = await captureFailure(() =>
    engine.commands.execute({
      type: 'updateProps',
      nodeId: root.id,
      props: {
        safe: {
          nested: {
            handler: { type: 'JSExpression', value: 'globalThis.secret' },
          },
        },
      },
    }),
  )
  assertStructuredPolicyViolation(error, /command|executable/i)
  assert.deepEqual(engine.project.currentDocument.export(), before)
})

test('agentRestricted rejects remote access before calling a remote adapter', async t => {
  const core = await loadCore()
  assertKernelApi(core)
  let remoteCalls = 0
  const engine = core.createEngine({
    trustPolicy: 'agentRestricted',
    hostWindow: null,
    remoteAdapter: {
      request() {
        remoteCalls += 1
      },
    },
  })
  t.after(() => engine.destroy())

  const error = await captureFailure(() =>
    engine.remote.request({ type: 'material', name: 'untrusted', url: 'https://example.invalid/material.js' }),
  )
  assertStructuredPolicyViolation(error, /remote/i)
  assert.equal(remoteCalls, 0)
  assert.equal(engine.remote.registry.getAll().length, 0)
})

test('agentRestricted rejects plugin prototype extension before it runs', async t => {
  const core = await loadCore()
  assertKernelApi(core)
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  let extended = false
  let initialized = false
  const error = await captureFailure(() =>
    engine.plugins.register({
      name: 'unsafe-extension',
      extend() {
        extended = true
      },
      init() {
        initialized = true
      },
    }),
  )
  assertStructuredPolicyViolation(error, /plugin|extension/i)
  assert.equal(extended, false)
  assert.equal(initialized, false)
  assert.notEqual(engine.lifecycleState, 'ready')
})

test('agentRestricted policy is immutable and extension registration cannot seed a direct API bypass', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())

  assert.equal(Object.isFrozen(engine.trustPolicy), true)
  assert.throws(() => {
    engine.trustPolicy.allowRemoteAccess = true
  }, TypeError)

  let extensionCallbackCalls = 0
  const error = await captureFailure(() =>
    engine.plugins.register({
      name: 'direct-extension-bypass',
      extend(api) {
        extensionCallbackCalls += 1
        api.extend('Node', {
          restrictedBypassMarker() {
            return true
          },
        })
      },
      init() {},
    }),
  )
  assertStructuredPolicyViolation(error, /plugin|extension/i)
  await engine.innerPlugins.extend()
  await engine.innerPlugins.extend()
  assert.equal(extensionCallbackCalls, 0)
  assert.equal(core.Node.prototype.restrictedBypassMarker, undefined)
})

test('agentRestricted plugin events cannot leak or revive their private EventEmitter receiver', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  let retainedPluginEvent
  let receiver
  let deliveries = 0
  await engine.plugins.register({
    name: 'plugin-event-receiver-boundary',
    init(context) {
      retainedPluginEvent = context.pluginEvent
      context.pluginEvent.on('probe:receiver', function () {
        receiver = this
        deliveries += 1
      })
      context.pluginEvent.emit('probe:receiver')
    },
  })

  await engine.init()
  assert.equal(receiver, undefined)
  assert.equal(deliveries, 1)

  await engine.destroy()
  assert.throws(() => retainedPluginEvent.on('probe:revived', () => undefined), /plugin context is disposed/)
  assert.throws(() => retainedPluginEvent.emit('probe:receiver'), /plugin context is disposed/)
  assert.equal(deliveries, 1)
})

test('agentRestricted rejects raw functions and accessors without invoking getters', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())
  engine.loadProject(createProjectSchema(), true)
  const root = engine.project.currentDocument.root

  const functionError = await captureFailure(() =>
    engine.commands.execute({ type: 'updateProps', nodeId: root.id, props: { handler() {} } }),
  )
  assert.equal(functionError.name, 'PolicyViolation')

  let getterCalls = 0
  const props = {}
  Object.defineProperty(props, 'danger', {
    enumerable: true,
    get() {
      getterCalls += 1
      return { type: 'JSExpression', value: 'globalThis.secret' }
    },
  })
  const accessorError = await captureFailure(() =>
    engine.commands.execute({ type: 'updateProps', nodeId: root.id, props }),
  )
  assert.equal(accessorError.name, 'PolicyViolation')
  assert.equal(getterCalls, 0)
})

test('invalid insertNode payload is rejected before document mutation', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  engine.project.load(createProjectSchema(), true)
  const document = engine.project.currentDocument
  const before = structuredClone(document.export())

  const error = await captureFailure(() =>
    engine.commands.execute({
      type: 'insertNode',
      parentId: document.root.id,
      node: { id: 'invalid-runtime-node', componentName: 42, children: [] },
    }),
  )
  assert.equal(error.name, 'CommandValidationError')
  assert.deepEqual(document.export(), before)
})
