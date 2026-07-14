import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

test('deferred EventBus deliveries cannot replay across an Engine lifecycle generation', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  await engine.init()
  let queuedDelivery
  let staleDeliveries = 0
  let freshDeliveries = 0
  const eventBus = core.createEventBus('generation-deferred-probe', undefined, deliver => {
    queuedDelivery = deliver
    return true
  })
  core.inheritTestLifecycleMutationGuard(engine, eventBus)
  eventBus.on('probe', () => {
    staleDeliveries += 1
  })
  t.after(async () => {
    eventBus.dispose()
    await engine.destroy()
  })

  eventBus.emit('probe')
  const staleDelivery = queuedDelivery
  await engine.destroy()
  await engine.init()
  eventBus.on('probe', () => {
    freshDeliveries += 1
  })

  staleDelivery()
  assert.deepEqual({ freshDeliveries, staleDeliveries }, { freshDeliveries: 0, staleDeliveries: 0 })

  eventBus.emit('probe')
  queuedDelivery()
  assert.deepEqual({ freshDeliveries, staleDeliveries }, { freshDeliveries: 1, staleDeliveries: 1 })
})

test('editor and designer mutation roots stay closed until an explicit restart', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  await engine.destroy()

  const terminalOperations = [
    ['editor.set', () => engine.editor.set('generation-probe', 'disposed')],
    ['editor.onChange', () => engine.editor.onChange('generation-probe', () => {})],
    ['designer.setProps', () => engine.designer.setProps({ suspended: true })],
    ['designer.addPropsReducer', () => engine.designer.addPropsReducer(props => props, core.TRANSFORM_STAGE.RENDER)],
    ['designer.onEvent', () => engine.designer.onEvent('generation:probe', () => {})],
  ]
  const acceptedWhileDisposed = []
  for (const [label, operation] of terminalOperations) {
    try {
      await operation()
      acceptedWhileDisposed.push(label)
    } catch {
      // Expected: terminal engines cannot acquire or mutate child resources.
    }
  }

  await engine.init()
  const rejectedAfterRestart = []
  for (const [label, operation] of terminalOperations) {
    try {
      const cleanup = await operation()
      if (typeof cleanup === 'function') cleanup()
    } catch {
      rejectedAfterRestart.push(label)
    }
  }

  assert.deepEqual(
    { acceptedWhileDisposed, rejectedAfterRestart },
    { acceptedWhileDisposed: [], rejectedAfterRestart: [] },
  )
})

test('generation-scoped model, material, and plugin references remain tombstoned after restart', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  const materialMeta = engine.materials.createComponentMeta({ componentName: 'Page' })
  const materialRegistry = engine.materials.registry
  engine.project.load(createProjectSchema({ id: 'generation-one' }), true)
  await engine.plugins.register({ name: 'generation-plugin', init() {} })
  await engine.init()

  const oldDocument = engine.project.currentDocument
  const oldRoot = oldDocument.root
  const oldHistory = oldDocument.history
  const runtime = engine.innerPlugins.get('generation-plugin')
  const oldContext = runtime.ctx
  await engine.destroy()
  await engine.init()

  const staleOperations = [
    ['document.createNode', () => oldDocument.createNode({ componentName: 'Page', id: 'stale-node', props: {} })],
    ['document.opened state', () => (oldDocument._opened = true)],
    ['document.dropLocation', () => (oldDocument.dropLocation = null)],
    ['document.onNodeAdd', () => oldDocument.onNodeAdd(() => {})],
    ['node.setPropValue', () => oldRoot.setPropValue('title', 'stale')],
    ['node.settingEntry', () => oldRoot.settingEntry],
    ['node.onPropChange', () => oldRoot.onPropChange(() => {})],
    ['nodeChildren.onInsert', () => oldRoot.children.onInsert(() => {})],
    ['history.savePoint', () => oldHistory.savePoint()],
    ['materialRegistry.register', () => materialRegistry.register({ componentName: 'StaleMaterial' })],
    ['componentMeta.onMetadataChange', () => materialMeta.onMetadataChange(() => {})],
    ['pluginContext.onDispose', () => oldContext.onDispose(() => {})],
    ['pluginEvent.on', () => oldContext.pluginEvent.on('generation:stale', () => {})],
  ]
  const acceptedStaleOperations = []
  for (const [label, operation] of staleOperations) {
    try {
      await operation()
      acceptedStaleOperations.push(label)
    } catch {
      // Expected: the previous generation stays permanently revoked.
    }
  }

  const newRegistry = engine.materials.registry
  engine.materials.createComponentMeta({ componentName: 'Page' })
  engine.project.load(createProjectSchema({ id: 'generation-two' }), true)
  const newDocument = engine.project.currentDocument
  const newMeta = engine.materials.createComponentMeta({ componentName: 'FreshMaterial' })
  const newContext = runtime.ctx

  assert.deepEqual(acceptedStaleOperations, [])
  assert.notStrictEqual(newDocument, oldDocument)
  assert.notStrictEqual(newRegistry, materialRegistry)
  assert.notStrictEqual(newMeta, materialMeta)
  assert.notStrictEqual(newContext, oldContext)
  assert.equal(engine.materials.getUsageCount('Page'), 1)
})

test('retired Document subscriptions cannot observe events from a replacement document', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  engine.project.load(createProjectSchema({ id: 'subscription-generation-one' }), true)
  await engine.init()

  const oldDocument = engine.project.currentDocument
  const deliveries = { add: 0, open: 0, remove: 0 }
  oldDocument.onReady(() => {
    deliveries.open += 1
  })
  oldDocument.onNodeAdd(() => {
    deliveries.add += 1
  })
  oldDocument.onNodeRemove(() => {
    deliveries.remove += 1
  })

  engine.project.load(createProjectSchema({ id: 'subscription-generation-two' }), true)
  const freshDocument = engine.project.currentDocument
  const freshNode = freshDocument.createNode({ componentName: 'Text', id: 'fresh-event-node', props: {} })
  freshDocument.root.children.insert(freshNode)
  freshDocument.removeNode(freshNode)

  assert.notStrictEqual(freshDocument, oldDocument)
  assert.deepEqual(deliveries, { add: 0, open: 0, remove: 0 })
})

test('Document subscriptions are scoped to their own document and declared payloads', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  engine.project.load(createProjectSchema({ id: 'subscription-document-a' }), true)
  const documentA = engine.project.currentDocument
  const documentB = engine.project.createDocument({
    docId: 'subscription-document-b',
    id: 'subscription-root-b',
    componentName: 'Page',
    props: {},
    children: [],
  })
  await engine.init()

  documentA.close()
  const deliveries = { added: [], opened: 0, removed: [] }
  documentA.onReady(() => {
    deliveries.opened += 1
  })
  documentA.onNodeAdd(node => {
    deliveries.added.push(node)
  })
  documentA.onNodeRemove(id => {
    deliveries.removed.push(id)
  })

  const foreignNode = documentB.createNode({ componentName: 'Text', id: 'foreign-event-node', props: {} })
  documentB.root.children.insert(foreignNode)
  documentB.open()
  documentB.removeNode(foreignNode)
  assert.deepEqual(deliveries, { added: [], opened: 0, removed: [] })

  const ownNode = documentA.createNode({ componentName: 'Text', id: 'own-event-node', props: {} })
  documentA.root.children.insert(ownNode)
  documentA.open()
  documentA.removeNode(ownNode)

  assert.deepEqual(deliveries, { added: [ownNode], opened: 1, removed: [ownNode.id] })
})

test('loading-state subscribers receive detached immutable values instead of the backing registry', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  let delivered
  const unsubscribe = engine.remote.loadingState.subscribe(states => {
    delivered = states
  })

  engine.remote.loadingState.startLoading('tracked', 'material', 'tracked')
  const deliveredState = delivered.get('tracked')
  assert.ok(Object.isFrozen(deliveredState))
  assert.throws(() => {
    deliveredState.progress = 99
  }, TypeError)
  assert.equal(engine.remote.loadingState.getState('tracked').progress, 0)

  await engine.destroy()
  unsubscribe()
  delivered.set('revived', {
    type: 'material',
    name: 'revived',
    status: core.LoadingStatus.LOADED,
  })
  assert.equal(engine.remote.loadingState.getState('revived'), undefined)
})

test('loading-state errors are detached at ingress and every snapshot boundary', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  engine.remote.loadingState.startLoading('failed', 'material', 'failed')
  const callerError = new TypeError('original failure')
  engine.remote.loadingState.markError('failed', callerError)

  callerError.message = 'mutated by caller'
  const first = engine.remote.loadingState.getState('failed')
  assert.throws(() => {
    first.error.message = 'mutated through snapshot'
  }, TypeError)
  const second = engine.remote.loadingState.getState('failed')

  assert.notStrictEqual(first.error, callerError)
  assert.notStrictEqual(second.error, first.error)
  assert.ok(Object.isFrozen(first.error))
  assert.equal(second.error.name, 'TypeError')
  assert.equal(second.error.message, 'original failure')

  const circular = new Error('circular')
  circular.cause = circular
  engine.remote.loadingState.markError('failed', circular)
  const circularSnapshot = engine.remote.loadingState.getState('failed').error
  assert.strictEqual(circularSnapshot.cause, circularSnapshot)
  assert.notStrictEqual(circularSnapshot, circular)
})

test('public document purge performs a complete removal before later engine teardown', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  engine.project.load(createProjectSchema({ id: 'purge-before-destroy' }), true)
  await engine.init()
  const document = engine.project.currentDocument

  document.purge()
  assert.equal(engine.project.getDocument(document.id), undefined)
  assert.equal(engine.project.currentDocument, undefined)
  assert.equal(document.root, null)
  assert.deepEqual(engine.project.export().componentsTree, [])

  await engine.destroy()
  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
})

test('guarded container views cannot revive terminal services and plugin arrays are detached', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  const settersMap = engine.setters.getSettersMap()
  const pluginsMap = engine.innerPlugins.pluginsMap
  const pluginSnapshot = engine.plugins.getAll()
  await engine.init()
  await engine.destroy()

  await captureFailure(() => settersMap.set('revived', { type: 'revived', component() {} }))
  await captureFailure(() => pluginsMap.clear())
  assert.throws(() => pluginSnapshot.push({ name: 'not-a-runtime' }), TypeError)

  assert.equal(engine.setters.getSetter('revived'), undefined)
  assert.equal(engine.plugins.size, 0)
})
