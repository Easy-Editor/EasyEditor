import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

function issueUpdateCapability(engine, subjectId = 'agent:audit') {
  const document = engine.project.currentDocument
  return engine.agentCapabilities.issue({
    subjectId,
    documentIds: [document.id],
    commandTypes: ['updateProps'],
  })
}

async function createReadyEngine(t, subjectId = 'agent:audit') {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema(), true)
  return {
    capability: issueUpdateCapability(engine, subjectId),
    core,
    document: engine.project.currentDocument,
    engine,
  }
}

function prepareUpdate(capability, document, title) {
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

function assertAuditRecord(record, expected) {
  assert.equal(record.version, 1)
  assert.equal(record.action, expected.action)
  assert.equal(record.decision, expected.decision)
  assert.equal(record.outcome, expected.outcome)
  assert.equal(record.documentId, expected.documentId)
  assert.equal(record.planId, expected.planId)
  assert.equal(record.subjectId, expected.subjectId)
  assert.equal(typeof record.auditId, 'string')
  assert.ok(record.auditId.length > 0)
  assert.equal(typeof record.capabilityId, 'string')
  assert.ok(record.capabilityId.length > 0)
  assert.equal(typeof record.timestamp, 'number')
  assert.equal(typeof record.engineState, 'string')
  assert.equal(typeof record.hostTrust, 'string')
  assert.equal(Object.isFrozen(record), true)
  if (record.commands) {
    assert.equal(Object.isFrozen(record.commands), true)
    for (const field of ['types', 'nodeIds', 'componentNames', 'propKeys', 'extraKeys']) {
      assert.equal(Object.isFrozen(record.commands[field]), true)
    }
  }
  if (record.error) assert.equal(Object.isFrozen(record.error), true)
  assert.equal(Object.hasOwn(record, 'message'), false)
  assert.equal(Object.hasOwn(record, 'affectedNodeIds'), false)
}

test('audit records are immutable/redacted and one failing listener cannot starve commit or later listeners', async t => {
  const { capability, document, engine } = await createReadyEngine(t)
  const secret = 'raw-audit-prop-secret'
  const base = capability.snapshot(document.id)
  let throwingCalls = 0
  const delivered = []
  const disposeThrowing = engine.agentCapabilities.subscribeAudit(() => {
    throwingCalls += 1
    throw new Error('audit listener failed')
  })
  const disposeDelivered = engine.agentCapabilities.subscribeAudit(record => delivered.push(record))
  t.after(disposeThrowing)
  t.after(disposeDelivered)

  const plan = capability.preview({
    documentId: document.id,
    baseRevision: base.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: secret } }],
  })
  const receipt = capability.execute(plan.planId)
  assert.equal(receipt.status, 'committed')
  assert.equal(receipt.committed, true)
  assert.equal(document.root.getPropValue('title'), secret)
  assert.equal(throwingCalls, 0, 'audit listeners must not run inside the capability call stack')
  assert.equal(delivered.length, 0, 'audit delivery must be queued outside the capability call stack')
  await Promise.resolve()
  assert.equal(throwingCalls, 2)
  assert.equal(delivered.length, 2, 'one listener failure must not starve later audit listeners')

  const records = engine.agentCapabilities.getAuditRecords()
  assert.equal(Object.isFrozen(records), true)
  const previewAudit = records.find(record => record.action === 'preview' && record.planId === plan.planId)
  const executeAudit = records.find(record => record.action === 'execute' && record.planId === plan.planId)
  assertAuditRecord(previewAudit, {
    action: 'preview',
    decision: 'allowed',
    outcome: 'prepared',
    documentId: document.id,
    planId: plan.planId,
    subjectId: 'agent:audit',
  })
  assertAuditRecord(executeAudit, {
    action: 'execute',
    decision: 'allowed',
    outcome: 'committed',
    documentId: document.id,
    planId: plan.planId,
    subjectId: 'agent:audit',
  })
  assert.deepEqual(previewAudit.commands, {
    count: 1,
    types: ['updateProps'],
    nodeIds: [document.root.id],
    componentNames: [],
    propKeys: ['title'],
    extraKeys: [],
  })
  assert.doesNotMatch(JSON.stringify(records), new RegExp(secret))
  assert.throws(() => {
    executeAudit.outcome = 'tampered'
  }, TypeError)
  assert.equal(
    engine.agentCapabilities.getAuditRecords().find(record => record.auditId === executeAudit.auditId).outcome,
    'committed',
  )

  disposeThrowing()
  disposeDelivered()
  const deliveredBefore = delivered.length
  prepareUpdate(capability, document, 'after-unsubscribe')
  await Promise.resolve()
  assert.equal(delivered.length, deliveredBefore)
})

test('audit delivery cannot mutate a document before a committed receipt is returned', async t => {
  const { capability, document, engine } = await createReadyEngine(t, 'agent:audit-boundary')
  let executeAuditCalls = 0
  const dispose = engine.agentCapabilities.subscribeAudit(record => {
    if (record.action !== 'execute' || record.outcome !== 'committed') return
    executeAuditCalls += 1
    document.insertNode(
      document.root,
      { id: 'host-audit-node', componentName: 'HostOnly', props: {}, children: [] },
      -1,
    )
  })
  t.after(dispose)

  const plan = prepareUpdate(capability, document, 'committed-before-audit-delivery')
  const receipt = capability.execute(plan.planId)
  const immediateSnapshot = capability.snapshot(document.id)

  assert.equal(executeAuditCalls, 0)
  assert.equal(document.getNode('host-audit-node'), null)
  assert.equal(receipt.status, 'committed')
  assert.equal(receipt.revision, immediateSnapshot.revision)

  await Promise.resolve()
  assert.equal(executeAuditCalls, 1)
  assert.equal(document.getNode('host-audit-node')?.componentName, 'HostOnly')
})

test('audit delivery is skipped without listeners and coalesced into one bounded microtask with listeners', async t => {
  const { capability, engine } = await createReadyEngine(t, 'agent:audit-queue')
  const originalQueueMicrotask = globalThis.queueMicrotask
  const pending = []
  let delivered = 0
  try {
    globalThis.queueMicrotask = callback => pending.push(callback)
    assert.throws(() => capability.execute('missing-without-listener'))
    assert.equal(pending.length, 0, 'audits without subscribers must not allocate delivery microtasks')

    const dispose = engine.agentCapabilities.subscribeAudit(() => {
      delivered += 1
    })
    t.after(dispose)
    for (let index = 0; index < 1200; index += 1) {
      assert.throws(() => capability.execute(`missing-${index}`))
    }
    assert.equal(pending.length, 1, 'a synchronous audit burst must use one scheduled drain')
  } finally {
    globalThis.queueMicrotask = originalQueueMicrotask
  }

  pending.shift()?.()
  assert.equal(delivered, 1024, 'the pending audit delivery queue must share the bounded retention ceiling')
})

test('audit scheduling failures cannot retain a closed capability and subscriptions fail closed after destroy', async t => {
  const { capability, document, engine } = await createReadyEngine(t, 'agent:audit-scheduler-failure')
  const dispose = engine.agentCapabilities.subscribeAudit(() => {})
  const originalQueueMicrotask = globalThis.queueMicrotask
  try {
    globalThis.queueMicrotask = () => {
      throw new Error('scheduler unavailable')
    }
    assert.doesNotThrow(() => capability.close())
  } finally {
    globalThis.queueMicrotask = originalQueueMicrotask
    dispose()
  }

  const revoked = await captureFailure(() => capability.snapshot(document.id))
  assertCapabilityError(revoked, /^agent\.capability\.revoked$/)
  await engine.destroy()
  const lateSubscription = await captureFailure(() => engine.agentCapabilities.subscribeAudit(() => {}))
  assertCapabilityError(lateSubscription, /^agent\.lifecycle\.notReady$/)
})

test('restricted policy reports a co-realm assurance instead of claiming process isolation', async t => {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null })
  t.after(() => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema(), true)
  const document = engine.project.currentDocument
  const capability = engine.agentCapabilities.issue({
    subjectId: 'agent:assurance',
    documentIds: [document.id],
    commandTypes: [],
  })

  assert.equal(capability.descriptor.assurance, 'policy-restricted-co-realm')
  assert.doesNotMatch(capability.descriptor.assurance, /^restricted-realm$/)
})

test('plan IDs and audit streams are engine-bound even when document and node IDs are identical', async t => {
  const core = await loadCore()
  const engineA = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  const engineB = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(async () => {
    await engineA.destroy()
    await engineB.destroy()
  })
  await engineA.init()
  await engineB.init()
  engineA.project.load(createProjectSchema(), true)
  engineB.project.load(createProjectSchema(), true)
  const documentA = engineA.project.currentDocument
  const documentB = engineB.project.currentDocument
  assert.equal(documentA.id, documentB.id)
  const capabilityA = issueUpdateCapability(engineA, 'agent:a')
  const capabilityB = issueUpdateCapability(engineB, 'agent:b')
  const beforeB = structuredClone(documentB.export())
  const historyBeforeB = documentB.history.getState()
  const planA = prepareUpdate(capabilityA, documentA, 'only-a')

  const error = await captureFailure(() => capabilityB.execute(planA.planId))
  assertCapabilityError(error, /^agent\.plan\.notFound$/)
  assert.deepEqual(documentB.export(), beforeB)
  assert.equal(documentB.history.getState(), historyBeforeB)
  assert.equal(
    engineA.agentCapabilities
      .getAuditRecords()
      .some(record => record.action === 'execute' && record.planId === planA.planId),
    false,
  )
  const rejectedB = engineB.agentCapabilities
    .getAuditRecords()
    .find(record => record.action === 'execute' && record.planId === planA.planId)
  assert.equal(rejectedB.decision, 'denied')
  assert.equal(rejectedB.outcome, 'rejected')
  assert.equal(rejectedB.error.code, error.code)

  capabilityA.execute(planA.planId)
  assert.equal(documentA.root.getPropValue('title'), 'only-a')
  assert.equal(documentB.root.getPropValue('title'), 'before')

  await engineA.destroy()
  const planB = prepareUpdate(capabilityB, documentB, 'still-b')
  capabilityB.execute(planB.planId)
  assert.equal(documentB.root.getPropValue('title'), 'still-b')
})

test('Agent commits suppress executable host observers and remain terminal', async t => {
  const { capability, core, document, engine } = await createReadyEngine(t, 'agent:observer-failure')
  let observerCalls = 0
  const disposeThrowing = engine.designer.onEvent(core.DESIGNER_EVENT.NODE_PROPS_CHANGE, () => {
    observerCalls += 1
    throw new Error('observer failed after commit')
  })
  t.after(disposeThrowing)
  const plan = prepareUpdate(capability, document, 'committed-once')

  const receipt = capability.execute(plan.planId)
  assert.equal(receipt.status, 'committed')
  assert.equal(receipt.committed, true)
  assert.equal(receipt.observerErrorCount, 0)
  assert.equal(observerCalls, 0)
  assert.equal(document.root.getPropValue('title'), 'committed-once')
  const audit = engine.agentCapabilities
    .getAuditRecords()
    .find(record => record.action === 'execute' && record.planId === plan.planId)
  assert.equal(audit.decision, 'allowed')
  assert.equal(audit.outcome, 'committed')
  assert.equal(audit.error, undefined)

  const replayError = await captureFailure(() => capability.execute(plan.planId))
  assertCapabilityError(replayError, /^agent\.plan\.terminal$/)
  assert.equal(document.root.getPropValue('title'), 'committed-once')
})

test('manager activates only while ready; close/destroy permanently revoke capabilities and plans across restart', async t => {
  const core = await loadCore()
  const coldEngine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => coldEngine.destroy())
  const coldIssueError = await captureFailure(() =>
    coldEngine.agentCapabilities.issue({ subjectId: 'agent:cold', documentIds: [], commandTypes: [] }),
  )
  assertCapabilityError(coldIssueError, /^agent\.lifecycle\.notReady$/)

  const { capability, document, engine } = await createReadyEngine(t, 'agent:lifecycle')
  const closedPlan = prepareUpdate(capability, document, 'closed')
  capability.close()
  capability.close()
  const closedSnapshotError = await captureFailure(() => capability.snapshot(document.id))
  assertCapabilityError(closedSnapshotError, /agent\.capability\.(closed|revoked)/)
  const closedExecuteError = await captureFailure(() => capability.execute(closedPlan.planId))
  assertCapabilityError(closedExecuteError, /agent\.capability\.(closed|revoked)/)
  const revokeAudit = engine.agentCapabilities
    .getAuditRecords()
    .find(record => record.action === 'revoke' && record.capabilityId === capability.descriptor.capabilityId)
  assert.equal(revokeAudit.decision, 'allowed')
  assert.equal(revokeAudit.outcome, 'revoked')

  const liveCapability = issueUpdateCapability(engine, 'agent:pre-destroy')
  const oldPlan = prepareUpdate(liveCapability, document, 'old-epoch')
  const oldListenerRecords = []
  engine.agentCapabilities.subscribeAudit(record => oldListenerRecords.push(record))
  await engine.destroy()
  const revokedError = await captureFailure(() => liveCapability.execute(oldPlan.planId))
  assertCapabilityError(revokedError, /agent\.capability\.(closed|revoked)/)

  await engine.init()
  engine.project.load(createProjectSchema(), true)
  const restartedDocument = engine.project.currentDocument
  const restartedCapability = issueUpdateCapability(engine, 'agent:restarted')
  const beforeRestarted = structuredClone(restartedDocument.export())
  const invalidatedPlanError = await captureFailure(() => restartedCapability.execute(oldPlan.planId))
  assertCapabilityError(invalidatedPlanError, /^agent\.plan\.notFound$/)
  assert.deepEqual(restartedDocument.export(), beforeRestarted)

  const oldListenerCount = oldListenerRecords.length
  const restartedPlan = prepareUpdate(restartedCapability, restartedDocument, 'new-epoch')
  restartedCapability.execute(restartedPlan.planId)
  assert.equal(restartedDocument.root.getPropValue('title'), 'new-epoch')
  assert.equal(oldListenerRecords.length, oldListenerCount, 'destroy must release manager audit subscribers')
})
