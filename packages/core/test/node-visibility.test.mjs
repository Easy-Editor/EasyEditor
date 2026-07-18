import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { loadCore } from './helpers/kernel.mjs'

test('hide stores hidden state before publishing the resulting visibility', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  engine.loadProject(createProjectSchema({ id: 'node-visibility-project' }), true)

  const node = engine.project.currentDocument.root
  const nodeEvents = []
  const designerEvents = []
  const disposeNodeEvent = node.onVisibleChange(visible => {
    nodeEvents.push({ visible, hidden: node.hidden })
  })
  const disposeDesignerEvent = engine.designer.onEvent(
    core.DESIGNER_EVENT.NODE_VISIBLE_CHANGE,
    (observedNode, visible) => {
      designerEvents.push({ node: observedNode, visible, hidden: observedNode.hidden })
    },
  )
  t.after(disposeNodeEvent)
  t.after(disposeDesignerEvent)

  node.hide(true)
  node.hide(false)

  assert.deepEqual(
    nodeEvents.map(event => event.visible),
    [false, true],
  )
  assert.deepEqual(
    nodeEvents.map(event => event.hidden),
    [true, false],
  )
  assert.deepEqual(
    designerEvents.map(event => event.visible),
    [false, true],
  )
  assert.deepEqual(
    designerEvents.map(event => event.hidden),
    [true, false],
  )
  assert.ok(
    designerEvents.every(event => event.node === node),
    'designer events must preserve node identity',
  )
  assert.equal(node.hidden, false)
})
