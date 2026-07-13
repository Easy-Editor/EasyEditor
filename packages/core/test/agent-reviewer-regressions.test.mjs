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

async function createReadyEngine(t, schema = createProjectSchema()) {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.project.load(schema, true)
  return { document: engine.project.currentDocument, engine }
}

function issueCapability(engine, document, options = {}) {
  return engine.agentCapabilities.issue({
    subjectId: options.subjectId ?? 'agent:reviewer-regression',
    documentIds: [document.id],
    commandTypes: options.commandTypes ?? ['updateProps'],
    componentNames: options.componentNames ?? [],
    ...(options.limits ? { limits: options.limits } : {}),
  })
}

function prepareRootTitleUpdate(capability, document, title) {
  const snapshot = capability.snapshot(document.id)
  return capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title } }],
  })
}

function latestAudit(engine, predicate) {
  return [...engine.agentCapabilities.getAuditRecords()].reverse().find(predicate)
}

test('a net-zero A-to-B-to-A mutation in one runSync transaction makes an older Agent plan stale', async t => {
  const { document, engine } = await createReadyEngine(t)
  const capability = issueCapability(engine, document)
  const originalSchema = structuredClone(document.export())
  const plan = prepareRootTitleUpdate(capability, document, 'must-not-commit')

  engine.transactions.runSync(() => {
    document.root.setPropValue('title', 'temporary-B')
    document.root.setPropValue('title', 'before')
  })
  assert.deepEqual(document.export(), originalSchema, 'the transaction must end at the same visible A state')

  const error = await captureFailure(() => capability.execute(plan.planId))
  assert.equal(error.name, 'AgentPlanStaleError')
  assert.equal(error.code, 'agent.plan.stale')
  assert.equal(error.committed, false)
  assert.deepEqual(document.export(), originalSchema, 'a stale plan must not write after the net-zero ABA')

  const audit = latestAudit(engine, record => record.action === 'execute' && record.planId === plan.planId)
  assert.equal(audit.decision, 'denied')
  assert.equal(audit.outcome, 'stale')
  assert.equal(audit.error.code, 'agent.plan.stale')
})

test('a stale Agent precondition does not split the user history session it rejects', async t => {
  const { document, engine } = await createReadyEngine(t)
  const capability = issueCapability(engine, document)
  const plan = prepareRootTitleUpdate(capability, document, 'must-not-commit')
  document.history.savePoint()

  document.root.setPropValue('title', 'coalesced-a')
  const error = await captureFailure(() => capability.execute(plan.planId))
  assert.equal(error.name, 'AgentPlanStaleError')
  document.root.setPropValue('title', 'coalesced-b')

  assert.equal(document.root.getPropValue('title'), 'coalesced-b')
  document.history.back()
  assert.equal(
    document.root.getPropValue('title'),
    'before',
    'the two direct edits around a rejected Agent plan must remain one undo group',
  )
})

test('untrusted identifiers are sanitized in audit records and audit retention remains bounded', async t => {
  const { document, engine } = await createReadyEngine(t)
  const capability = issueCapability(engine, document)
  capability.snapshot(document.id)
  const sensitiveDocumentToken = 'sensitive-document-token'
  const sensitiveRevisionToken = 'sensitive-revision-token'
  const sensitivePlanToken = 'sensitive-plan-token'
  const invalidDocumentId = `${sensitiveDocumentToken}:${'d'.repeat(4096)}`
  const invalidBaseRevision = `${sensitiveRevisionToken}:${'r'.repeat(4096)}`
  const invalidPlanId = `${sensitivePlanToken}:${'p'.repeat(4096)}`

  await captureFailure(() => capability.snapshot(invalidDocumentId))
  await captureFailure(() =>
    capability.preview({
      documentId: document.id,
      baseRevision: invalidBaseRevision,
      commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'denied' } }],
    }),
  )
  await captureFailure(() => capability.execute(invalidPlanId))

  const rejectedRecords = engine.agentCapabilities.getAuditRecords()
  assert.equal(
    rejectedRecords.some(record => record.action === 'snapshot' && record.decision === 'denied'),
    true,
    'invalid snapshot attempts must still be auditable',
  )
  assert.equal(
    rejectedRecords.some(record => record.action === 'preview' && record.decision === 'denied'),
    true,
    'invalid preview attempts must still be auditable',
  )
  assert.equal(
    rejectedRecords.some(record => record.action === 'execute' && record.decision === 'denied'),
    true,
    'invalid execute attempts must still be auditable',
  )
  const serializedAudit = JSON.stringify(rejectedRecords)
  assert.doesNotMatch(serializedAudit, new RegExp(sensitiveDocumentToken))
  assert.doesNotMatch(serializedAudit, new RegExp(sensitiveRevisionToken))
  assert.doesNotMatch(serializedAudit, new RegExp(sensitivePlanToken))

  const auditIdBeforeFlood = rejectedRecords.at(-1).auditId
  for (let index = 0; index < 1030; index += 1) {
    assert.throws(
      () => capability.execute(`missing-plan-${index}`),
      error => error?.name === 'AgentCapabilityError' && error.code === 'agent.plan.notFound',
    )
  }
  const retained = engine.agentCapabilities.getAuditRecords()
  assert.ok(retained.length <= 1024, 'audit storage must have a fixed upper bound')
  assert.equal(
    retained.some(record => record.auditId === auditIdBeforeFlood),
    false,
    'old audit records must be evicted after the retention bound is reached',
  )
  assert.equal(retained.at(-1).action, 'execute')
  assert.equal(retained.at(-1).error.code, 'agent.plan.notFound')
})

test('an incomplete rollback is terminal and audited explicitly instead of being reported as rolled back', async t => {
  const { document, engine } = await createReadyEngine(t, createSchemaWithChild())
  const capability = issueCapability(engine, document, { commandTypes: ['removeNode', 'updateProps'] })
  const snapshot = capability.snapshot(document.id)
  const plan = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [
      { type: 'updateProps', nodeId: document.root.id, props: { title: 'must-be-restored' } },
      { type: 'removeNode', nodeId: 'child-1' },
    ],
  })
  const before = structuredClone(document.export())
  const target = document.getNode('child-1')
  const originalRemove = target.remove
  const originalRollback = document.history.rollbackTransaction
  let removeAttempts = 0
  target.remove = function failFirstRemove(...args) {
    removeAttempts += 1
    if (removeAttempts === 1) throw new Error('forced apply failure')
    return originalRemove.apply(this, args)
  }
  document.history.rollbackTransaction = function rollbackThenReportFailure() {
    originalRollback.call(this)
    throw new Error('forced rollback verification failure')
  }

  try {
    const error = await captureFailure(() => capability.execute(plan.planId))
    assert.equal(error.name, 'AgentCapabilityError')
    assert.match(error.code, /rollback.?incomplete/i)
    assert.equal(error.committed, false)
    assert.deepEqual(document.export(), before, 'the successful rollback portion should restore the visible schema')

    const audit = latestAudit(engine, record => record.action === 'execute' && record.planId === plan.planId)
    assert.equal(audit.decision, 'denied')
    assert.equal(audit.outcome, 'rollback_incomplete')
    assert.match(audit.error.code, /rollback.?incomplete/i)
    assert.notEqual(audit.outcome, 'rolled_back')

    assert.ok(removeAttempts > 1, 'rollback must run after the injected apply failure')
    const attemptsAfterRollback = removeAttempts
    const replayError = await captureFailure(() => capability.execute(plan.planId))
    assert.equal(replayError.name, 'AgentCapabilityError')
    assert.equal(replayError.code, 'agent.plan.terminal')
    assert.equal(removeAttempts, attemptsAfterRollback, 'an incompletely rolled-back plan must never be retried')
  } finally {
    target.remove = originalRemove
    document.history.rollbackTransaction = originalRollback
  }
})

test('a post-commit snapshot-limit failure never presents the base revision as the current revision', async t => {
  const { document, engine } = await createReadyEngine(t)
  const initialBytes = new TextEncoder().encode(JSON.stringify(document.export())).byteLength
  const capability = issueCapability(engine, document, {
    limits: { maxSnapshotBytes: initialBytes + 128 },
  })
  const oversizedTitle = `committed:${'x'.repeat(4096)}`
  const plan = prepareRootTitleUpdate(capability, document, oversizedTitle)

  const receipt = capability.execute(plan.planId)
  assert.equal(receipt.status, 'committed_with_observer_errors')
  assert.equal(receipt.committed, true)
  assert.equal(document.root.getPropValue('title'), oversizedTitle, 'the model commit must remain visible')
  assert.notEqual(
    receipt.revision,
    plan.baseRevision,
    'an unavailable current revision must be omitted or represented by a fresh token, never by the base revision',
  )

  const audit = latestAudit(engine, record => record.action === 'execute' && record.planId === plan.planId)
  assert.equal(audit.decision, 'allowed')
  assert.equal(audit.outcome, 'committed_with_observer_errors')
  assert.equal(audit.error.code, 'agent.postCommit.verificationFailed')
  assert.equal(audit.error.committed, true)
  assert.notEqual(audit.currentRevision, plan.baseRevision)

  const replayError = await captureFailure(() => capability.execute(plan.planId))
  assert.equal(replayError.code, 'agent.plan.terminal')
})
