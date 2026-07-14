import assert from 'node:assert/strict'
import test from 'node:test'
import { reaction } from 'mobx'
import { loadCore } from './helpers/kernel.mjs'

const createDeferred = () => {
  let resolve
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const settle = async action => {
  try {
    return { status: 'fulfilled', value: await action() }
  } catch (error) {
    return { error, status: 'rejected' }
  }
}

test('destroy rejects inside an active transaction without breaking rollback or a later destroy', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  await engine.init()
  engine.project.load(
    {
      id: 'transaction-lifecycle-gate',
      version: '1.0.0',
      componentsMap: [],
      componentsTree: [{ id: 'root', componentName: 'Page', props: { title: 'before' }, children: [] }],
    },
    true,
  )
  const root = engine.project.currentDocument.root
  let nestedDestroyError

  assert.throws(
    () =>
      engine.transactions.runSync(() => {
        root.setPropValue('title', 'during')
        try {
          engine.destroy()
        } catch (error) {
          nestedDestroyError = error
        }
        throw new Error('force rollback')
      }),
    /force rollback/,
  )
  assert.equal(nestedDestroyError?.name, 'LifecycleReentrancyError')
  assert.match(nestedDestroyError?.message ?? '', /transaction is active/)
  assert.equal(engine.lifecycleState, 'ready')
  assert.equal(root.getPropValue('title'), 'before')

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
})

test('project-owned cleanup callbacks cannot reenter engine lifecycle during unload', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  await engine.init()
  engine.loadProject(
    {
      id: 'cleanup-lifecycle-gate',
      version: '1.0.0',
      componentsMap: [],
      componentsTree: [{ id: 'root', componentName: 'Page', props: {}, children: [] }],
    },
    true,
  )

  const lifecycleErrors = []
  core.registerTestSettingTopEntryDisposer(engine.project.currentDocument.root.settingEntry, () => {
    for (const request of [() => engine.destroy(), () => engine.init()]) {
      try {
        request()
      } catch (error) {
        lifecycleErrors.push(error)
      }
    }
  })

  engine.unloadProject()

  assert.deepEqual(
    lifecycleErrors.map(error => error?.name),
    ['LifecycleReentrancyError', 'LifecycleReentrancyError'],
  )
  assert.equal(engine.lifecycleState, 'ready')
  assert.equal(engine.project.documents.length, 0)

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
})

test('host project mutations keep lifecycle closed through MobX reaction flushes', async () => {
  const core = await loadCore()
  const projectSchema = (id, title = 'before') => ({
    id,
    version: '1.0.0',
    componentsMap: [],
    componentsTree: [{ docId: `${id}-doc`, id: `${id}-root`, componentName: 'Page', props: { title }, children: [] }],
  })
  const scenarios = [
    {
      name: 'loadProject',
      observe: engine => engine.project.documents[0],
      prepare: engine => engine.loadProject(projectSchema('load-before'), true),
      mutate: engine => engine.loadProject(projectSchema('load-after'), true),
      verify: engine => assert.equal(engine.project.currentDocument.id, 'load-after-doc'),
    },
    {
      name: 'unloadProject',
      observe: engine => engine.project.documents.length,
      prepare: engine => engine.loadProject(projectSchema('unload-before'), true),
      mutate: engine => engine.unloadProject(),
      verify: engine => assert.equal(engine.project.documents.length, 0),
    },
    {
      name: 'undo',
      observe: engine => engine.project.currentDocument.root.getPropValue('title'),
      prepare: engine => {
        engine.loadProject(projectSchema('undo-before'), true)
        engine.commands.execute({
          type: 'updateProps',
          nodeId: engine.project.currentDocument.root.id,
          props: { title: 'after' },
        })
      },
      mutate: engine => engine.undo(),
      verify: engine => assert.equal(engine.project.currentDocument.root.getPropValue('title'), 'before'),
    },
    {
      name: 'redo',
      observe: engine => engine.project.currentDocument.root.getPropValue('title'),
      prepare: engine => {
        engine.loadProject(projectSchema('redo-before'), true)
        engine.commands.execute({
          type: 'updateProps',
          nodeId: engine.project.currentDocument.root.id,
          props: { title: 'after' },
        })
        engine.undo()
      },
      mutate: engine => engine.redo(),
      verify: engine => assert.equal(engine.project.currentDocument.root.getPropValue('title'), 'after'),
    },
  ]

  for (const scenario of scenarios) {
    const engine = core.createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
    await engine.init()
    scenario.prepare(engine)
    let effects = 0
    let lifecycleError
    const nestedMutationErrors = []
    let stateInside
    const dispose = reaction(
      () => scenario.observe(engine),
      () => {
        effects += 1
        stateInside = engine.lifecycleState
        try {
          engine.destroy()
        } catch (error) {
          lifecycleError = error
        }
        for (const request of [
          () => engine.unloadProject(),
          () =>
            engine.commands.execute({
              type: 'updateProps',
              nodeId: 'reaction-reentry',
              props: { title: 'nested' },
            }),
        ]) {
          try {
            request()
          } catch (error) {
            nestedMutationErrors.push(error)
          }
        }
      },
    )

    scenario.mutate(engine)
    dispose()

    assert.equal(effects, 1, `${scenario.name}: reaction must observe the committed mutation once`)
    assert.equal(lifecycleError?.name, 'LifecycleReentrancyError', `${scenario.name}: lifecycle must reject promptly`)
    assert.deepEqual(
      nestedMutationErrors.map(error => error?.name),
      ['LifecycleReentrancyError', 'LifecycleReentrancyError'],
      `${scenario.name}: nested composition mutations must reject promptly`,
    )
    assert.equal(stateInside, 'ready', `${scenario.name}: callback must not start disposal`)
    assert.equal(engine.lifecycleState, 'ready', `${scenario.name}: outer mutation must preserve the generation`)
    scenario.verify(engine)

    await engine.destroy()
    assert.equal(engine.lifecycleState, 'disposed')
  }
})

test('external lifecycleState assignment cannot reopen a disposed engine mutation barrier', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  await engine.destroy()

  const assignment = await settle(() => {
    engine.lifecycleState = 'ready'
  })
  const mutation = await settle(() => engine.config.set('revived-through-public-state', true))

  assert.deepEqual(
    {
      assignment: assignment.status,
      lifecycleState: engine.lifecycleState,
      mutation: mutation.status,
      revived: engine.config.get('revived-through-public-state'),
    },
    {
      assignment: 'rejected',
      lifecycleState: 'disposed',
      mutation: 'rejected',
      revived: undefined,
    },
  )
})

test('runtime-private lifecycle state resists backing-field writes, method calls, and own-property shadows', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  await engine.destroy()

  engine.lifecycleStateValue = 'ready'
  const transition = await settle(() => engine.transitionLifecycle('ready'))
  const shadow = await settle(() => Object.defineProperty(engine, 'lifecycleState', { value: 'ready' }))
  const mutation = await settle(() => engine.config.set('revived-through-runtime-state', true))

  assert.deepEqual(
    {
      lifecycleState: engine.lifecycleState,
      mutation: mutation.status,
      revived: engine.config.get('revived-through-runtime-state'),
      shadow: shadow.status,
      transition: transition.status,
    },
    {
      lifecycleState: 'disposed',
      mutation: 'rejected',
      revived: undefined,
      shadow: 'rejected',
      transition: 'rejected',
    },
  )
})

test('plugin writes to legacy lifecycle slot names are denied without redirecting initialization or teardown', async t => {
  const core = await loadCore()
  let adapterDisposeCalls = 0
  const engine = core.createEngine({
    hostWindow: null,
    remoteAdapter: {
      async dispose() {
        adapterDisposeCalls += 1
      },
      async init() {},
    },
    trustPolicy: 'legacyTrusted',
  })
  t.after(async () => engine.destroy())
  const marker = Object.freeze({ forged: true })
  let writes
  await engine.plugins.register({
    name: 'lifecycle-slot-tamper',
    init(ctx) {
      writes = [
        'initScope',
        'initPromise',
        'destroyPromise',
        'remoteAdapterActive',
        'restrictedPluginBoundaryRelease',
      ].map(key => Reflect.set(ctx.engine, key, marker))
    },
  })

  await engine.init()
  assert.deepEqual(writes, [false, false, false, false, false])
  assert.equal(engine.initScope, undefined)
  await engine.destroy()
  assert.equal(adapterDisposeCalls, 1)
  assert.equal(engine.lifecycleState, 'disposed')
})

test('Plugins.toProxy returns one canonical finite lifecycle-guarded identity', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  const prefetchedProxy = engine.innerPlugins.toProxy()
  const repeatedProxy = engine.innerPlugins.toProxy()

  await engine.init()
  await engine.destroy()
  const registration = await settle(() =>
    prefetchedProxy.register({
      name: 'proxy-revival',
      init() {},
    }),
  )

  assert.deepEqual(
    {
      facadeHidesProxyFactory: prefetchedProxy.toProxy === undefined,
      canonicalPrefetched: prefetchedProxy === engine.plugins,
      canonicalRepeated: repeatedProxy === engine.plugins,
      registered: engine.plugins.has('proxy-revival'),
      registration: registration.status,
    },
    {
      facadeHidesProxyFactory: true,
      canonicalPrefetched: true,
      canonicalRepeated: true,
      registered: false,
      registration: 'rejected',
    },
  )
})

test('EventBus chaining retains the guarded facade instead of leaking its raw EventEmitter', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  const listener = () => {}
  const handles = [
    engine.eventBus.addListener('chain-probe', listener),
    engine.eventBus.removeListener('chain-probe', listener),
    engine.eventBus.setMaxListeners(25),
  ]
  const cleanup = await settle(() => engine.eventBus.removeAllListeners('chain-probe'))
  const retainedHandle = handles[0]

  await engine.destroy()
  let deliveries = 0
  const registration = await settle(() =>
    retainedHandle.addListener('retained-revival', () => {
      deliveries += 1
    }),
  )
  retainedHandle.emit('retained-revival')

  assert.deepEqual(
    {
      canonicalHandles: handles.map(handle => handle === engine.eventBus),
      cleanup: cleanup.status,
      deliveries,
      registration: registration.status,
    },
    {
      canonicalHandles: [true, true, true],
      cleanup: 'rejected',
      deliveries: 0,
      registration: 'rejected',
    },
  )
})

test('async autoInit registration blocks a cross-direction destroy until an explicit retry', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  const oldInitStarted = createDeferred()
  const releaseOldInit = createDeferred()
  let initCalls = 0

  const pendingRegistration = engine.plugins.register(
    {
      name: 'stale-registration',
      async init() {
        initCalls += 1
        if (initCalls === 1) {
          oldInitStarted.resolve()
          await releaseOldInit.promise
        }
      },
    },
    { autoInit: true },
  )
  const registrationOutcome = settle(() => pendingRegistration)
  await oldInitStarted.promise
  const conflictingDestruction = await settle(() => engine.destroy())
  assert.equal(conflictingDestruction.status, 'rejected')
  assert.equal(conflictingDestruction.error?.name, 'LifecycleReentrancyError')
  assert.equal(engine.lifecycleState, 'ready')
  releaseOldInit.resolve()
  const outcome = await registrationOutcome

  assert.equal(outcome.status, 'fulfilled')
  assert.equal(engine.plugins.has('stale-registration'), true)

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  await engine.init()

  assert.deepEqual(
    {
      initCalls,
      registered: engine.plugins.has('stale-registration'),
      registration: outcome.status,
    },
    {
      initCalls: 2,
      registered: true,
      registration: 'fulfilled',
    },
  )
})

test('async plugin init blocks a cross-direction destroy until an explicit retry', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  const oldInitStarted = createDeferred()
  const releaseOldInit = createDeferred()
  let initCalls = 0
  await engine.plugins.register({
    name: 'stale-init',
    async init() {
      initCalls += 1
      if (initCalls === 1) {
        oldInitStarted.resolve()
        await releaseOldInit.promise
      }
    },
  })

  const pendingInit = engine.innerPlugins.init()
  const initOutcome = settle(() => pendingInit)
  await oldInitStarted.promise
  const conflictingDestruction = await settle(() => engine.destroy())
  assert.equal(conflictingDestruction.status, 'rejected')
  assert.equal(conflictingDestruction.error?.name, 'LifecycleReentrancyError')
  assert.equal(engine.lifecycleState, 'ready')
  releaseOldInit.resolve()
  const outcome = await initOutcome

  assert.equal(outcome.status, 'fulfilled')
  assert.equal(engine.innerPlugins.get('stale-init')?.isInited(), true)

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  await engine.init()

  assert.deepEqual(
    {
      currentGenerationInited: engine.innerPlugins.get('stale-init')?.isInited(),
      initCalls,
      oldGenerationInit: outcome.status,
    },
    {
      currentGenerationInited: true,
      initCalls: 2,
      oldGenerationInit: 'fulfilled',
    },
  )
})

test('a disposed plugin context revokes retained engine capabilities across restart', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  let oldContext
  let deliveries = 0
  let rejectLateRegistryPromise
  let rejectRegistryPromise
  const arrayCapability = [engine.project]
  const promiseCapability = Promise.resolve(engine.remote.registry)
  const rejectedPromiseCapability = new Promise((_, reject) => {
    rejectRegistryPromise = reject
  })
  const lateRejectedPromiseCapability = new Promise((_, reject) => {
    rejectLateRegistryPromise = reject
  })
  engine.config.set('array-capability', arrayCapability)
  engine.config.set('promise-capability', { promise: promiseCapability })
  engine.config.set('rejected-promise-capability', { promise: rejectedPromiseCapability })
  engine.config.set('late-rejected-promise-capability', { promise: lateRejectedPromiseCapability })
  await engine.plugins.register({
    name: 'retained-context',
    init(ctx) {
      oldContext ||= ctx
    },
  })
  await engine.init()
  const retainedConfig = oldContext.config
  const retainedPlugins = oldContext.plugins
  const retainedEvent = oldContext.event
  const retainedEngineConfig = oldContext.engine.config
  const retainedEngineProject = oldContext.engine.project
  const retainedEngineMaterials = oldContext.engine.materials
  const retainedEngineRegistry = oldContext.engine.remote.registry
  const retainedDescriptorProject = Object.getOwnPropertyDescriptor(oldContext.engine, 'project').value
  const retainedArray = oldContext.config.get('array-capability')
  const retainedRegistryPromise = oldContext.config.get('promise-capability').promise
  const retainedRejectedRegistryPromise = oldContext.config.get('rejected-promise-capability').promise
  const retainedLateRejectedRegistryPromise = oldContext.config.get('late-rejected-promise-capability').promise
  assert.strictEqual(retainedEngineConfig, retainedConfig)
  assert.notStrictEqual(retainedEngineProject, engine.project)
  assert.notStrictEqual(retainedEngineMaterials, engine.materials)
  assert.notStrictEqual(retainedDescriptorProject, engine.project)
  assert.strictEqual(retainedDescriptorProject, retainedEngineProject)
  assert.notStrictEqual(retainedEngineRegistry, engine.remote.registry)
  assert.equal(Array.isArray(retainedArray), true)
  assert.notStrictEqual(retainedArray[0], engine.project)
  assert.strictEqual(Object.getOwnPropertyDescriptor(retainedArray, '0').value, retainedArray[0])
  assert.equal(Reflect.defineProperty(retainedArray, 'locked', { configurable: false, value: engine.project }), false)
  assert.equal(Object.hasOwn(arrayCapability, 'locked'), false)
  assert.notStrictEqual(retainedRegistryPromise, promiseCapability)
  rejectRegistryPromise(engine.remote.registry)
  const retainedRejectedRegistry = await retainedRejectedRegistryPromise.catch(reason => reason)
  assert.notStrictEqual(retainedRejectedRegistry, engine.remote.registry)
  assert.equal(Reflect.set(oldContext.engine, 'project', engine.project), false)
  await engine.destroy()
  await engine.init()
  rejectLateRegistryPromise(engine.remote.registry)
  const currentListener = engine.eventBus.on('retained-context:event', () => {
    deliveries += 1
  })
  t.after(currentListener)

  const attempts = await Promise.all([
    settle(() => retainedConfig.set('stale-context-write', true)),
    settle(() =>
      retainedPlugins.register({
        name: 'stale-context-plugin',
        init() {},
      }),
    ),
    settle(() => retainedEvent.emit('retained-context:event')),
    settle(() => retainedEngineProject.get('id')),
    settle(() => retainedEngineMaterials.editor),
    settle(() => retainedEngineRegistry.has('material', 'stale-context-resource')),
    settle(() => retainedDescriptorProject.get('id')),
    settle(() => retainedArray[0].get('id')),
    settle(async () => (await retainedRegistryPromise).has('material', 'stale-promise-resource')),
    settle(() => retainedRejectedRegistry.has('material', 'stale-rejected-promise-resource')),
    settle(async () => {
      try {
        await retainedLateRejectedRegistryPromise
        throw new Error('late rejected capability promise unexpectedly fulfilled')
      } catch (reason) {
        return reason.has('material', 'stale-late-rejected-promise-resource')
      }
    }),
    settle(() => {
      oldContext.config = engine.config
    }),
    settle(() => Object.defineProperty(oldContext, 'dispose', { value() {} })),
  ])

  assert.deepEqual(
    {
      attempts: attempts.map(outcome => outcome.status),
      config: engine.config.get('stale-context-write'),
      deliveries,
      registered: engine.plugins.has('stale-context-plugin'),
    },
    {
      attempts: [
        'rejected',
        'rejected',
        'rejected',
        'rejected',
        'rejected',
        'rejected',
        'rejected',
        'rejected',
        'rejected',
        'rejected',
        'rejected',
        'rejected',
        'rejected',
      ],
      config: undefined,
      deliveries: 0,
      registered: false,
    },
  )
})

test('an async plugin body completes before an explicitly retried generation transition', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  const oldInitStarted = createDeferred()
  const releaseOldInit = createDeferred()
  let initCalls = 0
  await engine.plugins.register({
    name: 'stale-context-write',
    async init(ctx) {
      initCalls += 1
      if (initCalls === 1) {
        oldInitStarted.resolve()
        await releaseOldInit.promise
        ctx.config.set('stale-generation-write', 'leaked')
      }
    },
  })
  const pendingInit = engine.innerPlugins.init()
  const oldOutcome = settle(() => pendingInit)
  await oldInitStarted.promise
  const conflictingDestruction = await settle(() => engine.destroy())
  assert.equal(conflictingDestruction.status, 'rejected')
  assert.equal(conflictingDestruction.error?.name, 'LifecycleReentrancyError')
  assert.equal(engine.lifecycleState, 'created')
  releaseOldInit.resolve()
  const completedInit = await oldOutcome

  assert.equal(completedInit.status, 'fulfilled')
  assert.equal(engine.config.get('stale-generation-write'), 'leaked')

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  await engine.init()

  assert.deepEqual(
    {
      currentInited: engine.innerPlugins.get('stale-context-write')?.isInited(),
      initCalls,
      leaked: engine.config.get('stale-generation-write'),
      oldInit: (await oldOutcome).status,
    },
    {
      currentInited: true,
      initCalls: 2,
      leaked: undefined,
      oldInit: 'fulfilled',
    },
  )
})

test('async plugin extension blocks a cross-direction destroy until an explicit retry', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  const oldExtendStarted = createDeferred()
  const releaseOldExtend = createDeferred()
  let extendCalls = 0
  await engine.plugins.register({
    name: 'stale-extension',
    async extend() {
      extendCalls += 1
      if (extendCalls === 1) {
        oldExtendStarted.resolve()
        await releaseOldExtend.promise
      }
    },
    init() {},
  })
  const runtime = engine.innerPlugins.get('stale-extension')

  const pendingExtension = engine.innerPlugins.extend()
  const extensionOutcome = settle(() => pendingExtension)
  await oldExtendStarted.promise
  const conflictingDestruction = await settle(() => engine.destroy())
  assert.equal(conflictingDestruction.status, 'rejected')
  assert.equal(conflictingDestruction.error?.name, 'LifecycleReentrancyError')
  assert.equal(engine.lifecycleState, 'ready')
  releaseOldExtend.resolve()
  const outcome = await extensionOutcome

  assert.equal(outcome.status, 'fulfilled')
  assert.equal(runtime.isExtended(), true)

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  await engine.init()

  assert.deepEqual(
    {
      currentGenerationExtended: runtime.isExtended(),
      extendCalls,
      oldGenerationExtension: outcome.status,
    },
    {
      currentGenerationExtended: true,
      extendCalls: 1,
      oldGenerationExtension: 'fulfilled',
    },
  )
})

test('same-generation PluginRuntime init and destroy callers join one hook execution', async t => {
  const core = await loadCore()
  const plugins = new core.Plugins()
  t.after(async () => plugins.dispose())
  const initStarted = createDeferred()
  const releaseInit = createDeferred()
  const destroyStarted = createDeferred()
  const releaseDestroy = createDeferred()
  let initCalls = 0
  let destroyCalls = 0
  await plugins.register({
    name: 'joined-runtime',
    async init() {
      initCalls += 1
      initStarted.resolve()
      await releaseInit.promise
    },
    async destroy() {
      destroyCalls += 1
      destroyStarted.resolve()
      await releaseDestroy.promise
    },
  })
  const runtime = plugins.get('joined-runtime')

  const initA = runtime.init()
  const initB = runtime.init()
  await initStarted.promise
  releaseInit.resolve()
  await Promise.all([initA, initB])
  const context = runtime.ctx
  context.onDispose(() => {})

  const destroyA = runtime.destroy()
  const destroyB = runtime.destroy()
  await destroyStarted.promise
  releaseDestroy.resolve()
  await Promise.all([destroyA, destroyB])

  assert.deepEqual({ destroyCalls, initCalls }, { destroyCalls: 1, initCalls: 1 })
})

test('PluginRuntime destroy waits for pending init before a later init can start', async t => {
  const core = await loadCore()
  const plugins = new core.Plugins()
  t.after(async () => plugins.dispose())
  const oldInitStarted = createDeferred()
  const releaseOldInit = createDeferred()
  let initCalls = 0
  await plugins.register({
    name: 'runtime-init-destroy-race',
    async init() {
      initCalls += 1
      if (initCalls === 1) {
        oldInitStarted.resolve()
        await releaseOldInit.promise
      }
    },
  })
  const runtime = plugins.get('runtime-init-destroy-race')

  const oldInit = settle(() => runtime.init())
  await oldInitStarted.promise
  let destroySettled = false
  const destruction = settle(() => runtime.destroy()).then(outcome => {
    destroySettled = true
    return outcome
  })
  const laterInit = settle(() => runtime.init())
  await new Promise(resolve => setImmediate(resolve))
  const stateBeforeRelease = { destroySettled, initCalls }

  releaseOldInit.resolve()
  const [oldInitOutcome, destructionOutcome, laterInitOutcome] = await Promise.all([oldInit, destruction, laterInit])

  assert.deepEqual(
    {
      destruction: destructionOutcome.status,
      inited: runtime.isInited(),
      laterInit: laterInitOutcome.status,
      oldInit: oldInitOutcome.status,
      stateBeforeRelease,
    },
    {
      destruction: 'fulfilled',
      inited: true,
      laterInit: 'fulfilled',
      oldInit: 'rejected',
      stateBeforeRelease: { destroySettled: false, initCalls: 1 },
    },
  )
})

test('same-generation Plugins manager init and destroy callers join one lifecycle pass', async t => {
  const core = await loadCore()
  const plugins = new core.Plugins()
  t.after(async () => plugins.dispose())
  const initStarted = createDeferred()
  const releaseInit = createDeferred()
  const destroyStarted = createDeferred()
  const releaseDestroy = createDeferred()
  let initCalls = 0
  let destroyCalls = 0
  await plugins.register({
    name: 'joined-manager',
    async init() {
      initCalls += 1
      initStarted.resolve()
      await releaseInit.promise
    },
    async destroy() {
      destroyCalls += 1
      destroyStarted.resolve()
      await releaseDestroy.promise
    },
  })

  const initA = plugins.init()
  const initB = plugins.init()
  await initStarted.promise
  releaseInit.resolve()
  await Promise.all([initA, initB])

  const destroyA = plugins.destroy()
  const destroyB = plugins.destroy()
  await destroyStarted.promise
  releaseDestroy.resolve()
  await Promise.all([destroyA, destroyB])

  assert.deepEqual({ destroyCalls, initCalls }, { destroyCalls: 1, initCalls: 1 })
})

test('same-name autoInit registration is linearized without array ghosts', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  const firstStarted = createDeferred()
  const releaseFirst = createDeferred()
  let starts = 0
  const createPlugin = label => ({
    name: 'linearized-registration',
    async init() {
      starts += 1
      if (label === 'first') {
        firstStarted.resolve()
        await releaseFirst.promise
      }
    },
  })

  const first = settle(() => engine.plugins.register(createPlugin('first'), { autoInit: true }))
  await firstStarted.promise
  const second = settle(() => engine.plugins.register(createPlugin('second'), { autoInit: true }))
  releaseFirst.resolve()
  const outcomes = await Promise.all([first, second])

  assert.deepEqual(
    {
      arrayCount: engine.innerPlugins.getAll().filter(plugin => plugin.name === 'linearized-registration').length,
      mapSize: engine.innerPlugins.pluginsMap.size,
      outcomes: outcomes.map(outcome => outcome.status).sort(),
      starts,
    },
    {
      arrayCount: 1,
      mapSize: 1,
      outcomes: ['fulfilled', 'rejected'],
      starts: 1,
    },
  )
})

test('a failed autoInit override leaves the previous plugin active and registered', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  let originalDestroyCalls = 0
  await engine.plugins.register(
    {
      name: 'atomic-override',
      destroy() {
        originalDestroyCalls += 1
      },
      init() {},
    },
    { autoInit: true },
  )
  const original = engine.innerPlugins.get('atomic-override')

  const outcome = await settle(() =>
    engine.plugins.register(
      {
        name: 'atomic-override',
        init() {
          throw new Error('candidate init failed')
        },
      },
      { autoInit: true, override: true },
    ),
  )

  assert.deepEqual(
    {
      inited: original.isInited(),
      originalDestroyCalls,
      outcome: outcome.status,
      retained: engine.innerPlugins.get('atomic-override') === original,
    },
    { inited: true, originalDestroyCalls: 0, outcome: 'rejected', retained: true },
  )
})

test('an autoInit replacement sees itself without publishing before atomic commit', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()
  await engine.plugins.register({ name: 'self-visible-override', marker: 'original', init() {} }, { autoInit: true })
  let sawCandidate = false
  const candidate = {
    name: 'self-visible-override',
    marker: 'candidate',
    exports: () => ({ marker: 'candidate' }),
    init(ctx) {
      sawCandidate = ctx.plugins.getExports(candidate.name)?.marker === 'candidate'
    },
  }

  await engine.plugins.register(candidate, { autoInit: true, override: true })

  assert.equal(sawCandidate, true)
  assert.notEqual(engine.innerPlugins.get('self-visible-override').config, candidate)
  assert.equal(engine.innerPlugins.get('self-visible-override').config.marker, 'candidate')
  assert.equal(engine.innerPlugins.getAll().filter(plugin => plugin.name === candidate.name).length, 1)
})

test('same-generation Plugins.extend callers join one extension preparation', async t => {
  const core = await loadCore()
  const plugins = new core.Plugins()
  t.after(async () => plugins.dispose())
  const extendStarted = createDeferred()
  const releaseExtend = createDeferred()
  let extendCalls = 0
  await plugins.register({
    name: 'joined-extension',
    async extend() {
      extendCalls += 1
      extendStarted.resolve()
      await releaseExtend.promise
    },
    init() {},
  })

  const first = plugins.extend()
  const second = plugins.extend()
  await extendStarted.promise
  releaseExtend.resolve()
  await Promise.all([first, second])

  assert.equal(extendCalls, 1)
})

test('plugin manager destroy prevents a pending autoInit registration from publishing afterward', async t => {
  const core = await loadCore()
  const plugins = new core.Plugins()
  t.after(async () => plugins.dispose())
  await plugins.init()
  const initStarted = createDeferred()
  const releaseInit = createDeferred()

  const registration = settle(() =>
    plugins.register(
      {
        name: 'pending-registration-at-destroy',
        async init() {
          initStarted.resolve()
          await releaseInit.promise
        },
      },
      { autoInit: true },
    ),
  )
  await initStarted.promise

  let destroySettled = false
  const destruction = settle(() => plugins.destroy()).then(outcome => {
    destroySettled = true
    return outcome
  })
  await new Promise(resolve => setImmediate(resolve))
  const pendingBeforeRelease = !destroySettled
  releaseInit.resolve()
  const [registrationOutcome, destructionOutcome] = await Promise.all([registration, destruction])

  assert.deepEqual(
    {
      destruction: destructionOutcome.status,
      pendingBeforeRelease,
      registered: plugins.has('pending-registration-at-destroy'),
      registration: registrationOutcome.status,
    },
    { destruction: 'fulfilled', pendingBeforeRelease: true, registered: false, registration: 'rejected' },
  )
})

test('plugin manager destroy waits for pending extension and prevents its late apply', async t => {
  const core = await loadCore()
  const plugins = new core.Plugins()
  t.after(async () => plugins.dispose())
  const extendStarted = createDeferred()
  const releaseExtend = createDeferred()
  const propertyName = 'mustNotApplyAfterPluginManagerDestroy'
  await plugins.register({
    name: 'pending-extension-at-destroy',
    extensionFingerprint: 'pending-extension-at-destroy:v1',
    async extend(api) {
      extendStarted.resolve()
      await releaseExtend.promise
      api.extend('Node', {
        [propertyName]() {
          return true
        },
      })
    },
    init() {},
  })
  const runtime = plugins.get('pending-extension-at-destroy')

  const extension = settle(() => plugins.extend())
  await extendStarted.promise
  let destroySettled = false
  const destruction = settle(() => plugins.destroy()).then(outcome => {
    destroySettled = true
    return outcome
  })
  await new Promise(resolve => setImmediate(resolve))
  const pendingBeforeRelease = !destroySettled
  releaseExtend.resolve()
  const [extensionOutcome, destructionOutcome] = await Promise.all([extension, destruction])

  assert.deepEqual(
    {
      applied: Object.hasOwn(core.Node.prototype, propertyName),
      destruction: destructionOutcome.status,
      extended: runtime.isExtended(),
      extension: extensionOutcome.status,
      pendingBeforeRelease,
    },
    { applied: false, destruction: 'fulfilled', extended: false, extension: 'rejected', pendingBeforeRelease: true },
  )
})

test('registration started during plugin manager destroy cannot escape the destroy snapshot', async t => {
  const core = await loadCore()
  const plugins = new core.Plugins()
  t.after(async () => plugins.dispose())
  await plugins.init()
  const destroyStarted = createDeferred()
  const releaseDestroy = createDeferred()
  await plugins.register(
    {
      name: 'destroy-snapshot-anchor',
      init() {},
      async destroy() {
        destroyStarted.resolve()
        await releaseDestroy.promise
      },
    },
    { autoInit: true },
  )

  const destruction = settle(() => plugins.destroy())
  await destroyStarted.promise
  const registration = settle(() =>
    plugins.register({
      name: 'destroy-snapshot-escape',
      init() {},
    }),
  )
  releaseDestroy.resolve()
  const [registrationOutcome, destructionOutcome] = await Promise.all([registration, destruction])

  assert.deepEqual(
    {
      destruction: destructionOutcome.status,
      registered: plugins.has('destroy-snapshot-escape'),
      registration: registrationOutcome.status,
    },
    { destruction: 'fulfilled', registered: false, registration: 'rejected' },
  )
})

test('a plugin registered while engine initialization is in flight is initialized before ready', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  const anchorStarted = createDeferred()
  const releaseAnchor = createDeferred()
  await engine.plugins.register({
    name: 'initialization-snapshot-anchor',
    async init() {
      anchorStarted.resolve()
      await releaseAnchor.promise
    },
  })

  const initialization = engine.init()
  await anchorStarted.promise
  let lateInitCalls = 0
  await engine.plugins.register({
    name: 'registered-during-initialization',
    init() {
      lateInitCalls += 1
    },
  })
  releaseAnchor.resolve()
  await initialization

  assert.deepEqual(
    {
      inited: engine.innerPlugins.get('registered-during-initialization').isInited(),
      lateInitCalls,
      lifecycleState: engine.lifecycleState,
    },
    { inited: true, lateInitCalls: 1, lifecycleState: 'ready' },
  )
})

test('same-generation PluginRuntime.extend callers join one extension hook', async t => {
  const core = await loadCore()
  const plugins = new core.Plugins()
  t.after(async () => plugins.dispose())
  const extendStarted = createDeferred()
  const releaseExtend = createDeferred()
  let extendCalls = 0
  await plugins.register({
    name: 'joined-runtime-extension',
    async extend() {
      extendCalls += 1
      extendStarted.resolve()
      await releaseExtend.promise
    },
    init() {},
  })
  const runtime = plugins.get('joined-runtime-extension')
  const extensionApi = { extend() {}, extendClass: {} }

  const first = runtime.extend(extensionApi)
  const second = runtime.extend(extensionApi)
  await extendStarted.promise
  releaseExtend.resolve()
  await Promise.all([first, second])

  assert.equal(extendCalls, 1)
})

test('a newly registered PluginRuntime exposes explicit false lifecycle flags', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.plugins.register({ name: 'explicit-runtime-flags', init() {} })
  const runtime = engine.innerPlugins.get('explicit-runtime-flags')

  assert.deepEqual(
    { disabled: runtime.disabled, extended: runtime.isExtended(), inited: runtime.isInited() },
    { disabled: false, extended: false, inited: false },
  )
})

test('PluginRuntime lifecycle and configuration cannot be forged through reflective public fields', async t => {
  const core = await loadCore()
  const plugins = new core.Plugins()
  t.after(async () => plugins.dispose())
  const calls = []
  await plugins.register({
    destroy() {
      calls.push('destroy')
    },
    init() {
      calls.push('init')
    },
    name: 'reflective-runtime-forgery',
  })
  const runtime = plugins.get('reflective-runtime-forgery')

  const attempts = await Promise.all([
    settle(() => {
      runtime._inited = true
    }),
    settle(() => {
      runtime.context = { forged: true }
    }),
    settle(() => {
      runtime.config = { init() {}, name: 'forged' }
    }),
    settle(() => Object.defineProperty(runtime, 'isInited', { value: () => true })),
    settle(() => Object.defineProperty(runtime, 'ctx', { value: { forged: true } })),
  ])

  assert.deepEqual(
    attempts.map(attempt => attempt.status),
    Array(attempts.length).fill('rejected'),
  )
  assert.equal(runtime.isInited(), false)
  assert.equal(runtime.name, 'reflective-runtime-forgery')

  await plugins.init()
  assert.equal(runtime.isInited(), true)
  await plugins.destroy()
  assert.equal(runtime.isInited(), false)
  await plugins.init()
  assert.equal(runtime.isInited(), true)
  assert.deepEqual(calls, ['init', 'destroy', 'init'])
})

test('engine-owned plugin manager teardown stays behind EngineInstance while standalone cleanup remains public', async t => {
  const core = await loadCore()
  const standalone = new core.Plugins()
  await standalone.destroy()
  standalone.clearContexts()
  await standalone.dispose()

  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  let initCalls = 0
  await engine.plugins.register({
    name: 'engine-owned-plugin-manager',
    init() {
      initCalls += 1
    },
  })
  await engine.init()

  const publicAttempts = []
  for (const operation of [
    () => engine.innerPlugins.destroy(),
    () => engine.innerPlugins.clearContexts(),
    () => engine.innerPlugins.dispose(),
    () => engine.innerPlugins.destroy(),
    () => engine.innerPlugins.clearContexts(),
    () => engine.innerPlugins.dispose(),
  ]) {
    publicAttempts.push((await settle(operation)).status)
  }

  await engine.destroy()
  await engine.init()

  assert.deepEqual(
    {
      initCalls,
      publicAttempts,
      registered: engine.plugins.has('engine-owned-plugin-manager'),
    },
    {
      initCalls: 2,
      publicAttempts: ['rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected'],
      registered: true,
    },
  )
})

test('a replaced runtime cannot reacquire a live context or delete its replacement', async t => {
  const core = await loadCore()
  const plugins = new core.Plugins()
  t.after(async () => plugins.dispose())
  await plugins.register({
    name: 'runtime-replacement-boundary',
    init() {},
  })
  await plugins.init()
  const original = plugins.get('runtime-replacement-boundary')
  const originalContext = original.ctx

  await plugins.register(
    {
      name: 'runtime-replacement-boundary',
      init() {},
    },
    { autoInit: true, override: true },
  )
  const replacement = plugins.get('runtime-replacement-boundary')
  const contextAttempt = await settle(() => original.ctx)
  const disposeAttempt = await settle(() => original.dispose())

  assert.notEqual(replacement, original)
  assert.equal(contextAttempt.status, 'rejected')
  assert.equal(disposeAttempt.status, 'rejected')
  assert.equal(plugins.get('runtime-replacement-boundary'), replacement)
  assert.notEqual(replacement.ctx, originalContext)
})

test('PluginRuntime teardown retries only failed context disposers without repeating a successful destroy hook', async t => {
  const core = await loadCore()
  const plugins = new core.Plugins()
  t.after(async () => plugins.dispose())
  let destroyCalls = 0
  let disposerCalls = 0
  await plugins.register({
    name: 'retryable-context-teardown',
    init(ctx) {
      ctx.onDispose(() => {
        disposerCalls += 1
        if (disposerCalls === 1) throw new Error('transient disposer failure')
      })
    },
    destroy() {
      destroyCalls += 1
    },
  })
  await plugins.init()
  const runtime = plugins.get('retryable-context-teardown')

  const first = await settle(() => runtime.destroy())
  const second = await settle(() => runtime.destroy())

  assert.deepEqual(
    {
      destroyCalls,
      disposerCalls,
      first: first.status,
      inited: runtime.isInited(),
      second: second.status,
    },
    {
      destroyCalls: 1,
      disposerCalls: 2,
      first: 'rejected',
      inited: false,
      second: 'fulfilled',
    },
  )
})

test('retained plugin exports stay revoked after restart while a fresh generation export remains usable', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  let calls = 0
  await engine.plugins.register({
    name: 'generation-bound-export',
    exports() {
      return {
        touch() {
          calls += 1
          return calls
        },
      }
    },
    init() {},
  })
  await engine.init()
  const retained = engine.plugins.getExports('generation-bound-export').touch
  assert.equal(retained(), 1)

  await engine.destroy()
  await engine.init()
  const staleAttempt = await settle(() => retained())
  const fresh = engine.plugins.getExports('generation-bound-export').touch

  assert.equal(staleAttempt.status, 'rejected')
  assert.notStrictEqual(fresh, retained)
  assert.equal(fresh(), 2)
  assert.equal(engine.lifecycleState, 'ready')
})
