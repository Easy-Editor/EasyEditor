import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCore } from './helpers/kernel.mjs'

const projectSchema = () => ({
  id: 'node-disposal-project',
  version: '0.0.1',
  componentsMap: [],
  componentsTree: [
    {
      docId: 'node-disposal-document',
      id: 'root',
      componentName: 'Page',
      props: {},
      children: [{ id: 'leaf', componentName: 'Text', props: {}, children: [] }],
    },
  ],
})

async function createHarness(t) {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.project.load(projectSchema(), true)
  return { core, document: engine.project.currentDocument, engine }
}

function captureEmptyObservableCollections(node) {
  node.props.import(null)
  assert.equal(node.props.items.length, 0)
  assert.equal(node.children.children.length, 0)
  return {
    children: node.children.children,
    items: node.props.items,
  }
}

function assertDetachedCollectionsDoNotMutateDocument(document, collections, message) {
  const mutationVersion = document.mutationVersion
  assert.equal(Object.isFrozen(collections.children), true)
  assert.equal(Object.isFrozen(collections.items), true)
  assert.throws(() => collections.children.push(null), TypeError)
  assert.throws(() => collections.items.push(null), TypeError)
  assert.equal(document.mutationVersion, mutationVersion, message)
}

test('engine destroy recursively disposes cached descendant observable collections', async t => {
  const { document, engine } = await createHarness(t)
  const collections = captureEmptyObservableCollections(document.getNode('leaf'))

  await engine.destroy()

  assertDetachedCollectionsDoNotMutateDocument(
    document,
    collections,
    'detached descendant arrays must not retain active mutation interceptors after destroy',
  )
})

test('document import disposes cached observable collections from removed nodes', async t => {
  const { document } = await createHarness(t)
  const collections = captureEmptyObservableCollections(document.getNode('leaf'))

  document.import({
    docId: document.id,
    id: 'root',
    componentName: 'Page',
    props: {},
    children: [],
  })

  assertDetachedCollectionsDoNotMutateDocument(
    document,
    collections,
    'removed node arrays must not retain mutation interceptors after document import',
  )
})

test('node removal disposes cached observable collections from the removed subtree', async t => {
  const { document } = await createHarness(t)
  const leaf = document.getNode('leaf')
  const collections = captureEmptyObservableCollections(leaf)

  document.removeNode(leaf)

  assert.equal(document.getNode('leaf'), null)
  assertDetachedCollectionsDoNotMutateDocument(
    document,
    collections,
    'removed node arrays must not retain mutation interceptors after purge',
  )
})

test('removing a parent disposes every adjacent child without leaving document-map zombies', async t => {
  const { document } = await createHarness(t)
  const parent = document.insertNode(document.root, {
    id: 'parent-with-siblings',
    componentName: 'Container',
    props: {},
    children: ['a', 'b', 'c'].map(id => ({ id, componentName: 'Text', props: {}, children: [] })),
  })
  const children = [...parent.children.children]

  document.removeNode(parent)

  assert.equal(document.getNode(parent.id), null)
  for (const child of children) {
    assert.equal(document.getNode(child.id), null)
    assert.equal(child.parent, null)
    assert.equal(child.isPurged, true)
    assert.throws(() => child.setPropValue('title', 'zombie'), /node generation is disposed/)
  }
})

test('removed Node, Props, Prop, NodeChildren, and SettingField references are terminal', async t => {
  const { document } = await createHarness(t)
  const leaf = document.getNode('leaf')
  const props = leaf.props
  const prop = leaf.getExtraProp('title', false)
  const children = leaf.children
  const field = leaf.settingEntry.get('title')
  let nodeDeliveries = 0
  let childrenDeliveries = 0
  let fieldDeliveries = 0

  leaf.onPropChange(() => {
    nodeDeliveries += 1
  })
  children.onChange(() => {
    childrenDeliveries += 1
  })
  field.emitter.on('zombie', () => {
    fieldDeliveries += 1
  })

  document.removeNode(leaf)
  const mutationVersion = document.mutationVersion
  const schema = document.exportRaw()
  const historyState = document.history.getState()

  for (const operation of [
    () => leaf.setPropValue('title', 'zombie'),
    () => props.setPropValue('title', 'zombie'),
    () => prop.setValue('zombie'),
    () => children.onChange(() => undefined),
    () => leaf.onPropChange(() => undefined),
    () => field.setValue('zombie'),
    () => field.setExpanded(false),
    () => field.emitter.on('zombie', () => undefined),
  ]) {
    assert.throws(operation, /generation is disposed/)
  }

  assert.throws(() => leaf.emitPropChange({ value: 'zombie' }), /node generation is disposed/)
  assert.throws(() => field.emitter.emit('zombie'), /setting field event bus generation is disposed/)
  assert.equal(leaf.emitter.listenerCount(), 0)
  assert.equal(children.emitter.listenerCount(), 0)
  assert.equal(field.emitter.listenerCount(), 0)
  assert.deepEqual(
    { childrenDeliveries, fieldDeliveries, nodeDeliveries },
    {
      childrenDeliveries: 0,
      fieldDeliveries: 0,
      nodeDeliveries: 0,
    },
  )
  assert.equal(document.mutationVersion, mutationVersion)
  assert.deepEqual(document.exportRaw(), schema)
  assert.equal(document.history.getState(), historyState)
})

test('node disposal seals retained references even when EventEmitter cleanup throws', async t => {
  const { document } = await createHarness(t)
  const leaf = document.getNode('leaf')
  let deliveries = 0
  leaf.emitter.on('zombie', () => {
    deliveries += 1
  })
  leaf.emitter.on('removeListener', event => {
    if (event === 'zombie') throw new Error('listener cleanup failed')
  })

  assert.throws(() => document.removeNode(leaf), /Node removal completed with errors/)
  assert.equal(document.getNode('leaf'), null)
  assert.throws(() => leaf.setPropValue('title', 'zombie'), /node generation is disposed/)
  assert.throws(() => leaf.emitter.emit('zombie'), /node event bus generation is disposed/)
  assert.equal(deliveries, 0)
})

test('replacing Props purges the old instance while assigning the same instance is a no-op', async t => {
  const { core, document } = await createHarness(t)
  const root = document.root
  root.props.import(null)
  const detachedItems = root.props.items
  const replacement = new core.Props(root, { replacement: true })

  root.setProps(replacement)
  const afterReplacement = document.mutationVersion
  root.setProps(replacement)
  assert.equal(document.mutationVersion, afterReplacement, 'assigning the current Props instance must remain a no-op')

  assert.equal(Object.isFrozen(detachedItems), true)
  assert.throws(() => detachedItems.push(null), TypeError)
  assert.equal(
    document.mutationVersion,
    afterReplacement,
    'the cached items array from the replaced Props instance must be detached',
  )
})

test('Document removal terminally owns detached node graphs across engine restart', async t => {
  const { document, engine } = await createHarness(t)
  const orphan = document.createNode({
    id: 'detached-orphan',
    componentName: 'Container',
    props: {},
    children: [{ id: 'detached-child', componentName: 'Text', props: {}, children: [] }],
  })
  const child = document.getNode('detached-child')
  let deliveries = 0
  orphan.emitter.on('zombie', () => {
    deliveries += 1
  })

  document.remove()

  assert.equal(document.root, null)
  assert.equal(orphan.isPurged, true)
  assert.equal(child.isPurged, true)
  assert.equal(orphan.emitter.listenerCount(), 0)
  assert.throws(() => orphan.emitter.emit('zombie'), /node event bus generation is disposed/)

  await engine.destroy()
  await engine.init()

  assert.throws(() => orphan.setPropValue('title', 'revived'), /node generation is disposed/)
  assert.throws(() => orphan.emitter.emit('zombie'), /node event bus generation is disposed/)
  assert.equal(deliveries, 0)
})

test('Document is the identity owner for root, attached, and detached removal paths', async t => {
  const { document, engine } = await createHarness(t)
  const orphan = document.createNode({ id: 'direct-orphan', componentName: 'Text', props: {}, children: [] })
  const leaf = document.getNode('leaf')

  assert.throws(() => document.removeNode(document.root), /Cannot remove the document root node/)
  assert.strictEqual(document.root.id, 'root')

  document.removeNode(orphan)
  assert.equal(document.getNode(orphan.id), null)
  assert.equal(orphan.isPurged, true)

  leaf.purge()
  assert.equal(document.getNode(leaf.id), null)
  assert.equal(leaf.isPurged, true)

  assert.equal('internalUnlinkDocument' in engine.project, false)
})

test('public subgraph purge coordinates through its owner instead of sealing a live graph', async t => {
  const { document } = await createHarness(t)
  const root = document.root
  const title = root.getExtraProp('title', false)
  const schema = document.exportRaw()

  assert.throws(() => root.children.purge(), /coordinated by its owning Node/)
  assert.throws(() => root.props.purge(), /coordinated by its owning Node/)
  assert.deepEqual(document.exportRaw(), schema)

  title.purge()
  assert.equal(root.getExtraProp('title', false), null)
  assert.throws(() => title.setValue('revived'), /prop generation is disposed/)
})

test('removal continues through sibling cleanup failures and leaves no structural zombies', async t => {
  const { document } = await createHarness(t)
  const parent = document.insertNode(document.root, {
    id: 'failing-parent',
    componentName: 'Container',
    props: {},
    children: ['failure-a', 'failure-b', 'failure-c'].map(id => ({
      id,
      componentName: 'Text',
      props: {},
      children: [],
    })),
  })
  const children = [...parent.children.children]
  children[0].emitter.on('zombie', () => undefined)
  children[0].emitter.on('removeListener', event => {
    if (event === 'zombie') throw new Error('first sibling cleanup failed')
  })

  assert.throws(() => document.removeNode(parent), /completed with errors/)

  for (const node of [parent, ...children]) {
    assert.equal(document.getNode(node.id), null)
    assert.equal(node.isPurged, true)
    assert.throws(() => node.setPropValue('title', 'zombie'), /node generation is disposed/)
  }
  assert.equal(parent.parent, null)
  assert.equal(document.root.children.has(parent), false)
})

test('Document seals before cleanup callbacks and publishes removal exactly once', async t => {
  const { document, engine } = await createHarness(t)
  const oldRoot = document.root
  let removeEvents = 0
  let nestedError
  let rootError
  engine.project.onDocumentRemove(() => {
    removeEvents += 1
  })
  document.emitter.on('zombie', () => undefined)
  document.emitter.on('removeListener', event => {
    if (event !== 'zombie') return
    try {
      document.remove()
    } catch (error) {
      nestedError = error
    }
    try {
      document.rootNode = oldRoot
    } catch (error) {
      rootError = error
    }
  })

  document.remove()
  document.remove()

  assert.equal(nestedError?.name, 'LifecycleReentrancyError')
  assert.match(rootError?.message || '', /document generation is disposed/)
  assert.equal(removeEvents, 1)
  assert.equal(document.root, null)
  assert.equal(engine.project.getDocument(document.id), undefined)
})

test('failed model cleanup stays privately retryable after public Document identity is cleared', async () => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  await engine.init()
  engine.project.load(projectSchema(), true)
  const document = engine.project.currentDocument
  const root = document.root
  let attempts = 0
  core.registerTestSettingTopEntryDisposer(root.settingEntry, () => {
    attempts += 1
    if (attempts === 1) throw new Error('transient setting cleanup failure')
  })

  await assert.rejects(() => engine.destroy(), /Engine disposal completed with errors/)
  assert.equal(engine.lifecycleState, 'failed')
  assert.equal(attempts, 1)
  assert.equal(engine.project.documents.length, 0)
  assert.equal(document.root, null)

  await engine.destroy()

  assert.equal(engine.lifecycleState, 'disposed')
  assert.equal(attempts, 2)
})
