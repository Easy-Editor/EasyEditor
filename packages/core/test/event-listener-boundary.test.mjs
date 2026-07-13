import EventEmitter from 'events'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { loadCore } from './helpers/kernel.mjs'

test('EventBus disposers target one registration without crossing a remove-all boundary', async () => {
  const core = await loadCore()
  const eventBus = new core.EventBus(new EventEmitter())
  let appendedCalls = 0
  let prependedCalls = 0
  const appended = () => {
    appendedCalls += 1
  }
  const prepended = () => {
    prependedCalls += 1
  }

  const staleAppendedDisposer = eventBus.on('probe:append', appended)
  const stalePrependedDisposer = eventBus.prependListener('probe:prepend', prepended)
  assert.equal(eventBus.removeAllListeners(), eventBus)
  assert.equal(eventBus.listenerCount(), 0)

  const currentAppendedDisposer = eventBus.on('probe:append', appended)
  const currentPrependedDisposer = eventBus.prependListener('probe:prepend', prepended)
  staleAppendedDisposer()
  stalePrependedDisposer()

  eventBus.emit('probe:append')
  eventBus.emit('probe:prepend')
  assert.deepEqual([appendedCalls, prependedCalls], [1, 1])

  currentAppendedDisposer()
  currentPrependedDisposer()
  eventBus.emit('probe:append')
  eventBus.emit('probe:prepend')
  assert.deepEqual([appendedCalls, prependedCalls], [1, 1])
})

test('EventBus off/removeListener preserve EventEmitter duplicate-listener semantics', async () => {
  const core = await loadCore()
  const eventBus = new core.EventBus(new EventEmitter())
  let calls = 0
  const listener = () => {
    calls += 1
  }

  const firstDisposer = eventBus.on('probe:on', listener)
  const secondDisposer = eventBus.on('probe:on', listener)
  eventBus.off('probe:on', listener)
  eventBus.emit('probe:on')
  assert.equal(calls, 1)

  secondDisposer()
  eventBus.emit('probe:on')
  assert.equal(calls, 2, 'disposing the already removed duplicate must not remove the remaining registration')
  firstDisposer()
  eventBus.emit('probe:on')
  assert.equal(calls, 2)

  eventBus.addListener('probe:add', listener).addListener('probe:add', listener)
  eventBus.removeListener('probe:add', listener)
  eventBus.emit('probe:add')
  assert.equal(calls, 3)
  eventBus.removeListener('probe:add', listener)
  eventBus.emit('probe:add')
  assert.equal(calls, 3)
})

test('engine-owned listener-wide cleanup rejects before mutating ready editor state', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()

  let commonCalls = 0
  let busCalls = 0
  let rawCalls = 0
  let hookCalls = 0
  engine.eventBus.on('probe:common', () => {
    commonCalls += 1
  })
  engine.editor.eventBus.on('probe:bus', () => {
    busCalls += 1
  })
  engine.editor.on('probe:raw', () => {
    rawCalls += 1
  })
  engine.editor.registerHooks([
    {
      message: 'probe:hook',
      type: 'on',
      handler() {
        hookCalls += 1
      },
    },
  ])

  assert.equal(engine.eventBus.removeAllListenersInternal, undefined)
  assert.equal(engine.editor.removeAllListenersInternal, undefined)
  assert.equal(engine.editor.unregisterHooksInternal, undefined)
  assert.throws(() => engine.eventBus.removeAllListeners(), /engine-owned service/)
  assert.throws(() => engine.editor.eventBus.removeAllListeners(), /engine-owned service/)
  assert.throws(() => engine.editor.removeAllListeners(), /engine-owned service/)
  assert.throws(() => engine.editor.unregisterHooks(), /engine-owned service/)

  engine.eventBus.emit('probe:common')
  engine.editor.eventBus.emit('probe:bus')
  engine.editor.emit('probe:raw')
  engine.editor.emit('probe:hook')
  assert.deepEqual([commonCalls, busCalls, rawCalls, hookCalls], [1, 1, 1, 1])
})

test('destroy clears listener tracking and stale generation disposers cannot affect a restart', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()

  let calls = 0
  const listener = () => {
    calls += 1
  }
  const staleDisposer = engine.eventBus.on('probe:restart', listener)

  await engine.destroy()
  assert.equal(engine.eventBus.listenerCount(), 0)
  await engine.init()

  const currentDisposer = engine.eventBus.on('probe:restart', listener)
  staleDisposer()
  engine.eventBus.emit('probe:restart')
  assert.equal(calls, 1)

  currentDisposer()
  engine.eventBus.emit('probe:restart')
  assert.equal(calls, 1)
})

test('Selection returns a registration-scoped disposer that cannot cross a restart', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  t.after(async () => engine.destroy())
  engine.loadProject(createProjectSchema({ id: 'selection-disposer-first' }), true)
  await engine.init()

  let calls = 0
  const listener = () => {
    calls += 1
  }
  const staleDisposer = engine.designer.selection.onSelectionChange(listener)

  await engine.destroy()
  await engine.init()
  engine.loadProject(createProjectSchema({ id: 'selection-disposer-second' }), true)
  engine.designer.selection.clear()

  const currentDisposer = engine.designer.selection.onSelectionChange(listener)
  staleDisposer()
  engine.designer.selection.select(engine.project.currentDocument.root.id)
  assert.equal(calls, 1)

  currentDisposer()
  engine.designer.selection.clear()
  assert.equal(calls, 1)
})

test('Project ready subscriptions keep immediate delivery and return their registration disposer', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()

  const simulators = [
    { dispose() {}, id: 'first' },
    { dispose() {}, id: 'second' },
    { dispose() {}, id: 'third' },
  ]
  const simulatorDeliveries = []
  engine.project.mountSimulator(simulators[0])
  const disposeSimulatorReady = engine.project.onSimulatorReady(simulator => {
    simulatorDeliveries.push(simulator.id)
  })
  engine.project.mountSimulator(simulators[1])
  assert.deepEqual(simulatorDeliveries, ['first', 'second'])
  disposeSimulatorReady()
  engine.project.mountSimulator(simulators[2])
  assert.deepEqual(simulatorDeliveries, ['first', 'second'])

  let rendererDeliveries = 0
  engine.project.setRendererReady({ id: 'first' })
  const disposeRendererReady = engine.project.onRendererReady(() => {
    rendererDeliveries += 1
  })
  assert.equal(rendererDeliveries, 1)
  engine.project.setRendererReady({ id: 'second' })
  assert.equal(rendererDeliveries, 2)
  disposeRendererReady()
  engine.project.setRendererReady({ id: 'third' })
  assert.equal(rendererDeliveries, 2)
})

test('Config, Editor, and LoadingState disposers cannot remove same-callback registrations after restart', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())
  await engine.init()

  const calls = { config: 0, editor: 0, loading: 0 }
  const configListener = () => {
    calls.config += 1
  }
  const editorListener = () => {
    calls.editor += 1
  }
  const loadingListener = () => {
    calls.loading += 1
  }
  const staleDisposers = [
    engine.config.onGot('stale-config-registration', configListener),
    engine.editor.onChange('stale-editor-registration', editorListener),
    engine.remote.loadingState.subscribe(loadingListener),
  ]

  await engine.destroy()
  await engine.init()
  const currentDisposers = [
    engine.config.onGot('stale-config-registration', configListener),
    engine.editor.onChange('stale-editor-registration', editorListener),
    engine.remote.loadingState.subscribe(loadingListener),
  ]
  staleDisposers.forEach(dispose => dispose())

  engine.config.set('stale-config-registration', true)
  engine.editor.set('stale-editor-registration', true)
  engine.remote.loadingState.startLoading('stale-loading-registration', 'material', 'probe')
  assert.deepEqual(calls, { config: 1, editor: 1, loading: 1 })

  currentDisposers.forEach(dispose => dispose())
})
