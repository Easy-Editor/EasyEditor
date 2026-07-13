import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { loadCore } from './helpers/kernel.mjs'

const settle = async operation => {
  try {
    return { status: 'fulfilled', value: await operation() }
  } catch (error) {
    return { error, status: 'rejected' }
  }
}

const createResource = name => ({
  data: { name },
  globalName: name,
  loadedAt: Date.now(),
  name,
  type: 'material',
  version: '1.0.0',
})

test('ready engine-owned services reject public teardown without mutating live state', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  t.after(async () => engine.destroy())

  engine.loadProject(createProjectSchema({ id: 'teardown-boundary' }), true)
  await engine.init()
  await engine.plugins.register(
    {
      name: 'teardown-proof-plugin',
      init() {},
    },
    { autoInit: true },
  )

  const materialRegistry = engine.materials.registry
  const pluginRuntime = engine.plugins.get('teardown-proof-plugin')
  const pluginContext = pluginRuntime.ctx
  const clipboardBodyCount = globalThis.document.body.children.length
  const clipboardRelease = engine.clipboard.injectCopyPaster(globalThis.document)
  t.after(clipboardRelease)

  engine.config.set('teardown-proof', 'retained')
  engine.editor.set('teardown-proof', 'retained')
  engine.setters.registerSetter('TeardownProof', { component() {} })
  const componentMeta = engine.materials.createComponentMeta({ componentName: 'TeardownProof', title: 'retained' })
  engine.remote.registry.register(createResource('teardown-proof'))
  engine.remote.loadingState.startLoading('teardown-proof', 'material', 'teardown-proof')
  engine.hotkey.bind('a', () => undefined)
  engine.eventBus.on('teardown-proof', () => undefined)
  engine.editor.eventBus.on('teardown-proof', () => undefined)
  const root = engine.project.currentDocument.root
  const document = engine.project.currentDocument
  const history = engine.project.currentDocument.history
  const historyState = history.getState()
  const historyListenerCount = history.emitter.listenerCount()
  engine.designer.selection.select(root.id)
  engine.designer.detecting.capture(root)
  engine.designer.activeTracker.track(root)
  engine.designer.dragon.addSensor({ sensorAvailable: false })

  assert.equal(core.runInternalLifecycleTeardown, undefined)
  assert.equal(core.claimEngineTeardownOwnership, undefined)
  assert.equal(document.removeInternal, undefined)
  assert.equal(document.purgeInternal, undefined)
  for (const service of [
    engine.designer,
    engine.project,
    history,
    history.emitter,
    engine.designer.selection,
    engine.designer.detecting,
    engine.designer.activeTracker,
    engine.designer.dragon,
    engine.designer.settingsManager,
    engine.materials,
    materialRegistry,
    componentMeta,
    engine.setters,
    engine.editor,
    engine.config,
    engine.clipboard,
    engine.agentCapabilities,
    engine.hotkey,
    engine.remote.loadingState,
    engine.remote.registry,
    engine.editor.eventBus,
    engine.eventBus,
    pluginRuntime,
    pluginContext,
  ]) {
    assert.equal(service.disposeInternal, undefined)
    assert.equal(service.purgeInternal, undefined)
    assert.equal(service.destroyInternal, undefined)
  }

  const designerListenerCount = engine.designer.dragon.emitter.listenerCount(core.DRAGON_EVENT.DRAGSTART)
  const attempts = await Promise.all([
    settle(() => engine.designer.purge()),
    settle(() => engine.project.dispose()),
    settle(() => history.destroy()),
    settle(() => history.emitter.dispose()),
    settle(() => engine.designer.selection.dispose()),
    settle(() => engine.designer.detecting.dispose()),
    settle(() => engine.designer.activeTracker.dispose()),
    settle(() => engine.designer.dragon.dispose()),
    settle(() => engine.designer.settingsManager.purge()),
    settle(() => engine.materials.dispose()),
    settle(() => materialRegistry.dispose()),
    settle(() => componentMeta.dispose()),
    settle(() => engine.setters.dispose()),
    settle(() => engine.editor.destroy()),
    settle(() => engine.config.dispose()),
    settle(() => engine.clipboard.dispose()),
    settle(() => engine.agentCapabilities.revokeAll('public-boundary-probe')),
    settle(() => engine.hotkey.dispose()),
    settle(() => engine.remote.loadingState.dispose()),
    settle(() => engine.remote.registry.dispose()),
    settle(() => engine.editor.eventBus.dispose()),
    settle(() => engine.eventBus.dispose()),
    settle(() => pluginRuntime.init()),
    settle(() => pluginRuntime.destroy()),
    settle(() => pluginRuntime.extend({ extend() {}, extendClass: {} })),
    settle(() => pluginRuntime.dispose()),
    settle(() => pluginContext.dispose()),
    settle(() => engine.plugins.pluginsMap.clear()),
    settle(() => engine.plugins.pluginContextMap.clear()),
  ])

  assert.deepEqual(
    attempts.map(attempt => attempt.status),
    Array(attempts.length).fill('rejected'),
  )
  for (const attempt of attempts) {
    assert.match(attempt.error.message, /engine-owned (service|child)|read-only/)
  }

  assert.equal(engine.config.get('teardown-proof'), 'retained')
  assert.equal(engine.project.currentDocument.root, root)
  assert.equal(history.getState(), historyState)
  assert.equal(history.emitter.listenerCount(), historyListenerCount)
  assert.deepEqual(engine.designer.selection.selected, [root.id])
  assert.equal(engine.designer.detecting.current, root)
  assert.equal(engine.designer.activeTracker.currentNode, root)
  assert.equal(engine.designer.dragon.sensors.length, 1)
  assert.ok(engine.designer.settingsManager.settings)
  assert.equal(engine.editor.get('teardown-proof'), 'retained')
  assert.ok(engine.setters.getSetter('TeardownProof'))
  assert.equal(materialRegistry.has('TeardownProof'), true)
  assert.equal(componentMeta.title, 'retained')
  assert.equal(engine.remote.registry.has('material', 'teardown-proof'), true)
  assert.equal(engine.remote.loadingState.getState('teardown-proof').status, core.LoadingStatus.LOADING)
  assert.equal(engine.hotkey.callBacks.a.length, 1)
  assert.equal(engine.eventBus.listenerCount('teardown-proof'), 1)
  assert.equal(engine.editor.eventBus.listenerCount('teardown-proof'), 1)
  assert.equal(engine.designer.dragon.emitter.listenerCount(core.DRAGON_EVENT.DRAGSTART), designerListenerCount)
  assert.equal(globalThis.document.body.children.length, clipboardBodyCount + 1)
  assert.equal(engine.plugins.get('teardown-proof-plugin'), pluginRuntime)
  assert.equal(pluginRuntime.isInited(), true)
  assert.equal(engine.plugins.pluginContextMap.get('teardown-proof-plugin'), pluginContext)
})

test('EngineInstance destroy uses the internal teardown boundary and services remain restartable', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  t.after(async () => engine.destroy())

  await engine.init()
  const materialRegistry = engine.materials.registry
  engine.config.set('generation-one', true)
  engine.editor.set('generation-one', true)
  engine.setters.registerSetter('GenerationOne', { component() {} })
  engine.materials.createComponentMeta({ componentName: 'GenerationOne' })
  engine.remote.registry.register(createResource('generation-one'))
  engine.remote.loadingState.startLoading('generation-one', 'material', 'generation-one')
  engine.hotkey.bind('a', () => undefined)
  engine.eventBus.on('generation-one', () => undefined)
  engine.editor.eventBus.on('generation-one', () => undefined)
  engine.clipboard.injectCopyPaster(globalThis.document)

  await engine.destroy()

  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(engine.config.get('generation-one'), undefined)
  assert.equal(engine.editor.get('generation-one'), undefined)
  assert.equal(engine.setters.getSetter('GenerationOne'), undefined)
  assert.equal(materialRegistry.has('GenerationOne'), false)
  assert.equal(engine.remote.registry.has('material', 'generation-one'), false)
  assert.equal(engine.remote.loadingState.getState('generation-one'), undefined)
  assert.deepEqual(engine.hotkey.callBacks, {})
  assert.equal(engine.eventBus.listenerCount(), 0)
  assert.equal(engine.editor.eventBus.listenerCount(), 0)
  assert.equal(globalThis.document.body.children.length, 0)

  await engine.init()

  engine.config.set('generation-two', true)
  engine.editor.set('generation-two', true)
  engine.setters.registerSetter('GenerationTwo', { component() {} })
  engine.materials.createComponentMeta({ componentName: 'GenerationTwo' })
  engine.remote.registry.register(createResource('generation-two'))
  engine.remote.loadingState.startLoading('generation-two', 'material', 'generation-two')
  engine.eventBus.on('generation-two', () => undefined)

  assert.equal(engine.lifecycleState, 'ready')
  assert.equal(engine.config.get('generation-two'), true)
  assert.equal(engine.editor.get('generation-two'), true)
  assert.ok(engine.setters.getSetter('GenerationTwo'))
  assert.equal(engine.materials.registry.has('GenerationTwo'), true)
  assert.equal(engine.remote.registry.has('material', 'generation-two'), true)
  assert.equal(engine.remote.loadingState.getState('generation-two').status, core.LoadingStatus.LOADING)
  assert.equal(engine.eventBus.listenerCount('generation-two'), 1)
})

test('a mounted Simulator is an engine-owned generation resource', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(async () => engine.destroy())
  await engine.init()

  const simulator = new core.Simulator(engine.project, engine.designer)
  let rendererDisposals = 0
  simulator.connect(
    {
      dispose() {
        rendererDisposals += 1
      },
      isSimulatorRenderer: true,
    },
    () => simulator.get('probe'),
  )
  engine.project.mountSimulator(simulator)

  const teardownAttempts = await Promise.all([settle(() => simulator.purge()), settle(() => simulator.dispose())])
  assert.deepEqual(
    teardownAttempts.map(attempt => attempt.status),
    ['rejected', 'rejected'],
  )
  teardownAttempts.forEach(attempt => assert.match(attempt.error.message, /engine-owned service/))
  assert.strictEqual(engine.project.simulator, simulator)
  assert.equal(rendererDisposals, 0)

  await engine.destroy()

  assert.equal(engine.project.simulator, null)
  assert.equal(rendererDisposals, 1)
  assert.throws(() => simulator.set('probe', 'zombie'), /disposed/)

  await engine.init()
  assert.throws(() => engine.project.mountSimulator(simulator), /disposed/)
  assert.equal(engine.project.simulator, null)
})
