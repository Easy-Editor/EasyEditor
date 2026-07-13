import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { loadCore } from './helpers/kernel.mjs'

const listenerCount = (eventBus, event) => eventBus.eventEmitter.listenerCount(event)

test('designer purge releases constructor subscriptions, owned event buses, state, and offset observers', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => {
    await engine.destroy()
  })

  engine.project.load(createProjectSchema(), true)
  await Promise.resolve()

  const { designer } = engine
  const projectDocument = designer.currentDocument
  const root = projectDocument.rootNode

  assert.ok(listenerCount(designer.dragon.emitter, core.DRAGON_EVENT.DRAGSTART) > 0)
  assert.ok(listenerCount(designer.dragon.emitter, core.DRAGON_EVENT.DRAG) > 0)
  assert.ok(listenerCount(designer.dragon.emitter, core.DRAGON_EVENT.DRAGEND) > 0)
  assert.ok(listenerCount(designer.selection.emitter, core.SELECTION_EVENT.CHANGE) > 0)
  assert.ok(listenerCount(designer.activeTracker.emitter, 'change') > 0)
  assert.ok(listenerCount(projectDocument.history.emitter, core.HISTORY_EVENT.STATE_CHANGE) > 0)

  let designerEventCalls = 0
  let dragonEventCalls = 0
  let selectionEventCalls = 0
  let detectingEventCalls = 0
  let activeTrackerEventCalls = 0
  designer.onEvent('probe:designer', () => {
    designerEventCalls += 1
  })
  designer.dragon.onDrag(() => {
    dragonEventCalls += 1
  })
  designer.selection.onSelectionChange(() => {
    selectionEventCalls += 1
  })
  designer.detecting.onDetectingChange(() => {
    detectingEventCalls += 1
  })
  designer.activeTracker.onChange(() => {
    activeTrackerEventCalls += 1
  })

  designer.detecting.capture(root)
  designer.activeTracker.track(root)
  designer.dragon.addSensor({ sensorAvailable: false })

  const browserListenerBaseline = globalThis.document.listenerCount()
  designer.dragon.boost(
    { type: core.DragObjectType.NodeData, data: { id: 'drag-node', componentName: 'Box' } },
    {
      type: 'mousedown',
      button: 0,
      which: 1,
      clientX: 1,
      clientY: 1,
      target: globalThis.document.body,
      view: globalThis.window,
    },
  )
  assert.ok(globalThis.document.listenerCount() > browserListenerBaseline)

  let observerPurges = 0
  designer.oobxList.push({
    compute() {},
    isPurged() {
      return false
    },
    purge() {
      observerPurges += 1
    },
  })

  designer.purge()

  assert.equal(listenerCount(designer.emitter), 0)
  assert.equal(listenerCount(designer.dragon.emitter), 0)
  assert.equal(listenerCount(designer.selection.emitter), 0)
  assert.equal(listenerCount(designer.detecting.emitter), 0)
  assert.equal(listenerCount(designer.activeTracker.emitter), 0)
  assert.equal(listenerCount(projectDocument.history.emitter, core.HISTORY_EVENT.STATE_CHANGE), 0)
  assert.equal(globalThis.document.listenerCount(), browserListenerBaseline)
  assert.deepEqual(designer.selection.selected, [])
  assert.equal(designer.detecting.current, null)
  assert.equal(designer.detecting.enable, true)
  assert.equal(designer.activeTracker.currentNode, undefined)
  assert.equal(designer.dragon.activeSensor, undefined)
  assert.equal(designer.dragon.dragging, false)
  assert.equal(designer.dragon.sensors.length, 0)
  assert.equal(designer.settingsManager.settings, undefined)
  assert.equal(observerPurges, 1)
  assert.equal(designer.oobxList.length, 0)

  const eventCallsBeforeProbe = [
    designerEventCalls,
    dragonEventCalls,
    selectionEventCalls,
    detectingEventCalls,
    activeTrackerEventCalls,
  ]
  designer.postEvent('probe:designer')
  designer.dragon.emitter.emit(core.DRAGON_EVENT.DRAG, {})
  designer.selection.emitter.emit(core.SELECTION_EVENT.CHANGE, [])
  designer.detecting.emitter.emit(core.DETECTING_EVENT.CHANGE, null)
  designer.activeTracker.emitter.emit('change', { node: root })
  assert.deepEqual(
    [designerEventCalls, dragonEventCalls, selectionEventCalls, detectingEventCalls, activeTrackerEventCalls],
    eventCallsBeforeProbe,
    'external listeners must not fire after disposal',
  )

  designer.purge()
  assert.equal(observerPurges, 1, 'purge must remain idempotent')

  designer.mount()
  await Promise.resolve()
  assert.ok(listenerCount(designer.dragon.emitter, core.DRAGON_EVENT.DRAGSTART) > 0)
  assert.ok(listenerCount(designer.selection.emitter, core.SELECTION_EVENT.CHANGE) > 0)
  assert.ok(listenerCount(designer.activeTracker.emitter, 'change') > 0)
  assert.ok(listenerCount(projectDocument.history.emitter, core.HISTORY_EVENT.STATE_CHANGE) > 0)
  assert.deepEqual(designer.selection.selected, [root.id])

  designer.purge()
  assert.equal(listenerCount(designer.dragon.emitter), 0)
  assert.equal(listenerCount(projectDocument.history.emitter, core.HISTORY_EVENT.STATE_CHANGE), 0)
})

test('editor destroy removes EventBus and EventEmitter listeners and remains reusable after engine restart', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const { editor } = engine
  t.after(async () => {
    await engine.destroy()
  })

  let hookCalls = 0
  let rawCalls = 0
  let busCalls = 0
  let destroyCalls = 0
  await editor.init({
    hooks: [
      {
        message: 'probe:hook',
        type: 'on',
        handler() {
          hookCalls += 1
        },
      },
    ],
  })
  editor.on('probe:raw', () => {
    rawCalls += 1
  })
  editor.eventBus.on('probe:bus', () => {
    busCalls += 1
  })
  editor.onDestroy(() => {
    destroyCalls += 1
  })

  editor.emit('probe:hook')
  editor.emit('probe:raw')
  editor.eventBus.emit('probe:bus')
  assert.deepEqual([hookCalls, rawCalls, busCalls], [1, 1, 1])

  await engine.destroy()
  assert.equal(destroyCalls, 1)
  assert.equal(editor.eventNames().length, 0)

  editor.emit('probe:hook')
  editor.emit('probe:raw')
  editor.eventBus.emit('probe:bus')
  assert.deepEqual([hookCalls, rawCalls, busCalls], [1, 1, 1])

  await engine.init()

  let restartedInitCalls = 0
  let restartedBusCalls = 0
  editor.onAfterInit(() => {
    restartedInitCalls += 1
  })
  editor.eventBus.on('probe:restarted', () => {
    restartedBusCalls += 1
  })
  await editor.init({})
  editor.eventBus.emit('probe:restarted')

  assert.equal(restartedInitCalls, 1)
  assert.equal(restartedBusCalls, 1)
})
