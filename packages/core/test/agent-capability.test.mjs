import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

function createSchemaWithChild() {
  const schema = createProjectSchema()
  schema.componentsTree[0].children.push({
    id: 'child-1',
    componentName: 'Text',
    props: { text: 'before' },
    children: [],
  })
  return schema
}

async function createHarness(t, options = {}) {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: options.trustPolicy ?? 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.project.load(options.schema ?? createProjectSchema(), true)
  const document = engine.project.currentDocument
  const capability = engine.agentCapabilities.issue({
    subjectId: options.subjectId ?? 'agent:test',
    documentIds: options.documentIds ?? [document.id],
    commandTypes: options.commandTypes ?? [],
    componentNames: options.componentNames ?? [],
    componentProps: options.componentProps ?? {
      Page: { title: { type: 'string', maxBytes: 16 * 1024 } },
      Text: {
        color: { type: 'string', maxBytes: 256 },
        text: { type: 'string', maxBytes: 4096 },
      },
    },
    extraKeys: options.extraKeys ?? [],
    ...(options.extraValues ? { extraValues: options.extraValues } : {}),
  })
  return { capability, core, document, engine }
}

function captureKernelState(engine) {
  const document = engine.project.currentDocument
  const materials = engine.materials.registry.getSnapshot()
  return {
    document,
    historyData: document.history.hotData,
    historyState: document.history.getState(),
    materialEntries: materials.entries,
    materialPendingEntries: materials.pendingEntries,
    schema: structuredClone(document.export()),
    selection: [...engine.designer.selection.selected],
  }
}

function assertKernelState(engine, before, message = 'operation must not mutate kernel state') {
  const after = captureKernelState(engine)
  assert.strictEqual(after.document, before.document, `${message}: document identity changed`)
  assert.deepEqual(after.schema, before.schema, `${message}: schema changed`)
  assert.equal(after.historyData, before.historyData, `${message}: history data changed`)
  assert.equal(after.historyState, before.historyState, `${message}: history state changed`)
  assert.deepEqual(after.materialEntries, before.materialEntries, `${message}: material entries changed`)
  assert.deepEqual(after.materialPendingEntries, before.materialPendingEntries, `${message}: pending materials changed`)
  assert.deepEqual(after.selection, before.selection, `${message}: selection changed`)
}

function observeDomainMutations(core, engine) {
  const counts = { children: 0, materials: 0, props: 0, selection: 0 }
  const disposers = [
    engine.designer.onEvent(core.DESIGNER_EVENT.NODE_CHILDREN_CHANGE, () => (counts.children += 1)),
    engine.designer.onEvent(core.DESIGNER_EVENT.NODE_PROPS_CHANGE, () => (counts.props += 1)),
    engine.designer.onEvent(core.DESIGNER_EVENT.SELECTION_CHANGE, () => (counts.selection += 1)),
    engine.materials.registry.subscribe(() => (counts.materials += 1)),
  ]
  return {
    dispose: () => disposers.splice(0).forEach(dispose => dispose()),
    read: () => ({ ...counts }),
  }
}

function expectCapabilityError(error, codePattern) {
  assert.equal(error.name, 'AgentCapabilityError')
  assert.equal(typeof error.code, 'string')
  assert.match(error.code, codePattern)
  assert.equal(error.committed, false)
}

function latestAudit(engine, predicate) {
  return [...engine.agentCapabilities.getAuditRecords()].reverse().find(predicate)
}

function assertNoRawKernelReferences(value, forbidden, path = '$', visited = new Set()) {
  for (const [label, reference] of forbidden) {
    assert.notStrictEqual(value, reference, `${path} exposes raw ${label}`)
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return
  visited.add(value)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || descriptor.get || descriptor.set) continue
    assertNoRawKernelReferences(descriptor.value, forbidden, `${path}.${String(key)}`, visited)
  }
}

test('issued grants are copied/frozen, deny by default, and preflight every command before mutation', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.project.load(createProjectSchema(), true)
  const document = engine.project.currentDocument
  const documentIds = [document.id]
  const commandTypes = ['updateProps']
  const capability = engine.agentCapabilities.issue({
    subjectId: 'agent:copied-grant',
    documentIds,
    commandTypes,
    componentProps: { Page: { title: { type: 'string', maxBytes: 16 * 1024 } } },
  })

  documentIds.push('other-document')
  commandTypes.push('removeNode')
  assert.deepEqual(capability.descriptor.grant.documentIds, [document.id])
  assert.deepEqual(capability.descriptor.grant.commandTypes, ['updateProps'])
  assert.equal(Object.isFrozen(capability.descriptor), true)
  assert.equal(Object.isFrozen(capability.descriptor.grant), true)
  assert.equal(Object.isFrozen(capability.descriptor.grant.documentIds), true)
  assert.equal(Object.isFrozen(capability.descriptor.grant.commandTypes), true)
  assert.equal(Object.isFrozen(capability.descriptor.grant.componentProps), true)
  assert.equal(Object.isFrozen(capability.descriptor.grant.componentProps.Page), true)
  assert.equal(Object.isFrozen(capability.descriptor.grant.componentProps.Page.title), true)

  const base = capability.snapshot(document.id)
  const before = captureKernelState(engine)
  const error = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: base.revision,
      commands: [
        { type: 'updateProps', nodeId: document.root.id, props: { title: 'must-not-leak' } },
        { type: 'removeNode', nodeId: document.root.id },
      ],
    }),
  )
  expectCapabilityError(error, /^agent\.grant\.commandDenied$/)
  assertKernelState(engine, before, 'a later disallowed command must reject before the first command')
  const rejected = latestAudit(engine, record => record.action === 'preview' && record.decision === 'denied')
  assert.equal(rejected.outcome, 'rejected')
  assert.equal(rejected.documentId, document.id)
  assert.equal(rejected.error.code, error.code)

  const denyAll = engine.agentCapabilities.issue({
    subjectId: 'agent:deny-all',
    documentIds: [document.id],
    commandTypes: [],
  })
  const denyBase = denyAll.snapshot(document.id)
  const denyBefore = captureKernelState(engine)
  const denyError = await captureFailure(() =>
    denyAll.preview({
      documentId: document.id,
      baseRevision: denyBase.revision,
      commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'denied' } }],
    }),
  )
  expectCapabilityError(denyError, /^agent\.grant\.commandDenied$/)
  assertKernelState(engine, denyBefore)
})

test('granted extraKeys export node extras while ungranted extras reject before mutation', async t => {
  const { capability, document, engine } = await createHarness(t, {
    commandTypes: ['updateProps'],
    extraKeys: ['$dashboard'],
    extraValues: {
      $dashboard: {
        requiredOnInsert: false,
        policy: {
          type: 'object',
          properties: { layout: { type: 'string', maxBytes: 64 } },
          required: ['layout'],
          additionalProperties: false,
        },
      },
    },
  })
  const base = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: base.revision,
    commands: [
      {
        type: 'updateProps',
        nodeId: document.root.id,
        props: { title: 'agent-updated' },
        extras: { $dashboard: { layout: 'grid' } },
      },
    ],
  })
  const receipt = capability.execute(plan.planId)
  assert.equal(receipt.status, 'committed')
  assert.equal(receipt.committed, true)
  assert.deepEqual(document.export().$dashboard, { layout: 'grid' })

  const deniedBase = capability.snapshot(document.id)
  const before = captureKernelState(engine)
  const error = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: deniedBase.revision,
      commands: [
        {
          type: 'updateProps',
          nodeId: document.root.id,
          props: { title: 'must-not-leak' },
          extras: { $private: { secret: true } },
        },
      ],
    }),
  )
  expectCapabilityError(error, /^agent\.grant\.extraDenied$/)
  assertKernelState(engine, before)
})

test('snapshot and preview are non-mutating and expose no Engine/Project/Document/Node objects', async t => {
  const { capability, core, document, engine } = await createHarness(t, {
    commandTypes: ['insertNode', 'updateProps'],
    componentNames: ['Text'],
  })
  const forbidden = [
    ['EngineInstance', engine],
    ['Project', engine.project],
    ['Document', document],
    ['Node', document.root],
  ]
  const probe = observeDomainMutations(core, engine)
  t.after(() => probe.dispose())
  const before = captureKernelState(engine)

  const snapshot = capability.snapshot(document.id)
  assert.equal(snapshot.documentId, document.id)
  assert.deepEqual(snapshot.schema, document.export())
  assertNoRawKernelReferences(capability, forbidden, '$capability')
  assertNoRawKernelReferences(snapshot, forbidden, '$snapshot')
  assertKernelState(engine, before, 'snapshot must be observational')

  const plan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [
      {
        type: 'insertNode',
        parentId: document.root.id,
        node: { id: 'preview-child', componentName: 'Text', props: { text: 'before' }, children: [] },
      },
      { type: 'updateProps', nodeId: 'preview-child', props: { text: 'after' } },
    ],
  })
  assert.equal(plan.state, 'prepared')
  assert.equal(plan.documentId, document.id)
  assert.equal(plan.commandCount, 2)
  assertNoRawKernelReferences(plan, forbidden, '$plan')
  assertKernelState(engine, before, 'preview must not mutate before execute')
  assert.deepEqual(probe.read(), { children: 0, materials: 0, props: 0, selection: 0 })
})

test('strict Agent data validation rejects executable/accessor/non-plain/circular values on legacyTrusted hosts', async t => {
  const { capability, document, engine } = await createHarness(t, {
    commandTypes: ['insertNode', 'updateProps'],
    componentNames: ['Text'],
  })
  const secret = 'agent-secret-must-never-enter-audit'
  let getterCalls = 0
  const accessorProps = {}
  Object.defineProperty(accessorProps, 'danger', {
    enumerable: true,
    get() {
      getterCalls += 1
      return secret
    },
  })
  const circular = { label: 'cycle' }
  circular.self = circular
  const cases = [
    { type: 'updateProps', nodeId: document.root.id, props: { handler: { type: 'JSExpression', value: secret } } },
    { type: 'updateProps', nodeId: document.root.id, props: { handler() {} } },
    { type: 'updateProps', nodeId: document.root.id, props: accessorProps },
    { type: 'updateProps', nodeId: document.root.id, props: { createdAt: new Date(0) } },
    { type: 'updateProps', nodeId: document.root.id, props: { circular } },
    {
      type: 'insertNode',
      parentId: document.root.id,
      node: {
        id: 'unsafe-insert',
        componentName: 'Text',
        props: { handler: { type: 'JSFunction', value: secret } },
        children: [],
      },
    },
  ]
  const before = captureKernelState(engine)

  for (const command of cases) {
    const base = capability.snapshot(document.id)
    const error = await captureFailure(() =>
      capability.preview({ documentId: document.id, baseRevision: base.revision, commands: [command] }),
    )
    expectCapabilityError(error, /^agent\.data\.invalid$/)
    assertKernelState(engine, before)
  }
  assert.equal(getterCalls, 0, 'validation and audit must never invoke accessors')
  assert.doesNotMatch(JSON.stringify(engine.agentCapabilities.getAuditRecords()), new RegExp(secret))
})

test('a prepared plan is stale after mutate plus undo ABA even when the schema is identical', async t => {
  const { capability, document, engine } = await createHarness(t, { commandTypes: ['updateProps'] })
  const original = structuredClone(document.export())
  const base = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: base.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'agent-write' } }],
  })

  engine.commands.execute({ type: 'updateProps', nodeId: document.root.id, props: { title: 'temporary-write' } })
  document.history.back()
  assert.deepEqual(document.export(), original, 'undo must restore identical visible schema for the ABA proof')
  const before = captureKernelState(engine)
  const error = await captureFailure(() => capability.execute(plan.planId))
  assert.equal(error.name, 'AgentPlanStaleError')
  assert.equal(error.code, 'agent.plan.stale')
  assert.equal(error.committed, false)
  assertKernelState(engine, before, 'stale plan rejection must be side-effect free')
  const audit = latestAudit(engine, record => record.action === 'execute' && record.planId === plan.planId)
  assert.equal(audit.decision, 'denied')
  assert.equal(audit.outcome, 'stale')
  assert.equal(audit.error.code, 'agent.plan.stale')
})

test('execute returns one committed receipt and one undo consumes the complete batch', async t => {
  const { capability, document } = await createHarness(t, {
    commandTypes: ['insertNode', 'updateProps'],
    componentNames: ['Text'],
  })
  const base = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: base.revision,
    commands: [
      {
        type: 'insertNode',
        parentId: document.root.id,
        node: { id: 'atomic-child', componentName: 'Text', props: { text: 'before' }, children: [] },
      },
      { type: 'updateProps', nodeId: 'atomic-child', props: { text: 'after', color: 'blue' } },
    ],
  })

  const receipt = capability.execute(plan.planId)
  assert.equal(receipt.status, 'committed')
  assert.equal(receipt.committed, true)
  assert.equal(typeof receipt.revision, 'string')
  assert.ok(receipt.revision.length > 0)
  assert.equal(receipt.commandCount, 2)
  assert.deepEqual(receipt.affectedNodeIds, ['atomic-child'])
  assert.equal(document.getNode('atomic-child').getPropValue('text'), 'after')
  assert.equal(document.history.isUndoable(), true)

  document.history.back()
  assert.equal(document.getNode('atomic-child'), null)
  assert.equal(document.history.isUndoable(), false, 'one undo must consume the complete Agent batch')
})

test('preview assigns missing insert IDs once and execute uses the prepared normalized command', async t => {
  const { capability, document } = await createHarness(t, {
    commandTypes: ['insertNode'],
    componentNames: ['Text'],
  })
  const base = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: base.revision,
    commands: [
      {
        type: 'insertNode',
        parentId: document.root.id,
        node: { componentName: 'Text', props: { text: 'prepared' }, children: [] },
      },
    ],
  })
  const preparedId = plan.effects[0].nodeIds[0]
  assert.match(preparedId, /^node-/)

  const receipt = capability.execute(plan.planId)
  assert.deepEqual(receipt.affectedNodeIds, [preparedId])
  assert.equal(document.getNode(preparedId).getPropValue('text'), 'prepared')
})

test('limits cannot exceed hard caps and dangerous prototype keys reject as plain-data violations', async t => {
  const { document, engine } = await createHarness(t)
  const capability = engine.agentCapabilities.issue({
    subjectId: 'agent:limits',
    documentIds: [document.id],
    commandTypes: ['updateProps'],
    limits: { maxCommands: 999, maxPayloadBytes: 999_999_999 },
  })
  assert.equal(capability.descriptor.grant.limits.maxCommands, 32)
  assert.equal(capability.descriptor.grant.limits.maxPayloadBytes, 256 * 1024)

  const constrained = engine.agentCapabilities.issue({
    subjectId: 'agent:constrained',
    documentIds: [document.id],
    commandTypes: ['updateProps'],
    limits: { maxCommands: 1 },
  })
  const constrainedBase = constrained.snapshot(document.id)
  const countError = await captureFailure(() =>
    constrained.preview({
      documentId: document.id,
      baseRevision: constrainedBase.revision,
      commands: [
        { type: 'updateProps', nodeId: document.root.id, props: { first: true } },
        { type: 'updateProps', nodeId: document.root.id, props: { second: true } },
      ],
    }),
  )
  expectCapabilityError(countError, /^agent\.limit\.commands$/)

  const before = captureKernelState(engine)
  const unsafeProps = JSON.parse('{"__proto__":{"polluted":true}}')
  const base = capability.snapshot(document.id)
  const unsafeError = await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: base.revision,
      commands: [{ type: 'updateProps', nodeId: document.root.id, props: unsafeProps }],
    }),
  )
  expectCapabilityError(unsafeError, /^agent\.data\.invalid$/)
  assert.equal({}.polluted, undefined)
  assertKernelState(engine, before)
})

test('deleting and recreating an identical document ID makes the prepared plan stale by identity', async t => {
  const { capability, document, engine } = await createHarness(t, { commandTypes: ['updateProps'] })
  const originalSchema = structuredClone(document.export())
  const base = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: base.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'must-not-apply' } }],
  })

  document.remove()
  const replacement = engine.project.createDocument(originalSchema).open()
  assert.equal(replacement.id, document.id)
  assert.notStrictEqual(replacement, document)
  const error = await captureFailure(() => capability.execute(plan.planId))
  assert.equal(error.name, 'AgentPlanStaleError')
  assert.equal(error.code, 'agent.plan.stale')
  assert.deepEqual(replacement.export(), originalSchema)
})

test('Agent execute cannot join an outer callback transaction and report a premature commit', async t => {
  const { capability, document, engine } = await createHarness(t, { commandTypes: ['updateProps'] })
  const base = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: base.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'premature' } }],
  })
  const before = captureKernelState(engine)
  let executeError

  engine.transactions.runSync(() => {
    try {
      capability.execute(plan.planId)
    } catch (error) {
      executeError = error
    }
  })

  expectCapabilityError(executeError, /^agent\.execution\.failed$/)
  assertKernelState(engine, before)
  const replayError = await captureFailure(() => capability.execute(plan.planId))
  expectCapabilityError(replayError, /^agent\.plan\.terminal$/)
})

test('failed execute audits rollback and leaks no model/history/events/material state', async t => {
  const { capability, core, document, engine } = await createHarness(t, {
    commandTypes: ['removeNode', 'updateProps'],
    schema: createSchemaWithChild(),
  })
  const base = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: base.revision,
    commands: [
      { type: 'updateProps', nodeId: document.root.id, props: { title: 'must-roll-back' } },
      { type: 'removeNode', nodeId: 'child-1' },
    ],
  })
  const before = captureKernelState(engine)
  const probe = observeDomainMutations(core, engine)
  t.after(() => probe.dispose())
  const target = document.getNode('child-1')
  const originalRemove = target.remove
  let removeAttempts = 0
  target.remove = function failFirstRemove(...args) {
    removeAttempts += 1
    if (removeAttempts === 1) throw new Error('forced Agent apply failure')
    return originalRemove.apply(this, args)
  }

  let error
  try {
    error = await captureFailure(() => capability.execute(plan.planId))
  } finally {
    target.remove = originalRemove
  }
  expectCapabilityError(error, /^agent\.execution\.failed$/)
  assert.ok(removeAttempts > 1, 'rollback must retry removal through the restored model path')
  assertKernelState(engine, before)
  assert.deepEqual(probe.read(), { children: 0, materials: 0, props: 0, selection: 0 })
  const audit = latestAudit(engine, record => record.action === 'execute' && record.planId === plan.planId)
  assert.equal(audit.decision, 'denied')
  assert.equal(audit.outcome, 'rolled_back')
  assert.equal(audit.error.code, error.code)
})
