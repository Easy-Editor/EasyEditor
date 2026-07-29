import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCore } from './helpers/kernel.mjs'

const createDragEvent = (type, target) => ({
  type,
  button: 0,
  which: 1,
  clientX: 12,
  clientY: 24,
  target,
  view: globalThis.window,
  dataTransfer: {
    effectAllowed: 'none',
    setData() {},
  },
  preventDefault() {},
  stopPropagation() {},
})

test('Simulator.linkSnippet detaches a mutable schema for every drag from frozen material metadata', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  await engine.init()

  const simulator = new core.Simulator(engine.project, engine.designer)
  engine.project.mountSimulator(simulator)
  const componentMeta = engine.materials.registry.register({
    componentName: 'FrozenDashboardSnippet',
    snippets: [
      {
        title: 'Frozen dashboard snippet',
        schema: {
          componentName: 'FrozenDashboardSnippet',
          props: { text: 'snapshot value' },
          $dashboard: {
            rect: { height: 120, width: 240 },
          },
        },
      },
    ],
  })
  const snippet = componentMeta.snippets[0]
  const metadataSchema = snippet.schema
  const shell = globalThis.document.createElement('div')
  const draggedSchemas = []
  const coordinatesBeforeDropMutation = []

  const unlinkSnippet = simulator.linkSnippet(shell, snippet)
  const stopCapturing = engine.designer.dragon.onDragstart(event => {
    draggedSchemas.push(event.dragObject.data)
  })
  const stopMutating = engine.designer.dragon.onDragend(event => {
    const schema = event.dragObject.data
    const rect = schema.$dashboard.rect
    coordinatesBeforeDropMutation.push({ x: rect.x, y: rect.y })
    rect.x = 100 + draggedSchemas.length
    rect.y = 200 + draggedSchemas.length
  })

  t.after(async () => {
    unlinkSnippet()
    stopCapturing()
    stopMutating()
    await engine.destroy()
  })

  assert.equal(Object.isFrozen(metadataSchema), true)
  assert.equal(Object.isFrozen(metadataSchema.$dashboard.rect), true)

  shell.dispatchEvent(createDragEvent('dragstart', shell))
  assert.doesNotThrow(() => globalThis.document.dispatchEvent(createDragEvent('dragend', shell)))
  shell.dispatchEvent(createDragEvent('dragstart', shell))
  assert.doesNotThrow(() => globalThis.document.dispatchEvent(createDragEvent('dragend', shell)))

  assert.equal(draggedSchemas.length, 2)
  assert.notStrictEqual(draggedSchemas[0], metadataSchema)
  assert.notStrictEqual(draggedSchemas[0], draggedSchemas[1])
  assert.notStrictEqual(draggedSchemas[0].$dashboard.rect, metadataSchema.$dashboard.rect)
  assert.notStrictEqual(draggedSchemas[0].$dashboard.rect, draggedSchemas[1].$dashboard.rect)
  assert.deepEqual(coordinatesBeforeDropMutation, [
    { x: undefined, y: undefined },
    { x: undefined, y: undefined },
  ])
  assert.deepEqual(metadataSchema.$dashboard.rect, { height: 120, width: 240 })
})
