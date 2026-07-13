import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { createFakeWindow } from './helpers/fake-browser.mjs'
import { assertKernelApi, captureFailure, loadCore } from './helpers/kernel.mjs'

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

test('destroy waits for an in-flight init and tears the initialized plugin down once', async () => {
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
  const destroying = engine.destroy()
  releaseInit()
  await Promise.all([initializing, destroying])

  assert.equal(engine.lifecycleState, 'disposed')
  assert.deepEqual(calls, ['init:start', 'init:end', 'destroy'])
  assert.equal(engine.plugins.get('slow').isInited(), false)
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
  simulator.set('probe', 2)

  assert.equal(reactionCalls, beforeDestroy)
  assert.equal(rendererDisposals, 1)
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
