import assert from 'node:assert/strict'
import test from 'node:test'
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

test('Plugins.toProxy returns one canonical lifecycle-guarded identity', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  const prefetchedProxy = engine.innerPlugins.toProxy()
  const repeatedProxy = engine.innerPlugins.toProxy()
  const nestedProxy = prefetchedProxy.toProxy()

  await engine.init()
  await engine.destroy()
  const registration = await settle(() =>
    nestedProxy.register({
      name: 'proxy-revival',
      init() {},
    }),
  )

  assert.deepEqual(
    {
      canonicalNested: nestedProxy === engine.plugins,
      canonicalPrefetched: prefetchedProxy === engine.plugins,
      canonicalRepeated: repeatedProxy === engine.plugins,
      registered: engine.plugins.has('proxy-revival'),
      registration: registration.status,
    },
    {
      canonicalNested: true,
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

test('an async autoInit registration cannot commit after destroy and restart crosses its generation', async t => {
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
  const destruction = engine.destroy()
  releaseOldInit.resolve()
  await destruction
  await engine.init()
  const outcome = await registrationOutcome

  assert.deepEqual(
    {
      initCalls,
      registered: engine.plugins.has('stale-registration'),
      registration: outcome.status,
    },
    {
      initCalls: 1,
      registered: false,
      registration: 'rejected',
    },
  )
})

test('an async plugin init cannot let its stale completion overwrite the restarted generation', async t => {
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

  const pendingInit = engine.plugins.init()
  const initOutcome = settle(() => pendingInit)
  await oldInitStarted.promise
  const destruction = engine.destroy()
  releaseOldInit.resolve()
  await destruction
  await engine.init()
  const outcome = await initOutcome

  assert.deepEqual(
    {
      currentGenerationInited: engine.plugins.get('stale-init')?.isInited(),
      initCalls,
      oldGenerationInit: outcome.status,
    },
    {
      currentGenerationInited: true,
      initCalls: 2,
      oldGenerationInit: 'rejected',
    },
  )
})

test('a disposed plugin context revokes retained engine capabilities across restart', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  let oldContext
  let deliveries = 0
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
  await engine.destroy()
  await engine.init()
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
      attempts: ['rejected', 'rejected', 'rejected', 'rejected', 'rejected'],
      config: undefined,
      deliveries: 0,
      registered: false,
    },
  )
})

test('a stale async plugin body cannot mutate the restarted generation before its ticket rejects', async t => {
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
  const pendingInit = engine.plugins.init()
  const oldOutcome = settle(() => pendingInit)
  await oldInitStarted.promise
  const destruction = engine.destroy()
  releaseOldInit.resolve()
  await destruction
  await engine.init()

  assert.deepEqual(
    {
      currentInited: engine.plugins.get('stale-context-write')?.isInited(),
      initCalls,
      leaked: engine.config.get('stale-generation-write'),
      oldInit: (await oldOutcome).status,
    },
    {
      currentInited: true,
      initCalls: 2,
      leaked: undefined,
      oldInit: 'rejected',
    },
  )
})

test('an async plugin extension cannot commit after destroy and restart crosses its generation', async t => {
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
  const runtime = engine.plugins.get('stale-extension')

  const pendingExtension = engine.plugins.extend()
  const extensionOutcome = settle(() => pendingExtension)
  await oldExtendStarted.promise
  const destruction = engine.destroy()
  releaseOldExtend.resolve()
  await destruction
  await engine.init()
  const outcome = await extensionOutcome

  assert.deepEqual(
    {
      currentGenerationExtended: runtime.isExtended(),
      extendCalls,
      oldGenerationExtension: outcome.status,
    },
    {
      currentGenerationExtended: true,
      extendCalls: 2,
      oldGenerationExtension: 'rejected',
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
      arrayCount: engine.plugins.getAll().filter(plugin => plugin.name === 'linearized-registration').length,
      mapSize: engine.plugins.pluginsMap.size,
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
  const original = engine.plugins.get('atomic-override')

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
      retained: engine.plugins.get('atomic-override') === original,
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
    init(ctx) {
      sawCandidate = ctx.plugins.get(candidate.name)?.config.marker === 'candidate'
    },
  }

  await engine.plugins.register(candidate, { autoInit: true, override: true })

  assert.equal(sawCandidate, true)
  assert.notEqual(engine.plugins.get('self-visible-override').config, candidate)
  assert.equal(engine.plugins.get('self-visible-override').config.marker, 'candidate')
  assert.equal(engine.plugins.getAll().filter(plugin => plugin.name === candidate.name).length, 1)
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
      inited: engine.plugins.get('registered-during-initialization').isInited(),
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
  const runtime = engine.plugins.get('explicit-runtime-flags')

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
    () => engine.plugins.destroy(),
    () => engine.plugins.clearContexts(),
    () => engine.plugins.dispose(),
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
  const runtime = engine.plugins.get('generation-bound-export')
  const retained = runtime.toProxy().touch
  assert.equal(retained(), 1)

  await engine.destroy()
  await engine.init()
  const staleAttempt = await settle(() => retained())
  const fresh = runtime.toProxy().touch

  assert.equal(staleAttempt.status, 'rejected')
  assert.notStrictEqual(fresh, retained)
  assert.equal(fresh(), 2)
  assert.equal(engine.lifecycleState, 'ready')
})
