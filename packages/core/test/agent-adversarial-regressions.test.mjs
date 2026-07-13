import assert from 'node:assert/strict'
import test from 'node:test'
import { reaction, runInAction } from 'mobx'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

async function createReadyEngine(t, schema = createProjectSchema()) {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.project.load(schema, true)
  return { core, document: engine.project.currentDocument, engine }
}

function issueCapability(engine, document, options = {}) {
  return engine.agentCapabilities.issue({
    subjectId: options.subjectId ?? 'agent:adversarial-regression',
    documentIds: [document.id],
    commandTypes: options.commandTypes ?? ['updateProps'],
    componentNames: options.componentNames ?? [],
    componentProps: options.componentProps ?? {
      Page: { title: { type: 'string', maxBytes: 16 * 1024 } },
    },
    extraKeys: options.extraKeys ?? [],
    ...(options.limits ? { limits: options.limits } : {}),
  })
}

function prepareRootUpdate(capability, document, title) {
  const snapshot = capability.snapshot(document.id)
  return capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title } }],
  })
}

function assertCapabilityError(error, codePattern) {
  assert.equal(error.name, 'AgentCapabilityError')
  assert.equal(typeof error.code, 'string')
  assert.match(error.code, codePattern)
  assert.equal(error.committed, false)
}

function latestAudit(engine, predicate) {
  return [...engine.agentCapabilities.getAuditRecords()].reverse().find(predicate)
}

function createInstrumentedExponentialDag(depth, traversalBudget) {
  let ownKeyReads = 0
  let value = { leaf: true }
  for (let level = 0; level < depth; level += 1) {
    const target = { left: value, right: value }
    value = new Proxy(target, {
      ownKeys(current) {
        ownKeyReads += 1
        if (ownKeyReads > traversalBudget) {
          throw new Error('test traversal sentinel: shared DAG expanded past its budget')
        }
        return Reflect.ownKeys(current)
      },
    })
  }
  return { getOwnKeyReads: () => ownKeyReads, value }
}

test('a shared-reference DAG cannot force exponential expansion before Agent input limits fail safely', async t => {
  const { document, engine } = await createReadyEngine(t)
  const capability = issueCapability(engine, document, { limits: { maxPayloadBytes: 1024 } })
  const snapshot = capability.snapshot(document.id)
  const traversalBudget = 256
  const dag = createInstrumentedExponentialDag(40, traversalBudget)
  const before = structuredClone(document.export())

  const error = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: snapshot.revision,
      commands: [{ type: 'updateProps', nodeId: document.root.id, props: { dag: dag.value } }],
    }),
  )

  assertCapabilityError(error, /^agent\.(?:data\.invalid|limit\.)/)
  assert.ok(
    dag.getOwnKeyReads() <= traversalBudget,
    'validation must reject shared references or exhaust an internal budget before exponential expansion',
  )
  assert.deepEqual(document.export(), before)
})

test('non-index array properties are rejected without invoking hidden accessors', async t => {
  const { document, engine } = await createReadyEngine(t)
  const documentIds = [document.id]
  let accessorCalls = 0
  Object.defineProperty(documentIds, '4294967295', {
    configurable: true,
    get() {
      accessorCalls += 1
      return 'hidden'
    },
  })

  const error = await captureFailure(() =>
    engine.agentCapabilities.issue({
      subjectId: 'agent:hidden-array-key',
      documentIds,
      commandTypes: [],
    }),
  )

  assertCapabilityError(error, /^agent\.data\.invalid$/)
  assert.equal(accessorCalls, 0)
})

test('inserted node IDs must be bounded strings throughout the complete subtree', async t => {
  const { document, engine } = await createReadyEngine(t)
  const capability = issueCapability(engine, document, {
    commandTypes: ['insertNode'],
    componentNames: ['Group', 'Text'],
  })
  const snapshot = capability.snapshot(document.id)
  const before = structuredClone(document.exportRaw())

  const error = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: snapshot.revision,
      commands: [
        {
          type: 'insertNode',
          parentId: document.root.id,
          node: {
            id: 'valid-parent',
            componentName: 'Group',
            props: {},
            children: [{ id: 42, componentName: 'Text', props: {}, children: [] }],
          },
        },
      ],
    }),
  )

  assertCapabilityError(error, /^agent\.command\.invalid$/)
  assert.deepEqual(document.exportRaw(), before)
})

test('Agent execution uses an unforgeable transaction seam instead of the mutable public method', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  let callbackCalls = 0
  engine.materials.createComponentMeta({
    componentName: 'Page',
    configure: {
      advanced: {
        callbacks: {
          onNodeAdd(addedNode, currentNode) {
            callbackCalls += 1
            if (addedNode?.id !== 'agent-authorized-node' || !currentNode) return
            currentNode.document.insertNode(currentNode, {
              id: 'ambient-unauthorized-node',
              componentName: 'ForbiddenAmbientComponent',
              props: {},
              children: [],
            })
          },
        },
      },
    },
  })
  engine.materials.createComponentMeta({ componentName: 'Text' })
  engine.project.load(createProjectSchema(), true)
  const document = engine.project.currentDocument
  const capability = issueCapability(engine, document, {
    commandTypes: ['insertNode'],
    componentNames: ['Text'],
  })
  const snapshot = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [
      {
        type: 'insertNode',
        parentId: document.root.id,
        node: { id: 'agent-authorized-node', componentName: 'Text', props: {}, children: [] },
      },
    ],
  })
  let nodeAddEvents = 0
  const disposeNodeAdd = document.onNodeAdd(() => {
    nodeAddEvents += 1
  })
  t.after(disposeNodeAdd)

  const originalRunOnDocument = engine.transactions.runOnDocument
  let publicMethodCalls = 0
  engine.transactions.runOnDocument = function runWithAmbientCallbacks(boundDocument, commands, options) {
    publicMethodCalls += 1
    return originalRunOnDocument.call(this, boundDocument, commands, {
      ...options,
      invokeNodeCallbacks: true,
    })
  }

  try {
    const receipt = capability.execute(plan.planId)
    assert.equal(receipt.status, 'committed')
    assert.equal(publicMethodCalls, 0)
    assert.equal(callbackCalls, 0)
    assert.ok(document.getNode('agent-authorized-node'))
    assert.equal(document.getNode('ambient-unauthorized-node'), null)
    assert.equal(document.history.isUndoable(), true)
    assert.equal(engine.materials.getUsageCount('Text'), 1)
    assert.equal(engine.materials.getUsageCount('ForbiddenAmbientComponent'), 0)
    assert.equal(nodeAddEvents, 0, 'Agent domain writes must not publish executable model callbacks')

    const audit = latestAudit(engine, record => record.action === 'execute' && record.planId === plan.planId)
    assert.equal(audit.decision, 'allowed')
    assert.equal(audit.outcome, 'committed')

    const replayError = await captureFailure(() => capability.execute(plan.planId))
    assertCapabilityError(replayError, /^agent\.plan\.terminal$/)
  } finally {
    engine.transactions.runOnDocument = originalRunOnDocument
  }
})

test('reserved structural, path-like, and private extra keys cannot be granted or written', async t => {
  const { document, engine } = await createReadyEngine(t)
  const deniedKeys = ['id', 'componentName', 'props', 'children', 'docId', 'layout.x', 'items[0]', 'safe___private']

  for (const key of deniedKeys) {
    const grantError = await captureFailure(() =>
      issueCapability(engine, document, {
        subjectId: `agent:invalid-extra:${key}`,
        commandTypes: ['updateProps'],
        extraKeys: [key],
      }),
    )
    assertCapabilityError(grantError, /^agent\.grant\.invalid$/)
  }

  const capability = issueCapability(engine, document)
  const snapshot = capability.snapshot(document.id)
  const beforeSchema = structuredClone(document.export())
  const beforeHistoryState = document.history.getState()
  for (const key of deniedKeys) {
    const error = await captureFailure(() =>
      capability.preview({
        documentId: document.id,
        baseRevision: snapshot.revision,
        commands: [{ type: 'updateProps', nodeId: document.root.id, extras: { [key]: 'hijack' } }],
      }),
    )
    assertCapabilityError(error, /^agent\.command\.reservedExtra$/)
    assert.deepEqual(document.export(), beforeSchema)
    assert.equal(document.history.getState(), beforeHistoryState)
  }
})

test('legacy executable descriptors remain inert readable snapshot data but are rejected from inbound commands', async t => {
  const schema = createProjectSchema()
  const legacyExpression = { type: 'JSExpression', value: 'state.user.name' }
  const legacyFunction = { type: 'JSFunction', value: 'function legacyHandler() { return 1 }' }
  schema.componentsTree[0].props = {
    title: 'before',
    legacyExpression,
    legacyFunction,
  }
  const { document, engine } = await createReadyEngine(t, schema)
  const capability = issueCapability(engine, document)

  const snapshot = capability.snapshot(document.id)
  assert.deepEqual(snapshot.schema.props.legacyExpression, legacyExpression)
  assert.deepEqual(snapshot.schema.props.legacyFunction, legacyFunction)
  assert.equal(Object.isFrozen(snapshot.schema.props.legacyExpression), true)
  assert.equal(Object.isFrozen(snapshot.schema.props.legacyFunction), true)

  const beforeSchema = structuredClone(document.export())
  for (const descriptor of [legacyExpression, legacyFunction]) {
    const error = await captureFailure(() =>
      capability.preview({
        documentId: document.id,
        baseRevision: snapshot.revision,
        commands: [
          {
            type: 'updateProps',
            nodeId: document.root.id,
            props: { inboundExecutable: descriptor },
          },
        ],
      }),
    )
    assertCapabilityError(error, /^agent\.data\.invalid$/)
    assert.deepEqual(document.export(), beforeSchema)
  }
})

test('direct observable children and props-item A-to-B-to-A mutations make older plans stale', async t => {
  const schema = createProjectSchema()
  schema.componentsTree[0].props = { title: 'before', subtitle: 'stable' }
  schema.componentsTree[0].children.push(
    { id: 'child-a', componentName: 'Text', props: { text: 'a' }, children: [] },
    { id: 'child-b', componentName: 'Text', props: { text: 'b' }, children: [] },
  )
  const { document, engine } = await createReadyEngine(t, schema)
  const capability = issueCapability(engine, document)
  const originalSchema = structuredClone(document.export())

  const childrenPlan = prepareRootUpdate(capability, document, 'must-not-commit-after-children-aba')
  engine.transactions.runSync(() => {
    runInAction(() => {
      document.root.children.children.reverse()
      document.root.children.children.reverse()
    })
  })
  assert.deepEqual(document.export(), originalSchema)
  const childrenError = await captureFailure(() => capability.execute(childrenPlan.planId))
  assert.equal(childrenError.name, 'AgentPlanStaleError')
  assert.equal(childrenError.code, 'agent.plan.stale')
  assert.deepEqual(document.export(), originalSchema)

  const propsItemsPlan = prepareRootUpdate(capability, document, 'must-not-commit-after-props-items-aba')
  engine.transactions.runSync(() => {
    runInAction(() => {
      document.root.props.items.reverse()
      document.root.props.items.reverse()
    })
  })
  assert.deepEqual(document.export(), originalSchema)
  const propsItemsError = await captureFailure(() => capability.execute(propsItemsPlan.planId))
  assert.equal(propsItemsError.name, 'AgentPlanStaleError')
  assert.equal(propsItemsError.code, 'agent.plan.stale')
  assert.deepEqual(document.export(), originalSchema)
  assert.equal(
    document.history.isUndoable(),
    false,
    'net-zero direct observable writes must not create history entries',
  )
})

test('insertNode with an explicit empty props object satisfies the Agent postcondition', async t => {
  const { document, engine } = await createReadyEngine(t)
  const capability = issueCapability(engine, document, {
    commandTypes: ['insertNode'],
    componentNames: ['Text'],
  })
  const snapshot = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [
      {
        type: 'insertNode',
        parentId: document.root.id,
        node: { id: 'empty-props-node', componentName: 'Text', props: {}, children: [] },
      },
    ],
  })

  const receipt = capability.execute(plan.planId)
  assert.equal(receipt.status, 'committed')
  assert.equal(receipt.committed, true)
  assert.equal(receipt.commandCount, 1)
  assert.deepEqual(receipt.affectedNodeIds, ['empty-props-node'])
  assert.deepEqual(document.getNode('empty-props-node').export().props, {})
  assert.equal(document.history.isUndoable(), true)
})

test('snapshot is observational when a SERIALIZE props reducer attempts a cross-document write', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.project.load(createProjectSchema(), true)
  const grantedDocument = engine.project.currentDocument
  const ungrantedDocument = engine.project.createDocument({
    docId: 'page-2',
    id: 'root-2',
    componentName: 'Page',
    props: { secret: 'safe' },
    children: [],
  })
  const beforeSchema = structuredClone(ungrantedDocument.export())
  const beforeHistoryData = ungrantedDocument.history.hotData
  const beforeHistoryState = ungrantedDocument.history.getState()
  const beforeMutationVersion = ungrantedDocument.mutationVersion
  let leakedPropEvents = 0
  const disposePropEvents = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_PROPS_CHANGE, ({ prop }) => {
    if (prop?.owner?.document === ungrantedDocument) leakedPropEvents += 1
  })
  t.after(disposePropEvents)

  let reducerCalls = 0
  engine.designer.addPropsReducer((props, node) => {
    if (node.document === grantedDocument) {
      reducerCalls += 1
      ungrantedDocument.root.setPropValue('secret', `snapshot-side-effect-${reducerCalls}`)
    }
    return props
  }, core.TRANSFORM_STAGE.SERIALIZE)
  const capability = issueCapability(engine, grantedDocument, { commandTypes: [] })

  let snapshot
  let snapshotError
  try {
    snapshot = capability.snapshot(grantedDocument.id)
  } catch (error) {
    snapshotError = error
  }

  assert.deepEqual(ungrantedDocument.export(), beforeSchema, 'snapshot must not modify an ungranted document')
  assert.equal(ungrantedDocument.history.hotData, beforeHistoryData)
  assert.equal(ungrantedDocument.history.getState(), beforeHistoryState)
  assert.equal(ungrantedDocument.mutationVersion, beforeMutationVersion)
  assert.equal(leakedPropEvents, 0, 'snapshot must not emit mutation events from an ambient reducer')
  if (snapshotError) {
    assertCapabilityError(snapshotError, /^agent\./)
  } else {
    assert.equal(snapshot.documentId, grantedDocument.id)
    assert.equal(typeof snapshot.revision, 'string')
  }
})

test('post-commit observers cannot expand Agent effects beyond the preview and receipt', async t => {
  const { core, document, engine } = await createReadyEngine(t)
  const capability = issueCapability(engine, document, {
    commandTypes: ['insertNode'],
    componentNames: ['Text'],
  })
  const snapshot = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [
      {
        type: 'insertNode',
        parentId: document.root.id,
        node: { id: 'observer-allowed-text', componentName: 'Text', props: {}, children: [] },
      },
    ],
  })
  const beforeSchema = structuredClone(document.export())
  const beforeHistoryData = document.history.hotData
  const beforeHistoryState = document.history.getState()
  let observerCalls = 0
  const disposeObserver = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_CHILDREN_CHANGE, () => {
    observerCalls += 1
    if (observerCalls > 1) return
    document.insertNode(document.root, { id: 'observer-danger', componentName: 'Danger', props: {}, children: [] }, -1)
  })
  t.after(disposeObserver)

  let receipt
  let executeError
  try {
    receipt = capability.execute(plan.planId)
  } catch (error) {
    executeError = error
  }

  assert.equal(document.getNode('observer-danger'), null, 'an observer may not smuggle an ungranted component')
  if (executeError) {
    assertCapabilityError(executeError, /^agent\./)
    assert.equal(document.getNode('observer-allowed-text'), null)
    assert.deepEqual(document.export(), beforeSchema)
    assert.equal(document.history.hotData, beforeHistoryData)
    assert.equal(document.history.getState(), beforeHistoryState)
    const audit = latestAudit(engine, record => record.action === 'execute' && record.planId === plan.planId)
    assert.equal(audit.decision, 'denied')
  } else {
    assert.equal(receipt.committed, true)
    assert.deepEqual(receipt.affectedNodeIds, ['observer-allowed-text'])
    assert.deepEqual(
      document.root.children.children.map(node => ({ componentName: node.componentName, id: node.id })),
      [{ componentName: 'Text', id: 'observer-allowed-text' }],
    )
    const audit = latestAudit(engine, record => record.action === 'execute' && record.planId === plan.planId)
    assert.equal(audit.decision, 'allowed')
    assert.deepEqual(audit.commands.componentNames, ['Text'])
    assert.deepEqual(audit.commands.nodeIds, ['observer-allowed-text', document.root.id].sort())
  }
})

test('settling Agent transactions block detached nodes and project/document lifecycle mutations', async t => {
  const { document, engine } = await createReadyEngine(t)
  const otherDocument = engine.project.createDocument({
    docId: 'page-2',
    id: 'root-2',
    componentName: 'Page',
    props: { title: 'other-before' },
    children: [],
  })
  const capability = issueCapability(engine, document, {
    commandTypes: ['insertNode'],
    componentNames: ['Text'],
  })
  const snapshot = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [
      {
        type: 'insertNode',
        parentId: document.root.id,
        node: { id: 'allowed-text', componentName: 'Text', props: {}, children: [] },
      },
    ],
  })
  const blocked = []
  const attempts = [
    () => document.createNode({ id: 'detached-danger', componentName: 'Danger', props: {}, children: [] }),
    () => engine.project.createDocument(),
    () => engine.project.removeDocument(document),
    () => otherDocument.remove(),
  ]
  const disposers = attempts.map(attempt =>
    reaction(
      () => document.root.children.size,
      () => {
        try {
          attempt()
        } catch (error) {
          blocked.push(error)
        }
      },
    ),
  )
  disposers.forEach(dispose => t.after(dispose))

  const receipt = capability.execute(plan.planId)

  assert.equal(receipt.status, 'committed')
  assert.equal(blocked.length, attempts.length)
  assert.equal(document.getNode('detached-danger'), null)
  assert.equal(engine.materials.getUsageCount?.('Danger') ?? 0, 0)
  assert.strictEqual(engine.project.getDocument(document.id), document)
  assert.strictEqual(engine.project.getDocument(otherDocument.id), otherDocument)
  assert.deepEqual(
    engine.project.documents.map(item => item.id),
    [document.id, otherDocument.id],
  )

  engine.transactions.runOnDocument(otherDocument, [
    { type: 'updateProps', nodeId: otherDocument.root.id, props: { title: 'other-after' } },
  ])
  assert.equal(otherDocument.root.getPropValue('title'), 'other-after')
  otherDocument.history.back()
  assert.equal(
    otherDocument.root.getPropValue('title'),
    'other-before',
    'blocked remove must not destroy other history',
  )
})
