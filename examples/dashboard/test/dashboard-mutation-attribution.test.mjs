import assert from 'node:assert/strict'
import test from 'node:test'

import { createDashboardMutationAttribution } from '../src/editor/agent/persistence/mutation-attribution.mjs'
import {
  createChildrenOrderSlotKey,
  createFieldSlotAliases,
  createFieldSlotKey,
  createNodeStructuralSlotKeys,
  createNodeSubtreeSlotKey,
} from '../src/editor/agent/persistence/provenance.mjs'

const authority = Object.freeze({ projectId: 'attribution-project', branchId: 'main' })

test('field attribution projects ancestors and descendants, converts extras, and classifies human versus external', () => {
  let humanActive = true
  const attribution = createDashboardMutationAttribution({
    authority,
    isHumanActivityActive: () => humanActive,
  })
  const node = { id: 'node-a' }
  const field = attribution.captureFieldMutation({
    prop: { owner: node, path: ['style'] },
    oldValue: { color: 'red', layout: { width: 100 } },
    newValue: { color: 'blue', layout: { width: 200, height: 80 } },
  })
  const expected = new Set([
    ...createFieldSlotAliases({ ...authority, nodeId: node.id, root: 'props', path: ['style'] }),
    createFieldSlotKey({ ...authority, nodeId: node.id, root: 'props', path: ['style', 'color'] }),
    createFieldSlotKey({ ...authority, nodeId: node.id, root: 'props', path: ['style', 'layout'] }),
    createFieldSlotKey({ ...authority, nodeId: node.id, root: 'props', path: ['style', 'layout', 'width'] }),
    createFieldSlotKey({ ...authority, nodeId: node.id, root: 'props', path: ['style', 'layout', 'height'] }),
  ])
  assert.equal(field.source, 'human')
  assert.deepEqual(new Set(field.slotKeys), expected)

  humanActive = false
  const extra = attribution.captureFieldMutation({
    prop: { owner: node, path: ['___hidden___'] },
    oldValue: false,
    newValue: true,
  })
  assert.equal(extra.source, 'external')
  assert.deepEqual(
    extra.slotKeys,
    createFieldSlotAliases({ ...authority, nodeId: node.id, root: 'extras', path: ['hidden'] }),
  )

  const ambiguousArray = attribution.captureFieldMutation({
    prop: { owner: node, path: ['items'] },
    oldValue: [{ id: 'a' }],
    newValue: [{ id: 'b' }],
  })
  assert.deepEqual(ambiguousArray, { source: 'unknown', slotKeys: [], ambiguous: true })
})

test('structural attribution covers node identities, parent order, and ancestor subtrees', () => {
  const root = { id: 'root', parent: null, childrenNodes: [] }
  const parent = { id: 'parent', parent: root, childrenNodes: [] }
  const child = { id: 'child', parent, childrenNodes: [] }
  root.childrenNodes = [parent]
  parent.childrenNodes = [child]
  const attribution = createDashboardMutationAttribution({ authority, isHumanActivityActive: () => true })

  const nodeMutation = attribution.captureStructuralMutation({ node: child })
  const expectedNodeSlots = new Set([
    ...createNodeStructuralSlotKeys({ ...authority, nodeId: child.id }),
    createChildrenOrderSlotKey({ ...authority, parentId: parent.id }),
    createNodeSubtreeSlotKey({ ...authority, nodeId: parent.id }),
    createNodeSubtreeSlotKey({ ...authority, nodeId: root.id }),
  ])
  assert.deepEqual(new Set(nodeMutation.slotKeys), expectedNodeSlots)

  const childrenMutation = attribution.captureStructuralMutation({ node: parent }, 'children')
  assert.deepEqual(
    new Set(childrenMutation.slotKeys),
    new Set([
      createChildrenOrderSlotKey({ ...authority, parentId: parent.id }),
      createNodeSubtreeSlotKey({ ...authority, nodeId: parent.id }),
      createNodeSubtreeSlotKey({ ...authority, nodeId: root.id }),
    ]),
  )
})

test('Agent scope suppresses listener attribution synchronously and never leaks after failures', () => {
  const attribution = createDashboardMutationAttribution({ authority, isHumanActivityActive: () => true })
  const node = { id: 'node-a' }
  assert.throws(
    () =>
      attribution.runAgentMutation('agent-call', () => {
        assert.equal(
          attribution.captureFieldMutation({ prop: { owner: node, path: ['text'] }, oldValue: 'a', newValue: 'b' }),
          null,
        )
        assert.equal(attribution.captureUnknownMutation(), null)
        throw new Error('Core observer failed')
      }),
    /Core observer failed/,
  )
  assert.equal(attribution.activeAgentCallId, null)
  assert.equal(
    attribution.captureFieldMutation({ prop: { owner: node, path: ['text'] }, oldValue: 'b', newValue: 'c' }).source,
    'human',
  )
})
