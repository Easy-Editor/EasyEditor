import assert from 'node:assert/strict'
import test from 'node:test'
import { isDeepStrictEqual } from 'node:util'
import { createLoadedResource, createProjectSchema } from './fixtures/project-schema.mjs'
import { createFakeWindow } from './helpers/fake-browser.mjs'
import { assertKernelApi, captureFailure, loadCore } from './helpers/kernel.mjs'

const countHotkeyCallbacks = hotkey =>
  Object.values(hotkey.callBacks).reduce((count, callbacks) => count + callbacks.length, 0)

const settleWithin = (promise, timeoutMs = 250) =>
  new Promise(resolve => {
    const timeout = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs)
    promise.then(
      value => {
        clearTimeout(timeout)
        resolve({ status: 'fulfilled', value })
      },
      error => {
        clearTimeout(timeout)
        resolve({ error, status: 'rejected' })
      },
    )
  })

const hasNestedErrorName = (error, name) => {
  if (error?.name === name) return true
  if (error instanceof AggregateError && error.errors.some(cause => hasNestedErrorName(cause, name))) return true
  if (Array.isArray(error?.failures)) {
    return error.failures.some(failure => hasNestedErrorName(failure?.cause ?? failure, name))
  }
  return error?.cause ? hasNestedErrorName(error.cause, name) : false
}

const runServiceMutationMatrix = async ({ engine, hostWindow, materialRegistry, prefix, remoteCalls }) => {
  let eventDeliveries = 0
  const cases = [
    {
      label: 'engine.loadProject',
      snapshot: () => engine.project.get('id'),
      operation: () => engine.loadProject(createProjectSchema({ id: `${prefix}-engine-project` }), true),
    },
    {
      label: 'project.load',
      snapshot: () => engine.project.get('id'),
      operation: () => engine.project.load(createProjectSchema({ id: `${prefix}-direct-project` }), true),
    },
    {
      label: 'config.set',
      snapshot: () => engine.config.get(`${prefix}-config`),
      operation: () => engine.config.set(`${prefix}-config`, true),
    },
    {
      label: 'setters.registerSetter',
      snapshot: () => engine.setters.getSetter(`${prefix}-setter`),
      operation: () => engine.setters.registerSetter(`${prefix}-setter`, function LifecycleSetter() {}),
    },
    {
      label: 'materials.createComponentMeta',
      operation: () => engine.materials.createComponentMeta({ componentName: `${prefix}FacadeMaterial` }),
    },
    {
      label: 'materials.registry.register',
      snapshot: () => materialRegistry.has(`${prefix}RegistryMaterial`),
      operation: () => materialRegistry.register({ componentName: `${prefix}RegistryMaterial` }),
    },
    {
      label: 'plugins.register',
      snapshot: () => engine.plugins.has(`${prefix}-plugin`),
      operation: () => engine.plugins.register({ name: `${prefix}-plugin`, init() {} }),
    },
    {
      label: 'remote.request',
      snapshot: () => remoteCalls.count,
      operation: () => engine.remote.request({ name: `${prefix}-request`, type: 'material' }),
    },
    {
      label: 'remote.registry.register',
      snapshot: () => engine.remote.registry.has('material', `${prefix}-remote`),
      operation: () => engine.remote.registry.register(createLoadedResource(`${prefix}-remote`)),
    },
    {
      label: 'remote.loadingState.startLoading',
      snapshot: () => engine.remote.loadingState.getState(`${prefix}-loading`),
      operation: () => engine.remote.loadingState.startLoading(`${prefix}-loading`, 'material', `${prefix}-loading`),
    },
    {
      label: 'event.on/emit',
      snapshot: () => eventDeliveries,
      operation: () => {
        engine.event.on(`common:${prefix}-event`, () => {
          eventDeliveries += 1
        })
        engine.event.emit(`${prefix}-event`)
      },
    },
    {
      label: 'eventBus.addListener/emit',
      snapshot: () => eventDeliveries,
      operation: () => {
        engine.eventBus.addListener(`${prefix}:event-bus`, () => {
          eventDeliveries += 1
        })
        engine.eventBus.emit(`${prefix}:event-bus`)
      },
    },
    {
      label: 'hotkey.bind',
      snapshot: () => countHotkeyCallbacks(engine.hotkey),
      operation: () => engine.hotkey.bind(`ctrl+${prefix.at(-1)}`, () => {}),
    },
    {
      label: 'clipboard.injectCopyPaster',
      snapshot: () => hostWindow.document.body.children.length,
      operation: () => engine.clipboard.injectCopyPaster(hostWindow.document),
    },
  ]

  const accepted = []
  const mutated = []
  const rejected = []
  const unchanged = []
  for (const mutationCase of cases) {
    const before = mutationCase.snapshot?.()
    let error
    try {
      await mutationCase.operation()
    } catch (caught) {
      error = caught
    }
    const after = mutationCase.snapshot?.()
    const changed = mutationCase.snapshot ? !isDeepStrictEqual(after, before) : undefined
    if (error) {
      rejected.push(mutationCase.label)
    } else {
      accepted.push(mutationCase.label)
    }
    if (changed === true) mutated.push(mutationCase.label)
    if (changed === false) unchanged.push(mutationCase.label)
  }

  return { accepted, mutated, rejected, unchanged }
}

test('init and destroy are idempotent and balance owned browser listeners', async () => {
  const core = await loadCore()
  assertKernelApi(core)
  const hostWindow = createFakeWindow()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow })
  const baseline = hostWindow.document.listenerCount()

  await engine.init()
  const mounted = hostWindow.document.listenerCount()
  assert.equal(engine.lifecycleState, 'ready')
  assert.ok(mounted > baseline, 'init must mount the engine browser adapter')

  await engine.init()
  assert.equal(hostWindow.document.listenerCount(), mounted, 'second init must not duplicate listeners')

  await engine.destroy()
  assert.equal(hostWindow.document.listenerCount(), baseline)
  assert.equal(hostWindow.document.addCount, hostWindow.document.removeCount)

  await engine.destroy()
  assert.equal(hostWindow.document.listenerCount(), baseline, 'second destroy must be a no-op')
  assert.equal(hostWindow.document.addCount, hostWindow.document.removeCount)
})

test('destroying engine A does not dispose or corrupt engine B', async t => {
  const core = await loadCore()
  assertKernelApi(core)
  const a = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: createFakeWindow() })
  const bWindow = createFakeWindow()
  const b = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: bWindow })
  t.after(async () => {
    await a.destroy()
    await b.destroy()
  })

  await a.init()
  await b.init()
  const bListeners = bWindow.document.listenerCount()

  await a.destroy()
  assert.equal(b.lifecycleState, 'ready')
  assert.equal(bWindow.document.listenerCount(), bListeners)

  b.config.set('stillAlive', true)
  assert.equal(b.config.get('stillAlive'), true)
})

test('a destroyed engine can be initialized again without leaking browser listeners', async () => {
  const core = await loadCore()
  const hostWindow = createFakeWindow()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow })
  const baseline = hostWindow.document.listenerCount()

  await engine.init({ restartToken: 'first' })
  const mounted = hostWindow.document.listenerCount()
  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(hostWindow.document.listenerCount(), baseline)

  await engine.init({ restartToken: 'second' })
  assert.equal(engine.lifecycleState, 'ready')
  assert.equal(engine.config.get('restartToken'), 'second')
  assert.equal(hostWindow.document.listenerCount(), mounted)

  await engine.destroy()
  assert.equal(hostWindow.document.listenerCount(), baseline)
  assert.equal(hostWindow.document.addCount, hostWindow.document.removeCount)
})

test('legacyTrusted services reject revival during disposal and after disposal, then reactivate on init', async t => {
  const core = await loadCore()
  const hostWindow = createFakeWindow()
  const remoteCalls = { count: 0 }
  const engine = core.createEngine({
    trustPolicy: 'legacyTrusted',
    hostWindow,
    remoteAdapter: {
      request() {
        remoteCalls.count += 1
        return { ok: true }
      },
    },
  })
  const materialRegistry = engine.materials.registry
  t.after(async () => {
    await engine.destroy()
  })
  let signalDestroyStarted
  let releaseDestroy
  const destroyStarted = new Promise(resolve => {
    signalDestroyStarted = resolve
  })
  const destroyReleased = new Promise(resolve => {
    releaseDestroy = resolve
  })
  await engine.plugins.register({
    name: 'lifecycle-destroy-blocker',
    init() {},
    async destroy() {
      signalDestroyStarted()
      await destroyReleased
    },
  })
  await engine.init()

  const destroying = engine.destroy()
  await destroyStarted
  let disposing
  try {
    assert.equal(engine.lifecycleState, 'disposing')
    disposing = await runServiceMutationMatrix({
      engine,
      hostWindow,
      materialRegistry,
      prefix: 'disposing',
      remoteCalls,
    })
  } finally {
    releaseDestroy()
    await destroying
  }
  assert.equal(engine.lifecycleState, 'disposed')

  const disposed = await runServiceMutationMatrix({
    engine,
    hostWindow,
    materialRegistry,
    prefix: 'disposed',
    remoteCalls,
  })

  await engine.init()
  assert.equal(engine.lifecycleState, 'ready')
  const restarted = await runServiceMutationMatrix({
    engine,
    hostWindow,
    materialRegistry: engine.materials.registry,
    prefix: 'restarted',
    remoteCalls,
  })
  await engine.destroy()

  assert.deepEqual(
    {
      acceptedAfterDispose: disposed.accepted,
      acceptedWhileDisposing: disposing.accepted,
      mutatedAfterDispose: disposed.mutated,
      mutatedWhileDisposing: disposing.mutated,
      rejectedAfterRestart: restarted.rejected,
      unchangedAfterRestart: restarted.unchanged,
    },
    {
      acceptedAfterDispose: [],
      acceptedWhileDisposing: [],
      mutatedAfterDispose: [],
      mutatedWhileDisposing: [],
      rejectedAfterRestart: [],
      unchangedAfterRestart: [],
    },
  )
})

test('project teardown does not lend lifecycle authority to material listeners', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  engine.materials.createComponentMeta({ componentName: 'Page' })
  engine.project.load(createProjectSchema({ id: 'teardown-listener-project' }), true)
  let disposingDeliveries = 0
  let registrationOutcome
  const unsubscribe = engine.materials.registry.subscribe(() => {
    if (engine.lifecycleState !== 'disposing') return
    disposingDeliveries += 1
    registrationOutcome = engine.plugins
      .register({ name: 'teardown-listener-revival', init() {} })
      .catch(error => error)
  })

  await engine.init()
  await engine.destroy()
  unsubscribe()
  if (registrationOutcome) await registrationOutcome

  assert.equal(disposingDeliveries, 0)
  assert.equal(engine.plugins.has('teardown-listener-revival'), false)
  assert.equal(engine.lifecycleState, 'disposed')
})

test('public document removal cannot select the notification-free teardown path', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  engine.materials.createComponentMeta({ componentName: 'Page' })
  engine.project.load(createProjectSchema({ id: 'public-removal-project' }), true)
  const document = engine.project.currentDocument
  const usageEvents = []
  const unsubscribe = engine.materials.registry.subscribe(event => {
    if (event.type === core.RegistryEventType.USAGE_CHANGED) usageEvents.push(event)
  })
  t.after(unsubscribe)

  // JavaScript callers may still pass extra arguments, but they must not be
  // interpreted as internal teardown authority.
  document.remove(true)

  assert.equal(engine.materials.getUsageCount('Page'), 0)
  assert.equal(usageEvents.length, 1)
  assert.equal(usageEvents[0].componentName, 'Page')
})

test('external destroy conflicts with an in-flight async plugin init until an explicit retry', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  let releaseInit
  let signalStarted
  const started = new Promise(resolve => {
    signalStarted = resolve
  })
  const blocked = new Promise(resolve => {
    releaseInit = resolve
  })
  const calls = []
  await engine.plugins.register({
    name: 'slow',
    async init() {
      calls.push('init:start')
      signalStarted()
      await blocked
      calls.push('init:end')
    },
    destroy() {
      calls.push('destroy')
    },
  })

  const initializing = engine.init()
  await started
  const conflictingDestroy = await settleWithin(
    Promise.resolve().then(() => engine.destroy()),
    25,
  )
  assert.equal(conflictingDestroy.status, 'rejected', 'external destroy must reject instead of joining owned init')
  assert.equal(hasNestedErrorName(conflictingDestroy.error, 'LifecycleReentrancyError'), true)
  assert.equal(engine.lifecycleState, 'initializing')
  releaseInit()
  await initializing

  assert.equal(engine.lifecycleState, 'ready')
  assert.deepEqual(calls, ['init:start', 'init:end'])
  assert.equal(engine.innerPlugins.get('slow').isInited(), true)

  await engine.destroy()

  assert.equal(engine.lifecycleState, 'disposed')
  assert.deepEqual(calls, ['init:start', 'init:end', 'destroy'])
  assert.equal(engine.innerPlugins.get('slow').isInited(), false)
})

test('external init conflicts with an in-flight async plugin destroy until an explicit retry', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  let releaseFirstDestroy
  let signalFirstDestroyStarted
  const firstDestroyStarted = new Promise(resolve => {
    signalFirstDestroyStarted = resolve
  })
  const firstDestroyReleased = new Promise(resolve => {
    releaseFirstDestroy = resolve
  })
  const calls = []
  let initCalls = 0
  let destroyCalls = 0
  await engine.plugins.register({
    name: 'slow-destroy',
    init() {
      initCalls += 1
      calls.push(`init:${initCalls}`)
    },
    async destroy() {
      destroyCalls += 1
      calls.push(`destroy:${destroyCalls}:start`)
      if (destroyCalls === 1) {
        signalFirstDestroyStarted()
        await firstDestroyReleased
      }
      calls.push(`destroy:${destroyCalls}:end`)
    },
  })

  await engine.init()
  const destroying = engine.destroy()
  await firstDestroyStarted
  const conflictingRestart = await settleWithin(
    Promise.resolve().then(() => engine.init({ restartProbe: 'must-not-apply' })),
    25,
  )
  assert.equal(conflictingRestart.status, 'rejected', 'external init must reject instead of joining owned destroy')
  assert.equal(hasNestedErrorName(conflictingRestart.error, 'LifecycleReentrancyError'), true)
  assert.equal(engine.lifecycleState, 'disposing')
  assert.equal(engine.config.get('restartProbe'), undefined)
  releaseFirstDestroy()
  await destroying

  assert.equal(engine.lifecycleState, 'disposed')
  assert.deepEqual(calls, ['init:1', 'destroy:1:start', 'destroy:1:end'])

  await engine.init({ restartProbe: 'after-destroy' })

  assert.equal(engine.lifecycleState, 'ready')
  assert.equal(engine.config.get('restartProbe'), 'after-destroy')
  assert.deepEqual(calls, ['init:1', 'destroy:1:start', 'destroy:1:end', 'init:2'])

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.deepEqual(calls, ['init:1', 'destroy:1:start', 'destroy:1:end', 'init:2', 'destroy:2:start', 'destroy:2:end'])
})

test('PluginContext never exposes engine init or destroy authority', async () => {
  const core = await loadCore()

  for (const trustPolicy of ['legacyTrusted', 'agentRestricted']) {
    const engine = core.createEngine({ trustPolicy, hostWindow: null })
    await engine.plugins.register({
      name: `context-lifecycle-${trustPolicy}`,
      init(context) {
        assert.equal(context.init, undefined)
        assert.equal(context.destroy, undefined)
        assert.equal('init' in context, false)
        assert.equal('destroy' in context, false)
        if (trustPolicy === 'agentRestricted') {
          assert.equal(context.engine, undefined)
          return
        }
        assert.equal(context.engine.init, undefined)
        assert.equal(context.engine.destroy, undefined)
        assert.equal('init' in context.engine, false)
        assert.equal('destroy' in context.engine, false)
      },
    })

    await engine.init()
    await engine.destroy()
    assert.equal(engine.lifecycleState, 'disposed')
  }
})

test('all synchronous plugin lifecycle reentry directions reject promptly and remain retryable', async () => {
  const core = await loadCore()

  for (const hook of ['init', 'destroy']) {
    for (const requestedOperation of ['init', 'destroy']) {
      const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
      let attemptReentry = true
      await engine.plugins.register({
        name: `reentry-${hook}-${requestedOperation}`,
        init() {
          if (hook !== 'init' || !attemptReentry) return
          attemptReentry = false
          return engine[requestedOperation]()
        },
        destroy() {
          if (hook !== 'destroy' || !attemptReentry) return
          attemptReentry = false
          return engine[requestedOperation]()
        },
      })

      if (hook === 'destroy') await engine.init()
      const outcome = await settleWithin(engine[hook]())
      assert.equal(outcome.status, 'rejected', `${hook} -> ${requestedOperation} must reject`)
      assert.equal(
        hasNestedErrorName(outcome.error, 'LifecycleReentrancyError'),
        true,
        `${hook} -> ${requestedOperation} must retain the structured cause`,
      )
      if (hook === 'init') {
        assert.equal(engine.lifecycleState, 'created')
        await engine.init()
        assert.equal(engine.lifecycleState, 'ready')
      } else {
        assert.equal(engine.lifecycleState, 'failed')
      }
      await engine.destroy()
      assert.equal(engine.lifecycleState, 'disposed')
    }
  }
})

test('all synchronous RemoteAdapter lifecycle reentry directions reject promptly and remain retryable', async () => {
  const core = await loadCore()

  for (const hook of ['init', 'dispose']) {
    for (const requestedOperation of ['init', 'destroy']) {
      let engine
      let attemptReentry = true
      engine = core.createEngine({
        trustPolicy: 'legacyTrusted',
        hostWindow: null,
        remoteAdapter: {
          init() {
            if (hook !== 'init' || !attemptReentry) return
            attemptReentry = false
            return engine[requestedOperation]()
          },
          dispose() {
            if (hook !== 'dispose' || !attemptReentry) return
            attemptReentry = false
            return engine[requestedOperation]()
          },
        },
      })

      if (hook === 'dispose') await engine.init()
      const lifecycleOperation = hook === 'dispose' ? 'destroy' : 'init'
      const outcome = await settleWithin(engine[lifecycleOperation]())
      assert.equal(outcome.status, 'rejected', `${hook} -> ${requestedOperation} must reject`)
      assert.equal(
        hasNestedErrorName(outcome.error, 'LifecycleReentrancyError'),
        true,
        `${hook} -> ${requestedOperation} must retain the structured cause`,
      )
      if (hook === 'init') {
        assert.equal(engine.lifecycleState, 'created')
        await engine.init()
        assert.equal(engine.lifecycleState, 'ready')
      } else {
        assert.equal(engine.lifecycleState, 'failed')
      }
      await engine.destroy()
      assert.equal(engine.lifecycleState, 'disposed')
    }
  }
})

test('all asynchronous plugin lifecycle reentry directions reject promptly and remain explicitly recoverable', async () => {
  const core = await loadCore()

  for (const hook of ['init', 'destroy']) {
    for (const requestedOperation of ['init', 'destroy']) {
      const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
      let attemptReentry = true
      await engine.plugins.register({
        name: `async-reentry-${hook}-${requestedOperation}`,
        async init() {
          if (hook !== 'init' || !attemptReentry) return
          attemptReentry = false
          await Promise.resolve()
          return engine[requestedOperation]()
        },
        async destroy() {
          if (hook !== 'destroy' || !attemptReentry) return
          attemptReentry = false
          await Promise.resolve()
          return engine[requestedOperation]()
        },
      })

      if (hook === 'destroy') await engine.init()
      const outcome = await settleWithin(engine[hook]())
      assert.equal(outcome.status, 'rejected', `${hook} -> await -> ${requestedOperation} must reject promptly`)
      assert.equal(
        hasNestedErrorName(outcome.error, 'LifecycleReentrancyError'),
        true,
        `${hook} -> await -> ${requestedOperation} must retain the structured cause`,
      )
      if (hook === 'init') {
        assert.equal(engine.lifecycleState, 'created')
        await engine.init()
        assert.equal(engine.lifecycleState, 'ready')
      } else {
        assert.equal(engine.lifecycleState, 'failed')
      }
      await engine.destroy()
      assert.equal(engine.lifecycleState, 'disposed')
    }
  }
})

test('all asynchronous RemoteAdapter lifecycle reentry directions reject promptly and remain explicitly recoverable', async () => {
  const core = await loadCore()

  for (const hook of ['init', 'dispose']) {
    for (const requestedOperation of ['init', 'destroy']) {
      let engine
      let attemptReentry = true
      engine = core.createEngine({
        trustPolicy: 'legacyTrusted',
        hostWindow: null,
        remoteAdapter: {
          async init() {
            if (hook !== 'init' || !attemptReentry) return
            attemptReentry = false
            await Promise.resolve()
            return engine[requestedOperation]()
          },
          async dispose() {
            if (hook !== 'dispose' || !attemptReentry) return
            attemptReentry = false
            await Promise.resolve()
            return engine[requestedOperation]()
          },
        },
      })

      if (hook === 'dispose') await engine.init()
      const lifecycleOperation = hook === 'dispose' ? 'destroy' : 'init'
      const outcome = await settleWithin(engine[lifecycleOperation]())
      assert.equal(outcome.status, 'rejected', `${hook} -> await -> ${requestedOperation} must reject promptly`)
      assert.equal(
        hasNestedErrorName(outcome.error, 'LifecycleReentrancyError'),
        true,
        `${hook} -> await -> ${requestedOperation} must retain the structured cause`,
      )
      if (hook === 'init') {
        assert.equal(engine.lifecycleState, 'created')
        await engine.init()
        assert.equal(engine.lifecycleState, 'ready')
      } else {
        assert.equal(engine.lifecycleState, 'failed')
      }
      await engine.destroy()
      assert.equal(engine.lifecycleState, 'disposed')
    }
  }
})

test('engine destroy owns simulator reactions and renderer disposal', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const simulator = new core.Simulator(engine.project, engine.designer)
  engine.project.mountSimulator(simulator)
  let reactionCalls = 0
  let rendererDisposals = 0
  simulator.connect(
    {
      isSimulatorRenderer: true,
      dispose() {
        rendererDisposals += 1
      },
    },
    () => {
      simulator.get('probe')
      reactionCalls += 1
    },
  )
  simulator.set('probe', 1)
  const beforeDestroy = reactionCalls

  await engine.destroy()
  assert.throws(() => simulator.set('probe', 2), /disposed/)

  assert.equal(reactionCalls, beforeDestroy)
  assert.equal(rendererDisposals, 1)
})

test('engine destroy owns Scroller animation frames and seals the disposed generation', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const originalNode = globalThis.Node
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  let nextFrame = 0
  let failCancellation = true
  const pendingFrames = new Set()
  const cancellationAttempts = []

  globalThis.Node = { ELEMENT_NODE: 1 }
  globalThis.requestAnimationFrame = () => {
    const handle = nextFrame
    nextFrame += 1
    pendingFrames.add(handle)
    return handle
  }
  globalThis.cancelAnimationFrame = handle => {
    cancellationAttempts.push(handle)
    if (failCancellation) {
      failCancellation = false
      throw new Error('transient frame cancellation failure')
    }
    pendingFrames.delete(handle)
  }
  t.after(async () => {
    await engine.destroy().catch(() => undefined)
    if (originalNode === undefined) globalThis.Node = undefined
    else globalThis.Node = originalNode
    if (originalRequestAnimationFrame === undefined) globalThis.requestAnimationFrame = undefined
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame
    if (originalCancelAnimationFrame === undefined) globalThis.cancelAnimationFrame = undefined
    else globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  })

  await engine.init()
  const scrollTarget = {
    left: 0,
    nodeType: 0,
    scrollHeight: 1000,
    scrollTo() {},
    scrollWidth: 1000,
    top: 0,
  }
  const oldScroller = engine.designer.createScroller({ scrollTarget })
  oldScroller.scrollTo({ top: 100 })
  assert.deepEqual([...pendingFrames], [0], 'RAF handle 0 must still be treated as an owned resource')

  const firstFailure = await captureFailure(() => engine.destroy())
  assert.equal(firstFailure.name, 'AggregateError')
  assert.equal(engine.lifecycleState, 'failed')
  assert.deepEqual(cancellationAttempts, [0])
  assert.deepEqual([...pendingFrames], [0])
  assert.throws(() => oldScroller.scrollTo({ top: 200 }), /engine is failed/)

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.deepEqual(cancellationAttempts, [0, 0])
  assert.equal(pendingFrames.size, 0)
  assert.throws(() => oldScroller.cancel(), /scroller generation is disposed/)

  await engine.init()
  const nextScroller = engine.designer.createScroller({ scrollTarget })
  nextScroller.scrollTo({ top: 100 })
  assert.deepEqual([...pendingFrames], [1])
  nextScroller.cancel()
  assert.equal(pendingFrames.size, 0)
})

test('engine destroy retries only failed Simulator lifetime cleanup', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const simulator = new core.Simulator(engine.project, engine.designer)
  engine.project.mountSimulator(simulator)

  // This white-box seam isolates Simulator's lifetime ledger from MobX's
  // non-throwing reaction disposer so failure and retry are deterministic.
  const trackLifetime = simulator.trackLifetime.bind(simulator)
  let successfulCleanupCalls = 0
  let retryableCleanupCalls = 0
  trackLifetime(() => {
    successfulCleanupCalls += 1
  })
  trackLifetime(() => {
    retryableCleanupCalls += 1
    if (retryableCleanupCalls === 1) throw new Error('transient Simulator lifetime cleanup failure')
  })

  const firstFailure = await captureFailure(() => engine.destroy())

  assert.equal(firstFailure.name, 'AggregateError')
  assert.equal(engine.lifecycleState, 'failed')
  assert.strictEqual(engine.project.simulator, simulator)
  assert.equal(successfulCleanupCalls, 1)
  assert.equal(retryableCleanupCalls, 1)

  await engine.destroy()

  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(engine.project.simulator, null)
  assert.equal(successfulCleanupCalls, 1)
  assert.equal(retryableCleanupCalls, 2)
})

test('project documents still purge when simulator disposal fails', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  engine.project.load(createProjectSchema(), true)
  const document = engine.project.currentDocument
  const simulator = new core.Simulator(engine.project, engine.designer)
  engine.project.mountSimulator(simulator)
  let rendererDisposals = 0
  simulator.connect(
    {
      isSimulatorRenderer: true,
      dispose() {
        rendererDisposals += 1
        if (rendererDisposals === 1) throw new Error('renderer teardown failed')
      },
    },
    () => simulator.get('probe'),
  )

  const error = await captureFailure(() => engine.destroy())
  assert.equal(error.name, 'AggregateError')
  assert.equal(engine.lifecycleState, 'failed')
  assert.equal(engine.project.documents.length, 0)
  assert.equal(document.root, null)
  assert.equal(rendererDisposals, 1)

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(rendererDisposals, 2)
})

test('destroy reports failed cleanup truthfully and retries it on the next destroy', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  let destroyCalls = 0
  await engine.plugins.register({
    name: 'transient-destroy-failure',
    init() {},
    destroy() {
      destroyCalls += 1
      if (destroyCalls === 1) throw new Error('cleanup failed once')
    },
  })
  await engine.init()

  const error = await captureFailure(() => engine.destroy())
  assert.equal(error.name, 'AggregateError')
  assert.equal(engine.lifecycleState, 'failed')
  assert.equal(destroyCalls, 1)

  await engine.destroy()
  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(destroyCalls, 2)
})

test('remote adapter partial init is disposed exactly once', async () => {
  const core = await loadCore()
  let initCalls = 0
  let disposeCalls = 0
  const engine = core.createEngine({
    trustPolicy: 'legacyTrusted',
    hostWindow: null,
    remoteAdapter: {
      init() {
        initCalls += 1
        throw new Error('adapter init failed')
      },
      dispose() {
        disposeCalls += 1
      },
    },
  })

  const error = await captureFailure(() => engine.init())
  assert.match(error.message, /adapter init failed/i)
  assert.equal(initCalls, 1)
  assert.equal(disposeCalls, 1)

  await engine.destroy()
  assert.equal(disposeCalls, 1)
})

test('failed init rollback is aggregated and destroy retries adapter cleanup', async () => {
  const core = await loadCore()
  let disposeCalls = 0
  const engine = core.createEngine({
    trustPolicy: 'legacyTrusted',
    hostWindow: null,
    remoteAdapter: {
      init() {
        throw new Error('adapter init failed')
      },
      dispose() {
        disposeCalls += 1
        if (disposeCalls === 1) throw new Error('adapter rollback failed')
      },
    },
  })

  const error = await captureFailure(() => engine.init())
  assert.equal(error.name, 'AggregateError')
  assert.equal(engine.lifecycleState, 'failed')
  assert.equal(disposeCalls, 1)

  await engine.destroy()
  assert.equal(disposeCalls, 2)
  assert.equal(engine.lifecycleState, 'disposed')
})
