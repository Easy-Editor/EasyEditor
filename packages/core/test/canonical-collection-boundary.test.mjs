import assert from 'node:assert/strict'
import test from 'node:test'
import { intercept, observe, reaction } from 'mobx'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

function createCollectionSchema() {
  const schema = createProjectSchema()
  schema.componentsTree[0].props = {
    title: 'before',
    settings: { enabled: true },
  }
  schema.componentsTree[0].children = [
    { id: 'first-child', componentName: 'Text', props: { label: 'first' }, children: [] },
    { id: 'second-child', componentName: 'Text', props: { label: 'second' }, children: [] },
  ]
  return schema
}

async function createEngine(t, trustPolicy = 'legacyTrusted') {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(createCollectionSchema(), true)
  return { core, document: engine.project.currentDocument, engine }
}

function captureModelState(engine) {
  return {
    documents: engine.project.documents.map(document => ({
      historyData: document.history.hotData,
      historyState: document.history.getState(),
      id: document.id,
      mutationVersion: document.mutationVersion,
      redoable: document.history.isRedoable(),
      schema: structuredClone(document.exportRaw()),
      undoable: document.history.isUndoable(),
    })),
    project: structuredClone(engine.project.export()),
  }
}

test('NodeChildren.children and Props.items expose frozen non-observable snapshots', async t => {
  const { document, engine } = await createEngine(t)
  const root = document.root
  const childrenSnapshot = root.children.children
  const itemsSnapshot = root.props.items
  const originalChildIds = childrenSnapshot.map(node => node.id)
  const originalPropKeys = itemsSnapshot.map(prop => String(prop.key))

  for (const [label, snapshot] of [
    ['NodeChildren.children', childrenSnapshot],
    ['Props.items', itemsSnapshot],
  ]) {
    assert.equal(Object.isFrozen(snapshot), true, `${label} must be a frozen snapshot`)
    assert.throws(() => intercept(snapshot, change => change), /Cannot obtain administration/)
    assert.throws(() => observe(snapshot, () => undefined), /Cannot obtain administration/)
    assert.throws(() => snapshot.push(null), TypeError)
    assert.equal(Reflect.set(snapshot, 0, null), false)
  }

  engine.commands.execute({
    type: 'insertNode',
    parentId: root.id,
    node: { id: 'typed-child', componentName: 'Text', props: {}, children: [] },
  })
  engine.commands.execute({
    type: 'updateProps',
    nodeId: root.id,
    props: { typedProp: 'committed' },
  })

  assert.deepEqual(
    childrenSnapshot.map(node => node.id),
    originalChildIds,
    'old child snapshots must not alias canonical state',
  )
  assert.deepEqual(
    itemsSnapshot.map(prop => String(prop.key)),
    originalPropKeys,
    'old prop snapshots must not alias canonical state',
  )
  assert.deepEqual(
    root.children.children.map(node => node.id),
    [...originalChildIds, 'typed-child'],
  )
  assert.equal(root.getPropValue('typedProp'), 'committed')
  assert.ok(root.props.items.some(prop => prop.key === 'typedProp'))
})

test('agentRestricted reactions over public collection getters cannot borrow typed transaction authority', async t => {
  const { document, engine } = await createEngine(t, 'agentRestricted')
  const root = document.root
  const blocked = []
  let childrenDeliveries = 0
  let itemsDeliveries = 0
  const disposeChildrenReaction = reaction(
    () => root.children.children.map(node => node.id).join(','),
    () => {
      childrenDeliveries += 1
      try {
        root.setPropValue('borrowedChildrenAuthority', true)
      } catch (error) {
        blocked.push(error)
      }
    },
  )
  const disposeItemsReaction = reaction(
    () => root.props.items.map(prop => String(prop.key)).join(','),
    () => {
      itemsDeliveries += 1
      try {
        root.setPropValue('borrowedItemsAuthority', true)
      } catch (error) {
        blocked.push(error)
      }
    },
  )
  t.after(() => {
    disposeChildrenReaction()
    disposeItemsReaction()
  })

  engine.commands.execute({
    type: 'insertNode',
    parentId: root.id,
    node: { id: 'restricted-typed-child', componentName: 'Text', props: {}, children: [] },
  })
  engine.commands.execute({
    type: 'updateProps',
    nodeId: root.id,
    props: { restrictedTypedProp: 'committed' },
  })

  assert.equal(childrenDeliveries, 1)
  assert.equal(itemsDeliveries, 1)
  assert.equal(blocked.length, 2)
  for (const error of blocked) {
    assert.equal(error.name, 'PolicyViolation')
    assert.equal(error.capability, 'model.mutation')
    assert.equal(error.rule, 'agentRestricted.model.mutation.deny')
  }
  assert.equal(root.getPropValue('borrowedChildrenAuthority'), undefined)
  assert.equal(root.getPropValue('borrowedItemsAuthority'), undefined)
  assert.equal(document.getNode('restricted-typed-child')?.parent, root)
  assert.equal(root.getPropValue('restrictedTypedProp'), 'committed')
})

test('NodeChildren.find gives callbacks a frozen snapshot instead of the canonical array', async t => {
  const { document, engine } = await createEngine(t)
  const root = document.root
  const before = captureModelState(engine)
  let callbackArray

  const found = root.children.find((node, index, array) => {
    callbackArray ??= array
    assert.strictEqual(array, callbackArray, 'one find traversal must share one stable snapshot')
    assert.equal(Object.isFrozen(array), true)
    assert.equal(Reflect.set(array, index, root), false)
    assert.throws(() => array.push(root), TypeError)
    return node.id === 'second-child'
  })

  assert.equal(found?.id, 'second-child')
  assert.deepEqual(
    root.children.children.map(node => node.id),
    ['first-child', 'second-child'],
  )
  assert.deepEqual(document.exportRaw(), before.documents[0].schema)
  assert.equal(document.mutationVersion, before.documents[0].mutationVersion)
  assert.equal(document.history.getState(), before.documents[0].historyState)
})

test('foreign or duplicate Node and foreign Prop ingress fail atomically', async t => {
  const { core, document, engine } = await createEngine(t)
  const root = document.root
  const canonicalChild = document.getNode('first-child')
  const otherDocument = engine.project.createDocument({
    docId: 'foreign-document',
    id: 'foreign-root',
    componentName: 'Page',
    props: { settings: { enabled: false } },
    children: [],
  })
  const duplicateIdentity = new core.Node(document, {
    id: canonicalChild.id,
    componentName: 'Text',
    props: { label: 'forged duplicate' },
    children: [],
  })
  const targetProp = root.getProp('settings', false)
  const foreignProp = otherDocument.root.getProp('settings', false).get('enabled', false)
  const before = captureModelState(engine)

  const attempts = [
    ['cross-document Node', () => root.children.insert(otherDocument.root), /foreign or unregistered Node identity/],
    [
      'unregistered duplicate-id Node',
      () => root.children.insert(duplicateIdentity),
      /foreign or unregistered Node identity/,
    ],
    ['foreign Prop', () => targetProp.set('enabled', foreignProp), /foreign or mismatched child Prop identity/],
  ]

  for (const [label, attempt, expected] of attempts) {
    const error = await captureFailure(attempt, `${label} ingress must fail`)
    assert.match(error.message, expected)
    assert.deepEqual(captureModelState(engine), before, `${label} must not alter schema, version, or history`)
  }

  assert.strictEqual(document.getNode(canonicalChild.id), canonicalChild)
  assert.equal(duplicateIdentity.parent, null)
  assert.equal(otherDocument.root.parent, null)
  assert.strictEqual(targetProp.get('enabled', false)?.parent, targetProp)
  assert.strictEqual(foreignProp.owner, otherDocument.root)
})
