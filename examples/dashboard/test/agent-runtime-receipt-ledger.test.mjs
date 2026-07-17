import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DASHBOARD_CAPABILITY_DESCRIPTORS,
  DASHBOARD_FUTURE_CAPABILITY_UNAVAILABLE_REASON,
} from '../src/editor/agent/capabilities/index.mjs'
import {
  PersistenceLineageContractError,
  classifyReceiptRecovery,
  createApplyWitness,
  createFailureWitness,
  createReceiptIntent,
  createToolReceipt,
  createToolReceiptWitness,
  parseApplyWitness,
  parseFailureWitness,
  parseReceiptIntent,
  parseToolReceipt,
} from '../src/editor/agent/persistence/index.mjs'
import {
  createAgentProvenanceToken,
  createFieldSlotAliases,
  createMutationProvenanceBatch,
} from '../src/editor/agent/persistence/provenance.mjs'

const authority = Object.freeze({
  projectId: 'project-lineage',
  branchId: 'main',
  callId: 'call-7',
})

const preparedHash = `sha256:${'1'.repeat(64)}`
const transactionFingerprint = `sha256:${'2'.repeat(64)}`

const receiptIntentInput = () => ({
  schemaVersion: 1,
  ...authority,
  preparedHash,
  baseRevision: 'core:12:registry:3',
  preImages: [{ slot: 'title', existed: true, value: 'A' }],
  expectedPostImages: [{ slot: 'title', existed: true, value: 'B' }],
  status: 'pending',
})

const createAppliedLineage = () => {
  const draftGeneration = 9
  const token = createAgentProvenanceToken(authority.callId)
  const slotKeys = createFieldSlotAliases({
    projectId: authority.projectId,
    branchId: authority.branchId,
    nodeId: 'title-1',
    root: 'props',
    path: ['style', 'color'],
  })
  const provenance = createMutationProvenanceBatch({
    projectId: authority.projectId,
    branchId: authority.branchId,
    draftGeneration,
    slotKeys,
    source: 'agent',
    callId: authority.callId,
  })
  const applyWitness = createApplyWitness({
    schemaVersion: 1,
    ...authority,
    draftGeneration,
    coreMutationVersion: 18,
    transactionFingerprint,
    affectedSlotTokens: provenance.map(({ slotKey, token: provenanceToken }) => ({
      slotKey,
      token: provenanceToken,
    })),
  })
  const receipt = createToolReceipt({
    schemaVersion: 1,
    ...authority,
    status: 'applied',
    revision: 'core:18:registry:3',
    witness: createToolReceiptWitness(applyWitness),
  })
  return { applyWitness, draftGeneration, provenance, receipt, token }
}

test('receipt intent, receipt, and witnesses are strict structured-clone-safe DTOs', () => {
  const mutableIntent = receiptIntentInput()
  const intent = createReceiptIntent(mutableIntent)
  mutableIntent.preImages[0].value = 'mutated-after-build'

  assert.deepEqual(intent, receiptIntentInput())
  assert.notEqual(intent.preImages, mutableIntent.preImages)
  assert.deepEqual(structuredClone(intent), intent)
  assert.deepEqual(parseReceiptIntent(structuredClone(intent)), intent)

  const { applyWitness, receipt } = createAppliedLineage()
  assert.deepEqual(structuredClone(applyWitness), applyWitness)
  assert.deepEqual(structuredClone(receipt), receipt)
  assert.deepEqual(parseApplyWitness(structuredClone(applyWitness)), applyWitness)
  assert.deepEqual(parseToolReceipt(structuredClone(receipt)), receipt)
  assert.throws(
    () =>
      createToolReceipt({
        ...receipt,
        failure: { code: 'IMPOSSIBLE', message: 'applied receipts cannot fail', retryable: false },
      }),
    PersistenceLineageContractError,
  )

  const failureWitness = createFailureWitness({
    schemaVersion: 1,
    ...authority,
    draftGeneration: 10,
    transactionFingerprint: `sha256:${'3'.repeat(64)}`,
    receiptStatus: 'not-applied',
    failureCode: 'VALIDATION_FAILED',
  })
  assert.deepEqual(parseFailureWitness(structuredClone(failureWitness)), failureWitness)
  assert.deepEqual(structuredClone(createToolReceiptWitness(failureWitness)), createToolReceiptWitness(failureWitness))
  assert.throws(
    () =>
      createToolReceipt({
        schemaVersion: 1,
        ...authority,
        status: 'not-applied',
        witness: createToolReceiptWitness(failureWitness),
      }),
    PersistenceLineageContractError,
  )
})

test('lineage DTO validators reject accessors, non-JSON values, unknown fields, and malformed identities', () => {
  let getterReads = 0
  const accessorIntent = receiptIntentInput()
  Object.defineProperty(accessorIntent, 'preparedHash', {
    enumerable: true,
    get() {
      getterReads += 1
      return preparedHash
    },
  })

  for (const invalid of [
    accessorIntent,
    { ...receiptIntentInput(), extra: true },
    { ...receiptIntentInput(), preparedHash: 'sha256:not-a-digest' },
    { ...receiptIntentInput(), projectId: '' },
    { ...receiptIntentInput(), preImages: [{ value: undefined }] },
    { ...receiptIntentInput(), expectedPostImages: [Number.POSITIVE_INFINITY] },
  ]) {
    assert.throws(
      () => parseReceiptIntent(invalid),
      error => error instanceof PersistenceLineageContractError && error.code === 'INVALID_LINEAGE_DTO',
    )
  }
  assert.equal(getterReads, 0)

  const cyclic = receiptIntentInput()
  cyclic.preImages.push(cyclic.preImages)
  assert.throws(() => parseReceiptIntent(cyclic), PersistenceLineageContractError)

  const { applyWitness, receipt } = createAppliedLineage()
  assert.throws(() => parseApplyWitness({ ...applyWitness, draftGeneration: -1 }), PersistenceLineageContractError)
  assert.throws(() => parseApplyWitness({ ...applyWitness, coreMutationVersion: 1.5 }), PersistenceLineageContractError)
  assert.throws(() => parseToolReceipt({ ...receipt, status: 'committed' }), PersistenceLineageContractError)
})

test('ACK-loss recovery returns the original applied receipt only with exact durable lineage', () => {
  const lineage = createAppliedLineage()
  const recovered = classifyReceiptRecovery({
    ...authority,
    receiptIntent: createReceiptIntent(receiptIntentInput()),
    receipt: lineage.receipt,
    applyWitness: lineage.applyWitness,
    failureWitness: null,
  })

  assert.deepEqual(recovered, {
    classification: 'committed',
    receiptIntent: createReceiptIntent(receiptIntentInput()),
    receipt: lineage.receipt,
  })
  assert.notEqual(recovered.receipt, lineage.receipt)
  assert.deepEqual(structuredClone(recovered), recovered)
})

test('intent-only and value equality never synthesize committed or failed authorship', () => {
  const intent = createReceiptIntent(receiptIntentInput())
  const result = classifyReceiptRecovery({
    ...authority,
    receiptIntent: intent,
    receipt: null,
    applyWitness: null,
    failureWitness: null,
  })

  assert.deepEqual(result, {
    classification: 'indeterminate',
    reason: 'missing-durable-receipt',
  })
  assert.equal(intent.expectedPostImages[0].value, 'B')
})

test('a completely absent durable lineage is missing rather than an ambiguous intent', () => {
  assert.deepEqual(
    classifyReceiptRecovery({
      ...authority,
      receiptIntent: null,
      receipt: null,
      applyWitness: null,
      failureWitness: null,
    }),
    { classification: 'missing' },
  )
})

test('a terminal receipt can never recover without its immutable receipt intent', () => {
  const lineage = createAppliedLineage()
  assert.deepEqual(
    classifyReceiptRecovery({
      ...authority,
      receiptIntent: null,
      receipt: lineage.receipt,
      applyWitness: lineage.applyWitness,
      failureWitness: null,
    }),
    { classification: 'indeterminate', reason: 'missing-receipt-intent' },
  )
})

test('missing, ambiguous, or mismatched immutable apply evidence is indeterminate', () => {
  const lineage = createAppliedLineage()
  const base = {
    ...authority,
    receiptIntent: createReceiptIntent(receiptIntentInput()),
    receipt: lineage.receipt,
    applyWitness: lineage.applyWitness,
    failureWitness: null,
  }

  const mismatchedReceipt = createToolReceipt({
    ...lineage.receipt,
    witness: {
      ...lineage.receipt.witness,
      transactionFingerprint: `sha256:${'f'.repeat(64)}`,
    },
  })
  const wrongAuthorityWitness = createApplyWitness({
    ...lineage.applyWitness,
    callId: 'call-other',
    affectedSlotTokens: lineage.applyWitness.affectedSlotTokens.map(entry => ({
      ...entry,
      token: 'agent:call-other',
    })),
  })
  const cases = [
    [{ ...base, applyWitness: null }, 'missing-apply-witness'],
    [{ ...base, receipt: mismatchedReceipt }, 'witness-mismatch'],
    [{ ...base, applyWitness: wrongAuthorityWitness }, 'authority-mismatch'],
    [
      {
        ...base,
        failureWitness: createFailureWitness({
          schemaVersion: 1,
          ...authority,
          draftGeneration: lineage.draftGeneration,
          transactionFingerprint: `sha256:${'3'.repeat(64)}`,
          receiptStatus: 'not-applied',
          failureCode: 'VALIDATION_FAILED',
        }),
      },
      'ambiguous-witnesses',
    ],
  ]

  for (const [input, reason] of cases) {
    assert.deepEqual(classifyReceiptRecovery(input), {
      classification: 'indeterminate',
      reason,
    })
  }
})

test('an exact FailureWitness returns the original failed receipt and any mismatch stays indeterminate', () => {
  const draftGeneration = 10
  const failureFingerprint = `sha256:${'3'.repeat(64)}`
  const failureWitness = createFailureWitness({
    schemaVersion: 1,
    ...authority,
    draftGeneration,
    transactionFingerprint: failureFingerprint,
    receiptStatus: 'not-applied',
    failureCode: 'VALIDATION_FAILED',
  })
  const receipt = createToolReceipt({
    schemaVersion: 1,
    ...authority,
    status: 'not-applied',
    revision: 'core:19:registry:3',
    witness: createToolReceiptWitness(failureWitness),
    failure: { code: 'VALIDATION_FAILED', message: 'validation failed', retryable: false },
  })
  const base = {
    ...authority,
    receiptIntent: createReceiptIntent(receiptIntentInput()),
    receipt,
    applyWitness: null,
    failureWitness,
  }

  assert.deepEqual(classifyReceiptRecovery(base), {
    classification: 'failed',
    receiptIntent: createReceiptIntent(receiptIntentInput()),
    receipt,
  })
  assert.deepEqual(
    classifyReceiptRecovery({ ...base, failureWitness: { ...failureWitness, failureCode: 'TRANSACTION_ABORTED' } }),
    { classification: 'indeterminate', reason: 'failure-code-mismatch' },
  )
  assert.deepEqual(
    classifyReceiptRecovery({
      ...base,
      receipt: {
        ...receipt,
        failure: { ...receipt.failure, code: 'TRANSACTION_ABORTED' },
      },
    }),
    { classification: 'indeterminate', reason: 'failure-code-mismatch' },
  )
  assert.deepEqual(classifyReceiptRecovery({ ...base, applyWitness: createAppliedLineage().applyWitness }), {
    classification: 'indeterminate',
    reason: 'ambiguous-witnesses',
  })
})

test('Phase 5 lineage publishes data declarations through the approved semantic Screen write path', () => {
  const available = DASHBOARD_CAPABILITY_DESCRIPTORS.filter(descriptor => descriptor.availability === 'available').map(
    descriptor => descriptor.capability,
  )
  assert.deepEqual(available, [
    'data.bind',
    'data.inspect',
    'data.preview',
    'data.upsert',
    'material.describe',
    'material.search',
    'screen.applyChangeSet',
    'screen.inspect',
    'task.compensate',
  ])

  for (const capability of ['artifact.createOnline', 'project.checkpoint']) {
    const descriptor = DASHBOARD_CAPABILITY_DESCRIPTORS.find(candidate => candidate.capability === capability)
    assert.equal(descriptor?.availability, 'unavailable')
    assert.equal(descriptor?.unavailableReason, DASHBOARD_FUTURE_CAPABILITY_UNAVAILABLE_REASON)
  }
})
