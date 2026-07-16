import assert from 'node:assert/strict'
import test from 'node:test'

import {
  commitDurableAgentBatch,
  recordDurableAgentIntent,
  recoverDurableAgentReceipt,
} from '../src/editor/agent/persistence/durable-agent-commit.mjs'
import { createFieldSlotAliases, createMutationProvenanceBatch } from '../src/editor/agent/persistence/provenance.mjs'
import {
  PersistenceLineageContractError,
  createApplyWitness,
  createFailureWitness,
  createReceiptIntent,
  createToolReceipt,
  createToolReceiptWitness,
} from '../src/editor/agent/persistence/receipt-ledger.mjs'
import { MemoryDashboardStorageBackend, ProjectPersistenceCoordinator } from '../src/lib/storage/index.mjs'

const SHA_A = `sha256:${'a'.repeat(64)}`
const SHA_B = `sha256:${'b'.repeat(64)}`

const authority = Object.freeze({
  projectId: 'project-durable-agent',
  branchId: 'main',
  callId: 'call-1',
})

const projectSchema = Object.freeze({
  version: '1.0.0',
  componentsTree: [{ id: 'root', docId: 'page-home', fileName: 'home', componentName: 'Root' }],
})

const activeDocument = Object.freeze({ documentId: 'page-home', fileName: 'home', index: 0 })

const intentFor = (overrides = {}) =>
  createReceiptIntent({
    schemaVersion: 1,
    ...authority,
    preparedHash: SHA_A,
    baseRevision: 'core:4:registry:2',
    preImages: [{ slotKey: 'title', value: 'A' }],
    expectedPostImages: [{ slotKey: 'title', value: 'B' }],
    status: 'pending',
    ...overrides,
  })

const appliedOutcome = (overrides = {}) => {
  const scope = { ...authority, ...(overrides.authority ?? {}) }
  const draftGeneration = overrides.draftGeneration ?? 1
  const slotKeys = createFieldSlotAliases({
    projectId: scope.projectId,
    branchId: scope.branchId,
    nodeId: 'title-1',
    root: 'props',
    path: ['text'],
  })
  const provenance = createMutationProvenanceBatch({
    projectId: scope.projectId,
    branchId: scope.branchId,
    draftGeneration,
    slotKeys,
    source: 'agent',
    callId: scope.callId,
  })
  const witness = createApplyWitness({
    schemaVersion: 1,
    ...scope,
    draftGeneration,
    coreMutationVersion: 5,
    transactionFingerprint: SHA_B,
    affectedSlotTokens: provenance.map(({ slotKey, token }) => ({ slotKey, token })),
  })
  const receipt = createToolReceipt({
    schemaVersion: 1,
    ...scope,
    status: 'applied',
    revision: 'core:5:registry:2',
    witness: createToolReceiptWitness(witness),
  })
  return { provenance, receipt, witness }
}

const failedOutcome = (scope = authority) => {
  const witness = createFailureWitness({
    schemaVersion: 1,
    ...scope,
    draftGeneration: 1,
    transactionFingerprint: SHA_B,
    receiptStatus: 'not-applied',
    failureCode: 'VALIDATION_FAILED',
  })
  const receipt = createToolReceipt({
    schemaVersion: 1,
    ...scope,
    status: 'not-applied',
    revision: 'core:4:registry:2',
    witness: createToolReceiptWitness(witness),
  })
  return { provenance: [], receipt, witness }
}

const createHarness = options => {
  const backend = new MemoryDashboardStorageBackend(options)
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  return { backend, coordinator }
}

const commitInput = (intent, outcome, overrides = {}) => ({
  schemaVersion: 1,
  ...authority,
  expectedDraftGeneration: 0,
  activeDocument,
  projectSchema,
  updatedAt: 100,
  receiptIntent: intent,
  receipt: outcome.receipt,
  witness: outcome.witness,
  provenance: outcome.provenance,
  sessionId: 'session-1',
  journal: {
    recordId: 'task:task-1',
    kind: 'journal-head',
    value: { taskId: 'task-1', stepId: 'step-1', phase: 'VERIFY' },
  },
  checkpoint: {
    checkpointId: 'verified:call-1',
    value: { taskId: 'task-1', stepId: 'step-1', verified: true },
  },
  artifactRefs: [
    {
      ownerType: 'checkpoint',
      ownerId: 'verified:call-1',
      artifactId: 'artifact-kpi',
      sourceRevision: 'revision-7',
    },
  ],
  ...overrides,
})

test('receipt intent is written only through the coordinator and is idempotent for exact bytes', async () => {
  const { backend, coordinator } = createHarness()
  const intent = intentFor()

  assert.deepEqual(await recordDurableAgentIntent({ coordinator, intent }), intent)
  assert.deepEqual(await recordDurableAgentIntent({ coordinator, intent: structuredClone(intent) }), intent)
  await assert.rejects(
    recordDurableAgentIntent({
      coordinator,
      intent: intentFor({ expectedPostImages: [{ slotKey: 'title', value: 'C' }] }),
    }),
    error => error.code === 'integrity-mismatch',
  )
  assert.deepEqual(
    await backend.get('receiptIntents', [authority.projectId, authority.branchId, authority.callId]),
    intent,
  )
})

test('an Agent outcome cannot commit before its coordinator-owned receipt intent exists', async () => {
  const { backend, coordinator } = createHarness()
  const intent = intentFor()
  await assert.rejects(
    commitDurableAgentBatch({ coordinator, batch: commitInput(intent, appliedOutcome()) }),
    error => error instanceof PersistenceLineageContractError && error.reason === 'missing-durable-receipt-intent',
  )
  assert.deepEqual(await backend.getAll('workingDrafts'), [])
  assert.deepEqual(await backend.getAll('toolReceipts'), [])
})

test('applied outcome atomically commits the full draft, exact lineage, journal, checkpoint, and artifact refs', async () => {
  const { backend, coordinator } = createHarness()
  const intent = intentFor()
  const outcome = appliedOutcome()
  await recordDurableAgentIntent({ coordinator, intent })

  const result = await commitDurableAgentBatch({ coordinator, batch: commitInput(intent, outcome) })

  assert.equal(result.status, 'committed')
  assert.equal(result.draft.draftGeneration, 1)
  assert.equal(result.draft.commitKind, 'agent-batch')
  assert.deepEqual(result.receipt, outcome.receipt)
  assert.deepEqual(result.draft.projectSchema, projectSchema)

  const key = [authority.projectId, authority.branchId, authority.callId]
  assert.deepEqual(await backend.get('toolReceipts', key), outcome.receipt)
  assert.deepEqual(await backend.get('applyWitnesses', key), outcome.witness)
  assert.equal(await backend.get('failureWitnesses', key), undefined)
  for (const record of outcome.provenance) {
    assert.deepEqual(
      await backend.get('mutationProvenance', [authority.projectId, authority.branchId, record.slotKey]),
      record,
    )
  }
  assert.deepEqual(
    await backend.get('taskJournals', [authority.projectId, authority.branchId, 'session-1', 'task:task-1']),
    {
      schemaVersion: 1,
      projectId: authority.projectId,
      branchId: authority.branchId,
      sessionId: 'session-1',
      recordId: 'task:task-1',
      kind: 'journal-head',
      callId: authority.callId,
      draftGeneration: 1,
      value: { taskId: 'task-1', stepId: 'step-1', phase: 'VERIFY' },
    },
  )
  assert.deepEqual(
    await backend.get('agentCheckpoints', [authority.projectId, authority.branchId, 'verified:call-1']),
    {
      schemaVersion: 1,
      projectId: authority.projectId,
      branchId: authority.branchId,
      checkpointId: 'verified:call-1',
      sessionId: 'session-1',
      callId: authority.callId,
      draftGeneration: 1,
      journalRecordId: 'task:task-1',
      outcome: 'committed',
      value: { taskId: 'task-1', stepId: 'step-1', verified: true },
    },
  )
  assert.deepEqual(
    await backend.get('artifactRefs', [
      authority.projectId,
      authority.branchId,
      'checkpoint',
      'verified:call-1',
      'artifact-kpi',
      'revision-7',
    ]),
    {
      schemaVersion: 1,
      projectId: authority.projectId,
      branchId: authority.branchId,
      ownerType: 'checkpoint',
      ownerId: 'verified:call-1',
      artifactId: 'artifact-kpi',
      sourceRevision: 'revision-7',
      callId: authority.callId,
      draftGeneration: 1,
    },
  )
})

test('ACK-loss recovery returns the original applied receipt only through exact durable lineage', async () => {
  const { coordinator } = createHarness()
  const intent = intentFor()
  const outcome = appliedOutcome()
  await recordDurableAgentIntent({ coordinator, intent })
  await commitDurableAgentBatch({ coordinator, batch: commitInput(intent, outcome) })

  assert.deepEqual(await recoverDurableAgentReceipt({ coordinator, ...authority }), {
    classification: 'committed',
    receipt: outcome.receipt,
  })
})

test('intent-only recovery remains indeterminate even when post-image bytes look equal', async () => {
  const { coordinator } = createHarness()
  const intent = intentFor()
  await recordDurableAgentIntent({ coordinator, intent })

  assert.deepEqual(await recoverDurableAgentReceipt({ coordinator, ...authority }), {
    classification: 'indeterminate',
    reason: 'missing-durable-receipt',
  })
  assert.equal(intent.expectedPostImages[0].value, 'B')
})

test('failure outcome commits an exact FailureWitness with no Agent provenance and recovers the failed receipt', async () => {
  const { backend, coordinator } = createHarness()
  const failureAuthority = { ...authority, callId: 'call-failure' }
  const intent = intentFor({ callId: failureAuthority.callId })
  const outcome = failedOutcome(failureAuthority)
  await recordDurableAgentIntent({ coordinator, intent })

  const result = await commitDurableAgentBatch({
    coordinator,
    batch: commitInput(intent, outcome, {
      callId: failureAuthority.callId,
      checkpoint: {
        checkpointId: 'failed:call-failure',
        value: { taskId: 'task-1', stepId: 'step-1', verified: false },
      },
      artifactRefs: [],
    }),
  })

  const key = [failureAuthority.projectId, failureAuthority.branchId, failureAuthority.callId]
  assert.equal(result.status, 'committed')
  assert.deepEqual(await backend.get('failureWitnesses', key), outcome.witness)
  assert.equal(await backend.get('applyWitnesses', key), undefined)
  assert.deepEqual(await backend.getAll('mutationProvenance'), [])
  assert.deepEqual(await recoverDurableAgentReceipt({ coordinator, ...failureAuthority }), {
    classification: 'failed',
    receipt: outcome.receipt,
  })

  await coordinator.commit({
    schemaVersion: 1,
    batchId: 'manual-save-after-failure',
    projectId: failureAuthority.projectId,
    branchId: failureAuthority.branchId,
    expectedDraftGeneration: 1,
    activeDocument,
    projectSchema: { ...projectSchema, version: '2.0.0' },
    commitKind: 'manual-save',
    updatedAt: 101,
    operations: [],
  })
  assert.deepEqual(await recoverDurableAgentReceipt({ coordinator, ...failureAuthority }), {
    classification: 'failed',
    receipt: outcome.receipt,
  })
})

test('authority, generation, witness, and exact provenance mismatches reject before any durable outcome write', async () => {
  const { backend, coordinator } = createHarness()
  const intent = intentFor()
  const outcome = appliedOutcome()
  await recordDurableAgentIntent({ coordinator, intent })

  const mismatchedReceipt = createToolReceipt({
    ...outcome.receipt,
    witness: { ...outcome.receipt.witness, transactionFingerprint: `sha256:${'c'.repeat(64)}` },
  })
  const failure = failedOutcome()
  const cases = [
    commitInput(intent, outcome, { receipt: { ...outcome.receipt, branchId: 'other' } }),
    commitInput(intent, appliedOutcome({ draftGeneration: 2 })),
    commitInput(intent, outcome, { receipt: mismatchedReceipt }),
    commitInput(intent, outcome, { provenance: outcome.provenance.slice(1) }),
    commitInput(intent, failure, { provenance: outcome.provenance }),
  ]

  for (const batch of cases) {
    await assert.rejects(
      commitDurableAgentBatch({ coordinator, batch }),
      error => error instanceof PersistenceLineageContractError && error.code === 'INVALID_LINEAGE_DTO',
    )
  }

  assert.equal(await backend.get('workingDrafts', [authority.projectId, authority.branchId]), undefined)
  assert.equal(
    await backend.get('toolReceipts', [authority.projectId, authority.branchId, authority.callId]),
    undefined,
  )
  assert.deepEqual(await backend.getAll('mutationProvenance'), [])
})

test('add-mode receipt and witness keys enforce at-most-one durable accepted effect per callId', async () => {
  const { backend, coordinator } = createHarness()
  const intent = intentFor()
  const first = appliedOutcome()
  await recordDurableAgentIntent({ coordinator, intent })
  await commitDurableAgentBatch({ coordinator, batch: commitInput(intent, first) })

  const second = appliedOutcome({ draftGeneration: 2 })
  await assert.rejects(
    commitDurableAgentBatch({
      coordinator,
      batch: commitInput(intent, second, {
        expectedDraftGeneration: 1,
        projectSchema: { ...projectSchema, version: '2.0.0' },
        updatedAt: 200,
      }),
    }),
    error => error.code === 'transaction-aborted',
  )

  const key = [authority.projectId, authority.branchId, authority.callId]
  assert.equal((await backend.get('workingDrafts', [authority.projectId, authority.branchId])).draftGeneration, 1)
  assert.deepEqual(await backend.get('toolReceipts', key), first.receipt)
  assert.deepEqual(await backend.get('applyWitnesses', key), first.witness)
  assert.equal(
    (await backend.get('agentCheckpoints', [authority.projectId, authority.branchId, 'verified:call-1']))
      .draftGeneration,
    1,
  )
})

test('an aborted durable batch leaves no partial draft, receipt, witness, provenance, journal, checkpoint, or ref', async () => {
  const { backend, coordinator } = createHarness({
    faultInjector(event) {
      if (event.phase === 'after-operation' && event.operationIndex === 4) {
        throw new Error('crash after journal write')
      }
    },
  })
  const intent = intentFor()
  const outcome = appliedOutcome()
  await recordDurableAgentIntent({ coordinator, intent })

  await assert.rejects(
    commitDurableAgentBatch({ coordinator, batch: commitInput(intent, outcome) }),
    error => error.code === 'transaction-aborted',
  )

  assert.deepEqual(
    await backend.get('receiptIntents', [authority.projectId, authority.branchId, authority.callId]),
    intent,
  )
  for (const store of [
    'workingDrafts',
    'toolReceipts',
    'applyWitnesses',
    'failureWitnesses',
    'mutationProvenance',
    'taskJournals',
    'agentCheckpoints',
    'artifactRefs',
  ]) {
    assert.deepEqual(await backend.getAll(store), [], `${store} must roll back atomically`)
  }
})
