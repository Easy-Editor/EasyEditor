import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

function createStructuralSchema() {
  const schema = createProjectSchema()
  schema.componentsTree[0].children = [
    { id: 'left', componentName: 'Text', props: { label: 'left' }, children: [] },
    {
      id: 'target',
      componentName: 'Container',
      props: { label: 'target' },
      children: [
        { id: 'target-a', componentName: 'Text', props: { label: 'a' }, children: [] },
        { id: 'target-b', componentName: 'Text', props: { label: 'b' }, children: [] },
      ],
    },
    { id: 'right', componentName: 'Text', props: { label: 'right' }, children: [] },
    { id: 'replace-me', componentName: 'Text', props: { label: 'old' }, children: [] },
  ]
  return schema
}

async function createHarness(t) {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.project.load(createStructuralSchema(), true)
  return { core, document: engine.project.currentDocument, engine }
}

const childIds = node => node.childrenNodes.map(child => child.id)

test('the canonical structural catalog commits as one ordered undo/redo unit', async t => {
  const { core, document, engine } = await createHarness(t)
  assert.deepEqual(core.EDITOR_COMMAND_TYPES, [
    'insertNode',
    'updateProps',
    'removeNode',
    'moveNode',
    'replace',
    'insertBefore',
    'insertAfter',
    'wrap',
    'unwrap',
  ])
  const original = structuredClone(document.exportRaw())
  const originalTarget = document.getNode('target')
  const originalTargetChildren = originalTarget.childrenNodes.slice()

  const result = engine.transactions.run([
    {
      type: 'insertBefore',
      nodeId: 'target',
      node: { id: 'before-target', componentName: 'Text', props: { label: 'before' }, children: [] },
    },
    {
      type: 'insertAfter',
      nodeId: 'target',
      node: { id: 'after-target', componentName: 'Text', props: { label: 'after' }, children: [] },
    },
    {
      type: 'wrap',
      nodeId: 'target',
      node: { id: 'wrapper', componentName: 'Container', props: { label: 'wrapper' }, children: [] },
    },
    { type: 'unwrap', nodeId: 'wrapper' },
    {
      type: 'replace',
      nodeId: 'replace-me',
      node: {
        id: 'replacement',
        componentName: 'Container',
        props: { label: 'new' },
        children: [{ id: 'replacement-child', componentName: 'Text', props: {}, children: [] }],
      },
    },
  ])

  assert.equal(result.ok, true)
  assert.equal(result.commandCount, 5)
  assert.deepEqual(childIds(document.root), ['left', 'before-target', 'target', 'after-target', 'right', 'replacement'])
  assert.strictEqual(document.getNode('target'), originalTarget, 'wrap/unwrap must preserve target identity')
  assert.deepEqual(document.getNode('target').childrenNodes, originalTargetChildren)
  assert.equal(document.getNode('replace-me'), null)
  assert.deepEqual(childIds(document.getNode('replacement')), ['replacement-child'])
  assert.equal(document.history.isUndoable(), true)

  document.history.back()
  assert.deepEqual(document.exportRaw(), original)
  assert.equal(document.history.isUndoable(), false, 'one undo must consume the complete structural transaction')

  document.history.forward()
  assert.deepEqual(childIds(document.root), ['left', 'before-target', 'target', 'after-target', 'right', 'replacement'])
})

test('unwrap promotes every child at the wrapper index without changing child identity or order', async t => {
  const { document, engine } = await createHarness(t)
  const first = document.getNode('target-a')
  const second = document.getNode('target-b')

  const result = engine.commands.execute({ type: 'unwrap', nodeId: 'target' })

  assert.deepEqual(childIds(document.root), ['left', 'target-a', 'target-b', 'right', 'replace-me'])
  assert.strictEqual(document.getNode('target-a'), first)
  assert.strictEqual(document.getNode('target-b'), second)
  assert.equal(document.getNode('target'), null)
  assert.deepEqual(result.affectedNodeIds, ['target', 'target-a', 'target-b', document.root.id])

  document.history.back()
  assert.deepEqual(childIds(document.root), ['left', 'target', 'right', 'replace-me'])
  assert.deepEqual(childIds(document.getNode('target')), ['target-a', 'target-b'])
})

test('generated structural IDs are returned and stable in the committed schema', async t => {
  const { document, engine } = await createHarness(t)

  const before = engine.commands.execute({
    type: 'insertBefore',
    nodeId: 'target',
    node: { componentName: 'Text', props: { generated: 'before' }, children: [] },
  })
  const beforeId = before.affectedNodeIds[0]
  assert.match(beforeId, /^node-/)
  assert.equal(document.getNode(beforeId).getPropValue('generated'), 'before')

  const wrap = engine.commands.execute({
    type: 'wrap',
    nodeId: 'target',
    node: { componentName: 'Container', props: { generated: 'wrapper' } },
  })
  const wrapperId = wrap.affectedNodeIds[0]
  assert.match(wrapperId, /^node-/)
  assert.deepEqual(childIds(document.getNode(wrapperId)), ['target'])

  const replace = engine.commands.execute({
    type: 'replace',
    nodeId: 'replace-me',
    node: { componentName: 'Text', props: { generated: 'replacement' }, children: [] },
  })
  const replacementId = replace.affectedNodeIds.find(id => id.startsWith('node-'))
  assert.ok(replacementId)
  assert.equal(document.getNode(replacementId).getPropValue('generated'), 'replacement')
})

test('root, missing, foreign, wrapper-shape, and ID violations reject before durable effects', async t => {
  const { core, document, engine } = await createHarness(t)
  const foreignEngine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => foreignEngine.destroy())
  await foreignEngine.init()
  const foreignSchema = createStructuralSchema()
  foreignSchema.componentsTree[0].docId = 'foreign-page'
  foreignEngine.project.load(foreignSchema, true)

  const rootCases = [
    { type: 'replace', nodeId: document.root.id, node: { componentName: 'Text', props: {} } },
    { type: 'insertBefore', nodeId: document.root.id, node: { componentName: 'Text', props: {} } },
    { type: 'insertAfter', nodeId: document.root.id, node: { componentName: 'Text', props: {} } },
    { type: 'wrap', nodeId: document.root.id, node: { componentName: 'Container', props: {} } },
    { type: 'unwrap', nodeId: document.root.id },
  ]
  for (const command of rootCases) {
    const before = structuredClone(document.exportRaw())
    const error = await captureFailure(() => engine.commands.execute(command))
    assert.match(error.message, /root node/i, command.type)
    assert.deepEqual(document.exportRaw(), before, command.type)
    assert.equal(document.history.isUndoable(), false, command.type)
  }

  const missing = await captureFailure(() =>
    engine.commands.execute({
      type: 'insertAfter',
      nodeId: 'missing-node',
      node: { id: 'must-not-exist', componentName: 'Text', props: {} },
    }),
  )
  assert.match(missing.message, /does not exist/i)
  assert.equal(document.getNode('must-not-exist'), null)

  const foreign = await captureFailure(() =>
    engine.commands.execute({
      type: 'unwrap',
      documentId: foreignEngine.project.currentDocument.id,
      nodeId: 'target',
    }),
  )
  assert.match(foreign.message, /cross-document/i)

  const wrapperChildren = await captureFailure(() =>
    engine.commands.execute({
      type: 'wrap',
      nodeId: 'target',
      node: {
        id: 'invalid-wrapper',
        componentName: 'Container',
        props: {},
        children: [{ id: 'ambiguous-child', componentName: 'Text', props: {} }],
      },
    }),
  )
  assert.equal(wrapperChildren.name, 'CommandValidationError')
  assert.ok(wrapperChildren.issues.some(issue => issue.code === 'wrap.children.notEmpty'))
  assert.equal(document.getNode('invalid-wrapper'), null)

  const unknownField = await captureFailure(() =>
    engine.commands.execute({ type: 'unwrap', nodeId: 'target', unexpected: true }),
  )
  assert.equal(unknownField.name, 'CommandValidationError')
  assert.ok(unknownField.issues.some(issue => issue.code === 'command.field.unsupported'))

  const duplicateTree = await captureFailure(() =>
    engine.commands.execute({
      type: 'insertNode',
      parentId: document.root.id,
      node: {
        id: 'duplicate-in-command',
        componentName: 'Container',
        props: {},
        children: [{ id: 'duplicate-in-command', componentName: 'Text', props: {} }],
      },
    }),
  )
  assert.equal(duplicateTree.name, 'CommandValidationError')
  assert.ok(duplicateTree.issues.some(issue => issue.code === 'node.id.duplicate'))

  const nestedCollision = await captureFailure(() =>
    engine.commands.execute({
      type: 'insertAfter',
      nodeId: 'right',
      node: {
        id: 'new-parent',
        componentName: 'Container',
        props: {},
        children: [{ id: 'target-a', componentName: 'Text', props: {} }],
      },
    }),
  )
  assert.match(nestedCollision.message, /already exists/i)
  assert.equal(document.getNode('new-parent'), null)
})

test('a later impossible structural command rolls schema, history, materials, and ordering back', async t => {
  const { core, document, engine } = await createHarness(t)
  const before = structuredClone(document.exportRaw())
  const beforeMaterials = engine.materials.captureTransactionState()
  let childEvents = 0
  let materialEvents = 0
  const disposeChildren = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_CHILDREN_CHANGE, () => {
    childEvents += 1
  })
  const disposeMaterials = engine.materials.registry.subscribe(() => {
    materialEvents += 1
  })
  t.after(disposeChildren)
  t.after(disposeMaterials)

  const error = await captureFailure(() =>
    engine.transactions.run([
      {
        type: 'insertBefore',
        nodeId: 'target',
        node: { id: 'temporary-structural-node', componentName: 'Text', props: {}, children: [] },
      },
      { type: 'unwrap', nodeId: document.root.id },
    ]),
  )

  assert.match(error.message, /root node/i)
  assert.deepEqual(document.exportRaw(), before)
  assert.equal(document.getNode('temporary-structural-node'), null)
  assert.equal(document.history.isUndoable(), false)
  assert.deepEqual(engine.materials.captureTransactionState(), beforeMaterials)
  assert.equal(childEvents, 0)
  assert.equal(materialEvents, 0)
})
