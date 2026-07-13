import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { loadCore } from './helpers/kernel.mjs'

const settle = async action => {
  try {
    const value = await action()
    return { status: 'fulfilled', value }
  } catch (error) {
    return { error, status: 'rejected' }
  }
}

test('precreated designer and project child services cannot reacquire resources after engine disposal', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())

  engine.project.load(createProjectSchema({ id: 'child-boundary' }), true)
  await engine.init()
  const root = engine.project.currentDocument.rootNode
  const shell = globalThis.document.createElement('div')
  await engine.destroy()

  const terminalOperations = [
    ['selection.add', () => engine.designer.selection.add('revived-selection')],
    ['selection.onSelectionChange', () => engine.designer.selection.onSelectionChange(() => {})],
    ['detecting.enable', () => (engine.designer.detecting.enable = false)],
    ['detecting.onDetectingChange', () => engine.designer.detecting.onDetectingChange(() => {})],
    ['activeTracker.track', () => engine.designer.activeTracker.track(root)],
    ['activeTracker.onChange', () => engine.designer.activeTracker.onChange(() => {})],
    ['dragon.addSensor', () => engine.designer.dragon.addSensor({ sensorAvailable: false })],
    ['dragon.onDragstart', () => engine.designer.dragon.onDragstart(() => {})],
    ['dragon.onDrag', () => engine.designer.dragon.onDrag(() => {})],
    ['dragon.onDragend', () => engine.designer.dragon.onDragend(() => {})],
    ['dragon.from', () => engine.designer.dragon.from(shell, () => null, 'mouse')],
    ['project.onSimulatorReady', () => engine.project.onSimulatorReady(() => {})],
    ['project.onRendererReady', () => engine.project.onRendererReady(() => {})],
    ['project.onDocumentAdd', () => engine.project.onDocumentAdd(() => {})],
    ['project.onDocumentRemove', () => engine.project.onDocumentRemove(() => {})],
    ['project.onCurrentDocumentChange', () => engine.project.onCurrentDocumentChange(() => {})],
  ]

  const results = []
  for (const [label, operation] of terminalOperations) {
    const result = await settle(operation)
    if (result.status === 'fulfilled' && typeof result.value === 'function') {
      result.value()
    }
    results.push([label, result.status])
  }

  assert.deepEqual(
    results,
    terminalOperations.map(([label]) => [label, 'rejected']),
  )
  assert.equal(shell.listenerCount(), 0)
  assert.deepEqual(engine.designer.selection.selected, [])
  assert.equal(engine.designer.detecting.enable, true)
  assert.equal(engine.designer.activeTracker.currentNode, undefined)
  assert.equal(engine.designer.dragon.sensors.length, 0)
})

test('precreated child services reactivate on restart without reviving old listeners', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => engine.destroy())

  engine.project.load(createProjectSchema({ id: 'child-generation-one' }), true)
  await engine.init()

  let oldSelectionCalls = 0
  let oldDetectingCalls = 0
  let oldTrackerCalls = 0
  let oldSimulatorCalls = 0
  let oldRendererCalls = 0
  engine.designer.selection.onSelectionChange(() => {
    oldSelectionCalls += 1
  })
  engine.designer.detecting.onDetectingChange(() => {
    oldDetectingCalls += 1
  })
  engine.designer.activeTracker.onChange(() => {
    oldTrackerCalls += 1
  })
  engine.project.onSimulatorReady(() => {
    oldSimulatorCalls += 1
  })
  engine.project.onRendererReady(() => {
    oldRendererCalls += 1
  })

  await engine.destroy()
  await engine.init()
  engine.project.load(createProjectSchema({ id: 'child-generation-two' }), true)
  await Promise.resolve()
  const root = engine.project.currentDocument.rootNode

  let newSelectionCalls = 0
  let newDetectingCalls = 0
  let newTrackerCalls = 0
  let newSimulatorCalls = 0
  let newRendererCalls = 0
  const cleanups = [
    engine.designer.selection.onSelectionChange(() => {
      newSelectionCalls += 1
    }),
    engine.designer.detecting.onDetectingChange(() => {
      newDetectingCalls += 1
    }),
    engine.designer.activeTracker.onChange(() => {
      newTrackerCalls += 1
    }),
    engine.project.onSimulatorReady(() => {
      newSimulatorCalls += 1
    }),
    engine.project.onRendererReady(() => {
      newRendererCalls += 1
    }),
  ]

  engine.designer.selection.clear()
  engine.designer.detecting.capture(root)
  engine.designer.activeTracker.track(root)
  engine.project.mountSimulator({ purge() {} })
  engine.project.setRendererReady({})

  const shell = globalThis.document.createElement('div')
  const releaseShell = engine.designer.dragon.from(shell, () => null, 'mouse')
  assert.equal(shell.listenerCount('mousedown'), 1)
  releaseShell()
  assert.equal(shell.listenerCount('mousedown'), 0)

  assert.deepEqual(
    {
      newCalls: [newSelectionCalls, newDetectingCalls, newTrackerCalls, newSimulatorCalls, newRendererCalls],
      oldCalls: [oldSelectionCalls, oldDetectingCalls, oldTrackerCalls, oldSimulatorCalls, oldRendererCalls],
    },
    {
      newCalls: [1, 1, 1, 1, 1],
      oldCalls: [0, 0, 0, 0, 0],
    },
  )

  cleanups.forEach(cleanup => cleanup())
})
