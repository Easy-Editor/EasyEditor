import assert from 'node:assert/strict'
import test from 'node:test'
import { reaction } from 'mobx'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { assertKernelApi, captureFailure, loadCore } from './helpers/kernel.mjs'

function setupDocument(engine) {
  engine.project.load(createProjectSchema(), true)
  return engine.project.currentDocument
}

test('insertNode and updateProps commit as exactly one undoable history unit', async t => {
  const core = await loadCore()
  assertKernelApi(core)
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const root = document.root
  assert.equal(document.history.isUndoable(), false)

  const result = await engine.transactions.run([
    {
      type: 'insertNode',
      parentId: root.id,
      node: { id: 'child-1', componentName: 'Text', props: { text: 'before' }, children: [] },
    },
    {
      type: 'updateProps',
      nodeId: 'child-1',
      props: { text: 'after', color: 'blue' },
    },
  ])

  assert.equal(result.ok, true)
  assert.equal(result.commandCount, 2)
  assert.equal(document.getNode('child-1').getPropValue('text'), 'after')
  assert.equal(document.history.isUndoable(), true)

  document.history.back()
  assert.equal(document.getNode('child-1'), null)
  assert.equal(document.history.isUndoable(), false, 'one undo must consume the whole transaction')

  document.history.forward()
  assert.equal(document.getNode('child-1').getPropValue('color'), 'blue')
})

test('updateProps accepts props, extras, or both but rejects an empty patch command', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const root = document.root

  engine.commands.execute({
    type: 'updateProps',
    nodeId: root.id,
    extras: { $dashboard: { layout: 'grid' } },
  })
  assert.deepEqual(root.getExtraPropValue('$dashboard'), { layout: 'grid' })

  engine.commands.execute({
    type: 'updateProps',
    nodeId: root.id,
    props: { title: 'with-extra' },
    extras: { title: 'Display title' },
  })
  assert.equal(root.getPropValue('title'), 'with-extra')
  assert.equal(root.getExtraPropValue('title'), 'Display title')

  const before = structuredClone(document.export())
  const error = await captureFailure(() => engine.commands.execute({ type: 'updateProps', nodeId: root.id }))
  assert.equal(error.name, 'CommandValidationError')
  assert.ok(error.issues.some(issue => issue.code === 'updateProps.empty'))
  assert.deepEqual(document.export(), before)
})

test('runOnDocument binds an explicit document and checks its precondition before applying commands', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const current = setupDocument(engine)
  const other = engine.project.createDocument({
    docId: 'page-2',
    id: 'root-2',
    componentName: 'Page',
    props: { title: 'other-before' },
    children: [],
  })
  let checked = 0

  const result = engine.transactions.runOnDocument(
    other,
    [
      {
        type: 'updateProps',
        documentId: other.id,
        nodeId: other.root.id,
        props: { title: 'other-after' },
      },
    ],
    boundDocument => {
      checked += 1
      assert.strictEqual(boundDocument, other)
      assert.equal(boundDocument.root.getPropValue('title'), 'other-before')
    },
  )

  assert.equal(result.ok, true)
  assert.equal(checked, 1)
  assert.strictEqual(engine.project.currentDocument, current)
  assert.equal(current.root.getPropValue('title'), 'before')
  assert.equal(other.root.getPropValue('title'), 'other-after')
  assert.equal(current.history.isUndoable(), false)
  assert.equal(other.history.isUndoable(), true)
  other.history.back()
  assert.equal(other.root.getPropValue('title'), 'other-before', 'one undo must consume the bound transaction')

  engine.transactions.runOnDocument(other.id, [
    { type: 'updateProps', nodeId: other.root.id, props: { title: 'resolved-by-id' } },
  ])
  assert.equal(other.root.getPropValue('title'), 'resolved-by-id')
})

test('runOnDocument rejects stale or foreign bindings without mutation or observer events', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const foreignEngine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => {
    await engine.destroy()
    await foreignEngine.destroy()
  })
  const document = setupDocument(engine)
  const foreignDocument = setupDocument(foreignEngine)
  const before = structuredClone(document.export())
  const beforeRoot = document.root
  const beforeTitleProp = document.root.getProp('title', false)
  const beforePropsItems = document.root.props.items
  const beforeMutationVersion = document.mutationVersion
  let propEvents = 0
  const disposeEvent = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_PROPS_CHANGE, () => {
    propEvents += 1
  })
  t.after(disposeEvent)

  const stale = await captureFailure(() =>
    engine.transactions.runOnDocument(
      document,
      [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'must-not-commit' } }],
      () => {
        throw new Error('stale plan')
      },
    ),
  )
  assert.match(stale.message, /stale plan/)
  assert.deepEqual(document.export(), before)
  assert.strictEqual(document.root, beforeRoot)
  assert.strictEqual(document.root.getProp('title', false), beforeTitleProp)
  assert.strictEqual(document.root.props.items, beforePropsItems)
  assert.equal(document.mutationVersion, beforeMutationVersion)
  assert.equal(document.history.isUndoable(), false)
  assert.equal(propEvents, 0)

  const mutatingPrecondition = await captureFailure(() =>
    engine.transactions.runOnDocument(
      document,
      [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'command-must-not-commit' } }],
      boundDocument => {
        boundDocument.root.setPropValue('title', 'precondition-must-roll-back')
        throw new Error('mutating precondition failed')
      },
    ),
  )
  assert.match(mutatingPrecondition.message, /mutating precondition failed/)
  assert.deepEqual(document.export(), before)
  assert.equal(document.history.isUndoable(), false)

  let asyncPreconditionCalled = false
  const asynchronous = await captureFailure(() =>
    engine.transactions.runOnDocument(
      document.id,
      [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'also-must-not-commit' } }],
      async () => {
        asyncPreconditionCalled = true
      },
    ),
  )
  assert.equal(asynchronous.name, 'AsyncTransactionNotSupportedError')
  assert.equal(asyncPreconditionCalled, false)
  assert.deepEqual(document.export(), before)
  assert.equal(document.history.isUndoable(), false)
  assert.equal(propEvents, 0)

  const foreign = await captureFailure(() =>
    engine.transactions.runOnDocument(foreignDocument, [
      { type: 'updateProps', nodeId: foreignDocument.root.id, props: { title: 'cross-engine' } },
    ]),
  )
  assert.match(foreign.message, /does not belong/i)
  assert.equal(foreignDocument.root.getPropValue('title'), 'before')
})

test('a rejected pure precondition preserves the current history coalescing window', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const root = document.root
  document.history.savePoint()

  root.setPropValue('title', 'coalesced-a')
  const error = await captureFailure(() =>
    engine.transactions.runOnDocument(
      document,
      [{ type: 'updateProps', nodeId: root.id, props: { title: 'must-not-commit' } }],
      () => {
        throw new Error('pure precondition rejected')
      },
    ),
  )
  assert.match(error.message, /pure precondition rejected/)
  root.setPropValue('title', 'coalesced-b')

  assert.equal(root.getPropValue('title'), 'coalesced-b')
  document.history.back()
  assert.equal(
    root.getPropValue('title'),
    'before',
    'direct edits around a rejected pure precondition must remain one undo group',
  )
})

test('removeNode is available through the canonical command API', async t => {
  const core = await loadCore()
  assertKernelApi(core)
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const root = document.root
  await engine.commands.execute({
    type: 'insertNode',
    parentId: root.id,
    node: { id: 'removable', componentName: 'Text', props: {}, children: [] },
  })
  assert.ok(document.getNode('removable'))

  const result = await engine.commands.execute({ type: 'removeNode', nodeId: 'removable' })
  assert.equal(result.ok, true)
  assert.equal(document.getNode('removable'), null)
})

test('a failed transaction rolls back schema, history, identity, and material usage', async t => {
  const core = await loadCore()
  assertKernelApi(core)
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const root = document.root
  const beforeSchema = structuredClone(document.export())
  const beforeHistoryState = document.history.getState()
  const beforeDocument = engine.project.currentDocument
  const beforeMaterialUsage = engine.materials.getUsageCount?.('Text') ?? 0

  const error = await captureFailure(() =>
    engine.transactions.run([
      { type: 'updateProps', nodeId: root.id, props: { title: 'must-roll-back' } },
      {
        type: 'insertNode',
        parentId: root.id,
        node: { id: 'temporary', componentName: 'Text', props: {}, children: [] },
      },
      { type: 'removeNode', nodeId: 'does-not-exist' },
    ]),
  )

  assert.match(error.message, /does-not-exist|target|node/i)
  assert.deepEqual(document.export(), beforeSchema)
  assert.strictEqual(engine.project.currentDocument, beforeDocument)
  assert.equal(document.history.getState(), beforeHistoryState)
  assert.equal(document.getNode('temporary'), null)
  assert.equal(engine.materials.getUsageCount?.('Text') ?? 0, beforeMaterialUsage)
})

test('a failed transaction leaks neither domain events nor intermediate MobX state', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const root = document.root
  const originalTitle = root.getPropValue('title')
  let propEvents = 0
  let selectionEvents = 0
  const observedTitles = []
  const disposeProp = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_PROPS_CHANGE, () => {
    propEvents += 1
  })
  const disposeSelection = engine.designer.onEvent(core.DESIGNER_EVENT.SELECTION_CHANGE, () => {
    selectionEvents += 1
  })
  const disposeReaction = reaction(
    () => root.getPropValue('title'),
    value => observedTitles.push(value),
  )
  t.after(() => {
    disposeProp()
    disposeSelection()
    disposeReaction()
  })

  await captureFailure(() =>
    engine.transactions.run([
      { type: 'updateProps', nodeId: root.id, props: { title: 'intermediate' } },
      { type: 'removeNode', nodeId: 'missing-node' },
    ]),
  )

  assert.equal(root.getPropValue('title'), originalTitle)
  assert.equal(propEvents, 0)
  assert.equal(selectionEvents, 0)
  assert.deepEqual(observedTitles, [])

  engine.commands.execute({ type: 'updateProps', nodeId: root.id, props: { title: 'committed' } })
  assert.equal(root.getPropValue('title'), 'committed')
  assert.ok(propEvents > 0, 'committed events must be delivered after the transaction closes')
  assert.deepEqual(observedTitles, ['committed'])
})

test('post-commit listener failures do not roll committed model state back', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const root = document.root
  const originalTitle = root.getPropValue('title')
  let laterListenerCalls = 0
  const disposeThrowingListener = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_PROPS_CHANGE, () => {
    throw new Error('listener failed')
  })
  const disposeLaterListener = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_PROPS_CHANGE, () => {
    laterListenerCalls += 1
  })
  t.after(disposeThrowingListener)
  t.after(disposeLaterListener)

  const error = await captureFailure(() =>
    engine.commands.execute({ type: 'updateProps', nodeId: root.id, props: { title: 'committed' } }),
  )

  assert.equal(error.name, 'TransactionCommittedError')
  assert.equal(error.committed, true)
  assert.deepEqual(error.result, {
    affectedNodeIds: [root.id],
    commandCount: 1,
    ok: true,
  })
  assert.ok(error.errors.some(cause => /listener failed/.test(cause?.message)))
  assert.equal(root.getPropValue('title'), 'committed')
  assert.equal(document.history.isUndoable(), true)
  assert.ok(laterListenerCalls > 0, 'one listener failure must not starve later listeners for the same event')

  disposeThrowingListener()
  disposeLaterListener()
  document.history.back()
  assert.equal(root.getPropValue('title'), originalTitle)
})

test('moveNode is atomic and undo restores the original parent', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const root = document.root
  engine.transactions.run([
    { type: 'insertNode', parentId: root.id, node: { id: 'left', componentName: 'Box', children: [] } },
    { type: 'insertNode', parentId: root.id, node: { id: 'right', componentName: 'Box', children: [] } },
    { type: 'insertNode', parentId: 'left', node: { id: 'moving', componentName: 'Text', children: [] } },
  ])

  engine.commands.execute({ type: 'moveNode', nodeId: 'moving', parentId: 'right', at: 0 })
  assert.equal(document.getNode('moving').parent.id, 'right')

  document.history.back()
  assert.equal(document.getNode('moving').parent.id, 'left')
})

test('nested typed commands join one synchronous transaction boundary', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const root = document.root

  engine.transactions.runSync(() => {
    engine.commands.execute({
      type: 'insertNode',
      parentId: root.id,
      node: { id: 'nested', componentName: 'Text', props: {}, children: [] },
    })
    engine.commands.execute({ type: 'updateProps', nodeId: 'nested', props: { value: 'committed' } })
  })

  assert.equal(document.getNode('nested').getPropValue('value'), 'committed')
  document.history.back()
  assert.equal(document.getNode('nested'), null, 'one undo must consume the outer and nested commands')
})

test('a caught nested falsy failure still poisons and rolls back the outer transaction', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const root = document.root
  const originalTitle = root.getPropValue('title')

  const failure = await captureFailure(() =>
    engine.transactions.runSync(() => {
      try {
        engine.transactions.runSync(() => {
          engine.commands.execute({ type: 'updateProps', nodeId: root.id, props: { title: 'leaked' } })
          throw 0
        })
      } catch {}
    }),
  )

  assert.equal(failure, 0)
  assert.equal(root.getPropValue('title'), originalTitle)
  assert.equal(document.history.isUndoable(), false)
})

test('cross-document commands are rejected before earlier commands can mutate', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const other = engine.project.createDocument({
    docId: 'page-2',
    id: 'root-2',
    componentName: 'Page',
    props: {},
    children: [],
  })
  const before = structuredClone(document.export())

  const error = await captureFailure(() =>
    engine.transactions.run([
      { type: 'updateProps', nodeId: document.root.id, props: { leaked: true } },
      { type: 'removeNode', documentId: other.id, nodeId: 'missing' },
    ]),
  )

  assert.match(error.message, /cross-document/i)
  assert.deepEqual(document.export(), before)
})

test('promise-returning callback transactions roll synchronous changes back', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const before = structuredClone(document.export())

  const error = await captureFailure(() =>
    engine.transactions.runSync(() => {
      engine.commands.execute({ type: 'updateProps', nodeId: document.root.id, props: { leaked: true } })
      return Promise.resolve()
    }),
  )

  assert.equal(error.name, 'AsyncTransactionNotSupportedError')
  assert.deepEqual(document.export(), before)
})

test('a failed transaction in engine A does not discard committed engine B events', async t => {
  const core = await loadCore()
  const engineA = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  const engineB = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(async () => {
    await engineA.destroy()
    await engineB.destroy()
  })

  const documentA = setupDocument(engineA)
  const documentB = setupDocument(engineB)
  const titleBefore = documentA.root.getPropValue('title')
  let engineBEvents = 0
  const disposeEvent = engineB.designer.onEvent(core.DESIGNER_EVENT.NODE_CHILDREN_CHANGE, ({ node }) => {
    if (node.id === documentB.root.id) engineBEvents += 1
  })
  t.after(disposeEvent)

  const failure = await captureFailure(() =>
    engineA.transactions.runSync(() => {
      engineA.commands.execute({
        type: 'updateProps',
        nodeId: documentA.root.id,
        props: { title: 'rolled-back-in-a' },
      })
      engineB.commands.execute({
        type: 'insertNode',
        parentId: documentB.root.id,
        node: { id: 'committed-in-b', componentName: 'Text', props: {}, children: [] },
      })
      throw new Error('engine A failed')
    }),
  )

  assert.match(failure.message, /engine A failed/)
  assert.equal(documentA.root.getPropValue('title'), titleBefore)
  assert.equal(documentA.history.isUndoable(), false)
  assert.ok(documentB.getNode('committed-in-b'), 'engine B model must remain committed')
  assert.equal(documentB.history.isUndoable(), true, 'engine B history must match its committed model')
  assert.ok(engineBEvents > 0, 'engine B EventBus notifications must not be owned or discarded by engine A')
})

test('a failed insertNode transaction does not leak usage_changed events', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  engine.materials.createComponentMeta({ componentName: 'Text' })
  const usageEvents = []
  const disposeRegistry = engine.materials.registry.subscribe(event => {
    if (event.type === core.RegistryEventType.USAGE_CHANGED) {
      usageEvents.push({
        componentName: event.componentName,
        usageCount: event.entry?.usageCount,
      })
    }
  })
  t.after(disposeRegistry)

  await captureFailure(() =>
    engine.transactions.run([
      {
        type: 'insertNode',
        parentId: document.root.id,
        node: { id: 'rolled-back-text', componentName: 'Text', props: {}, children: [] },
      },
      { type: 'removeNode', nodeId: 'missing-after-insert' },
    ]),
  )

  assert.equal(document.getNode('rolled-back-text'), null)
  assert.equal(engine.materials.getUsageCount('Text'), 0)
  disposeRegistry()
  assert.deepEqual([...usageEvents], [], 'registry observers must see no intermediate usage state from rollback')
})

test('a MobX endBatch reaction error closes the event transaction before the next command', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ trustPolicy: 'legacyTrusted', hostWindow: null })
  t.after(() => engine.destroy())
  const document = setupDocument(engine)
  const root = document.root
  let propEvents = 0
  let reactionErrors = 0
  const disposeEvent = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_PROPS_CHANGE, () => {
    propEvents += 1
  })
  const disposeReaction = reaction(
    () => root.getPropValue('title'),
    () => {
      throw new Error('reaction effect failed')
    },
    {
      onError() {
        reactionErrors += 1
        throw new Error('reaction onError failed during endBatch')
      },
    },
  )
  t.after(() => {
    disposeEvent()
    disposeReaction()
  })

  const failure = await captureFailure(() =>
    engine.commands.execute({ type: 'updateProps', nodeId: root.id, props: { title: 'first-commit' } }),
  )

  assert.equal(failure.name, 'TransactionCommittedError')
  assert.equal(failure.committed, true)
  assert.ok(failure.errors.some(cause => /reaction onError failed during endBatch/.test(cause?.message)))
  assert.ok(reactionErrors > 0)
  disposeReaction()
  const eventsBeforeNextCommand = propEvents

  engine.commands.execute({ type: 'updateProps', nodeId: root.id, props: { title: 'second-commit' } })

  assert.equal(root.getPropValue('title'), 'second-commit')
  assert.ok(propEvents > eventsBeforeNextCommand, 'the next command event must not remain trapped in a leaked scope')
})
