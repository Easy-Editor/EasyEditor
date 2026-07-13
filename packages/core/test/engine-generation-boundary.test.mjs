import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

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
  const runtime = engine.plugins.get('generation-plugin')
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
  const pluginsMap = engine.plugins.pluginsMap
  const pluginSnapshot = engine.plugins.getAll()
  await engine.init()
  await engine.destroy()

  await captureFailure(() => settersMap.set('revived', { type: 'revived', component() {} }))
  await captureFailure(() => pluginsMap.clear())
  pluginSnapshot.push({ name: 'not-a-runtime' })

  assert.equal(engine.setters.getSetter('revived'), undefined)
  assert.equal(engine.plugins.size, 0)
})
