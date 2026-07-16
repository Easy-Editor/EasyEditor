import {
  assertExactRecord,
  cloneJsonObject,
  cloneJsonValue,
  compareCodeUnits,
  failContract,
  freezeDto,
  jsonDataEqual,
  optionalOwnDataValue,
  ownDataValue,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireSchemaVersion,
} from './contract.mjs'
import { parseMutationProvenance } from './provenance.mjs'
import {
  classifyReceiptRecovery,
  createReceiptIntent,
  createToolReceiptWitness,
  parseApplyWitness,
  parseFailureWitness,
  parseToolReceipt,
} from './receipt-ledger.mjs'

const requireCoordinatorMethod = (coordinator, method) => {
  if (!coordinator || typeof coordinator[method] !== 'function') {
    return failContract(`coordinator-${method}-is-required`, 'DurableAgentCommit')
  }
  return coordinator[method].bind(coordinator)
}

export const recordDurableAgentIntent = async value => {
  assertExactRecord(value, ['coordinator', 'intent'], [], 'DurableAgentIntentWrite')
  const coordinator = ownDataValue(value, 'coordinator', 'DurableAgentIntentWrite')
  const parsedIntent = createReceiptIntent(ownDataValue(value, 'intent', 'DurableAgentIntentWrite'))
  const stored = createReceiptIntent(await requireCoordinatorMethod(coordinator, 'recordReceiptIntent')(parsedIntent))
  if (!jsonDataEqual(stored, parsedIntent)) {
    return failContract('coordinator-returned-different-receipt-intent', 'ReceiptIntent')
  }
  return stored
}

const requireAuthority = (value, label) => ({
  projectId: requireNonEmptyString(ownDataValue(value, 'projectId', label), `${label}.projectId`),
  branchId: requireNonEmptyString(ownDataValue(value, 'branchId', label), `${label}.branchId`),
  callId: requireNonEmptyString(ownDataValue(value, 'callId', label), `${label}.callId`),
})

const authorityMatches = (value, authority) =>
  value.projectId === authority.projectId && value.branchId === authority.branchId && value.callId === authority.callId

const requireAuthorityMatch = (value, authority, label) => {
  if (!authorityMatches(value, authority)) return failContract('authority-mismatch', label)
  return value
}

const parseActiveDocument = value => {
  if (value === null) return null
  assertExactRecord(value, ['documentId', 'fileName', 'index'], [], 'DurableAgentBatch.activeDocument')
  return freezeDto({
    documentId: requireNonEmptyString(
      ownDataValue(value, 'documentId', 'DurableAgentBatch.activeDocument'),
      'DurableAgentBatch.activeDocument.documentId',
    ),
    fileName: requireNonEmptyString(
      ownDataValue(value, 'fileName', 'DurableAgentBatch.activeDocument'),
      'DurableAgentBatch.activeDocument.fileName',
    ),
    index: requireNonNegativeInteger(
      ownDataValue(value, 'index', 'DurableAgentBatch.activeDocument'),
      'DurableAgentBatch.activeDocument.index',
    ),
  })
}

const parseJournal = value => {
  assertExactRecord(value, ['recordId', 'kind', 'value'], [], 'DurableAgentBatch.journal')
  return freezeDto({
    recordId: requireNonEmptyString(
      ownDataValue(value, 'recordId', 'DurableAgentBatch.journal'),
      'DurableAgentBatch.journal.recordId',
    ),
    kind: requireNonEmptyString(
      ownDataValue(value, 'kind', 'DurableAgentBatch.journal'),
      'DurableAgentBatch.journal.kind',
    ),
    value: cloneJsonValue(ownDataValue(value, 'value', 'DurableAgentBatch.journal'), 'DurableAgentBatch.journal.value'),
  })
}

const parseCheckpoint = value => {
  assertExactRecord(value, ['checkpointId', 'value'], [], 'DurableAgentBatch.checkpoint')
  return freezeDto({
    checkpointId: requireNonEmptyString(
      ownDataValue(value, 'checkpointId', 'DurableAgentBatch.checkpoint'),
      'DurableAgentBatch.checkpoint.checkpointId',
    ),
    value: cloneJsonValue(
      ownDataValue(value, 'value', 'DurableAgentBatch.checkpoint'),
      'DurableAgentBatch.checkpoint.value',
    ),
  })
}

const parseJournalDeletes = (value, journal) => {
  if (value === undefined) return []
  if (!Array.isArray(value)) return failContract('must-be-an-array', 'DurableAgentBatch.journalDeletes')
  const recordIds = cloneJsonValue(value, 'DurableAgentBatch.journalDeletes').map((recordId, index) =>
    requireNonEmptyString(recordId, `DurableAgentBatch.journalDeletes[${index}]`),
  )
  recordIds.sort(compareCodeUnits)
  if (recordIds.some((recordId, index) => index > 0 && recordId === recordIds[index - 1])) {
    return failContract('must-not-contain-duplicate-record-ids', 'DurableAgentBatch.journalDeletes')
  }
  if (recordIds.includes(journal.recordId)) {
    return failContract('must-not-delete-the-written-journal', 'DurableAgentBatch.journalDeletes')
  }
  return recordIds
}

const artifactRefKey = value => [value.ownerType, value.ownerId, value.artifactId, value.sourceRevision].join('\u0000')

const parseArtifactRefs = value => {
  if (value === undefined) return []
  if (!Array.isArray(value)) return failContract('must-be-an-array', 'DurableAgentBatch.artifactRefs')
  const parsed = cloneJsonValue(value, 'DurableAgentBatch.artifactRefs').map((entry, index) => {
    const label = `DurableAgentBatch.artifactRefs[${index}]`
    assertExactRecord(entry, ['ownerType', 'ownerId', 'artifactId', 'sourceRevision'], [], label)
    return {
      ownerType: requireNonEmptyString(ownDataValue(entry, 'ownerType', label), `${label}.ownerType`),
      ownerId: requireNonEmptyString(ownDataValue(entry, 'ownerId', label), `${label}.ownerId`),
      artifactId: requireNonEmptyString(ownDataValue(entry, 'artifactId', label), `${label}.artifactId`),
      sourceRevision: requireNonEmptyString(ownDataValue(entry, 'sourceRevision', label), `${label}.sourceRevision`),
    }
  })
  parsed.sort((left, right) => compareCodeUnits(artifactRefKey(left), artifactRefKey(right)))
  if (parsed.some((entry, index) => index > 0 && artifactRefKey(entry) === artifactRefKey(parsed[index - 1]))) {
    return failContract('must-not-contain-duplicate-refs', 'DurableAgentBatch.artifactRefs')
  }
  return parsed
}

const parseProvenance = (value, authority, draftGeneration) => {
  if (!Array.isArray(value)) return failContract('must-be-an-array', 'DurableAgentBatch.provenance')
  const parsed = cloneJsonValue(value, 'DurableAgentBatch.provenance').map(parseMutationProvenance)
  parsed.sort((left, right) => compareCodeUnits(left.slotKey, right.slotKey))
  for (const [index, record] of parsed.entries()) {
    if (record.projectId !== authority.projectId || record.branchId !== authority.branchId) {
      return failContract('authority-mismatch', `DurableAgentBatch.provenance[${index}]`)
    }
    if (record.draftGeneration !== draftGeneration) {
      return failContract('draft-generation-mismatch', `DurableAgentBatch.provenance[${index}]`)
    }
    if (index > 0 && record.slotKey === parsed[index - 1].slotKey) {
      return failContract('slot-keys-must-be-unique', 'DurableAgentBatch.provenance')
    }
  }
  return parsed
}

const requireExactProvenance = (provenance, witness) => {
  if (provenance.length !== witness.affectedSlotTokens.length) {
    return failContract('must-exactly-match-apply-witness', 'DurableAgentBatch.provenance')
  }
  for (const [index, expected] of witness.affectedSlotTokens.entries()) {
    const actual = provenance[index]
    if (actual.slotKey !== expected.slotKey || actual.token !== expected.token) {
      return failContract('must-exactly-match-apply-witness', `DurableAgentBatch.provenance[${index}]`)
    }
  }
}

const parseDurableAgentBatch = value => {
  assertExactRecord(
    value,
    [
      'schemaVersion',
      'projectId',
      'branchId',
      'callId',
      'expectedDraftGeneration',
      'activeDocument',
      'projectSchema',
      'updatedAt',
      'receiptIntent',
      'receipt',
      'witness',
      'provenance',
      'sessionId',
      'journal',
      'checkpoint',
    ],
    ['artifactRefs', 'journalDeletes'],
    'DurableAgentBatch',
  )
  requireSchemaVersion(ownDataValue(value, 'schemaVersion', 'DurableAgentBatch'), 'DurableAgentBatch.schemaVersion')
  const authority = requireAuthority(value, 'DurableAgentBatch')
  const expectedDraftGeneration = requireNonNegativeInteger(
    ownDataValue(value, 'expectedDraftGeneration', 'DurableAgentBatch'),
    'DurableAgentBatch.expectedDraftGeneration',
  )
  const draftGeneration = expectedDraftGeneration + 1
  if (!Number.isSafeInteger(draftGeneration)) {
    return failContract('next-draft-generation-is-not-safe', 'DurableAgentBatch.expectedDraftGeneration')
  }
  const receiptIntent = requireAuthorityMatch(
    createReceiptIntent(ownDataValue(value, 'receiptIntent', 'DurableAgentBatch')),
    authority,
    'DurableAgentBatch.receiptIntent',
  )
  const receipt = requireAuthorityMatch(
    parseToolReceipt(ownDataValue(value, 'receipt', 'DurableAgentBatch')),
    authority,
    'DurableAgentBatch.receipt',
  )
  if (receipt.revision === undefined) return failContract('revision-is-required', 'DurableAgentBatch.receipt')

  const rawWitness = ownDataValue(value, 'witness', 'DurableAgentBatch')
  const applied = receipt.status === 'applied'
  if (!applied && receipt.status !== 'not-applied' && receipt.status !== 'rejected') {
    return failContract('receipt-is-not-a-durable-outcome', 'DurableAgentBatch.receipt.status')
  }
  const witness = requireAuthorityMatch(
    applied ? parseApplyWitness(rawWitness) : parseFailureWitness(rawWitness),
    authority,
    'DurableAgentBatch.witness',
  )
  if (witness.draftGeneration !== draftGeneration) {
    return failContract('draft-generation-mismatch', 'DurableAgentBatch.witness')
  }
  if (!receipt.witness || !jsonDataEqual(receipt.witness, createToolReceiptWitness(witness))) {
    return failContract('witness-mismatch', 'DurableAgentBatch.receipt.witness')
  }

  const provenance = parseProvenance(ownDataValue(value, 'provenance', 'DurableAgentBatch'), authority, draftGeneration)
  if (applied) requireExactProvenance(provenance, witness)
  else if (provenance.length !== 0)
    return failContract('failure-outcome-must-not-write-agent-provenance', 'DurableAgentBatch.provenance')

  const classification = classifyReceiptRecovery({
    ...authority,
    receiptIntent,
    receipt,
    applyWitness: applied ? witness : null,
    failureWitness: applied ? null : witness,
  })
  const expectedClassification = applied ? 'committed' : 'failed'
  if (classification.classification !== expectedClassification) {
    return failContract(classification.reason ?? 'lineage-is-not-a-durable-outcome', 'DurableAgentBatch')
  }

  const journal = parseJournal(ownDataValue(value, 'journal', 'DurableAgentBatch'))
  return freezeDto({
    ...authority,
    schemaVersion: 1,
    expectedDraftGeneration,
    draftGeneration,
    activeDocument: parseActiveDocument(ownDataValue(value, 'activeDocument', 'DurableAgentBatch')),
    projectSchema: cloneJsonObject(
      ownDataValue(value, 'projectSchema', 'DurableAgentBatch'),
      'DurableAgentBatch.projectSchema',
    ),
    updatedAt: requireNonNegativeInteger(
      ownDataValue(value, 'updatedAt', 'DurableAgentBatch'),
      'DurableAgentBatch.updatedAt',
    ),
    receiptIntent,
    receipt,
    witness,
    provenance,
    outcome: applied ? 'committed' : 'failed',
    sessionId: requireNonEmptyString(
      ownDataValue(value, 'sessionId', 'DurableAgentBatch'),
      'DurableAgentBatch.sessionId',
    ),
    journal,
    journalDeletes: parseJournalDeletes(optionalOwnDataValue(value, 'journalDeletes', 'DurableAgentBatch'), journal),
    checkpoint: parseCheckpoint(ownDataValue(value, 'checkpoint', 'DurableAgentBatch')),
    artifactRefs: parseArtifactRefs(optionalOwnDataValue(value, 'artifactRefs', 'DurableAgentBatch')),
  })
}

const durableBatchId = batch =>
  `agent-batch-v1:${encodeURIComponent(batch.projectId)}:${encodeURIComponent(batch.branchId)}:${encodeURIComponent(batch.callId)}`

const provenanceInvalidatingFailureCodes = new Set(['HUMAN_ACTIVITY', 'STALE_REVISION'])

const parseReceiptLineage = (value, authority) => {
  assertExactRecord(
    value,
    ['projectId', 'branchId', 'callId', 'receiptIntent', 'receipt', 'applyWitness', 'failureWitness', 'provenance'],
    [],
    'ReceiptLineage',
  )
  requireAuthorityMatch(requireAuthority(value, 'ReceiptLineage'), authority, 'ReceiptLineage')
  return freezeDto({
    ...authority,
    receiptIntent: cloneJsonValue(
      ownDataValue(value, 'receiptIntent', 'ReceiptLineage'),
      'ReceiptLineage.receiptIntent',
    ),
    receipt: cloneJsonValue(ownDataValue(value, 'receipt', 'ReceiptLineage'), 'ReceiptLineage.receipt'),
    applyWitness: cloneJsonValue(ownDataValue(value, 'applyWitness', 'ReceiptLineage'), 'ReceiptLineage.applyWitness'),
    failureWitness: cloneJsonValue(
      ownDataValue(value, 'failureWitness', 'ReceiptLineage'),
      'ReceiptLineage.failureWitness',
    ),
    provenance: cloneJsonValue(ownDataValue(value, 'provenance', 'ReceiptLineage'), 'ReceiptLineage.provenance'),
  })
}

const buildOperations = batch => {
  const authority = {
    projectId: batch.projectId,
    branchId: batch.branchId,
    callId: batch.callId,
    draftGeneration: batch.draftGeneration,
  }
  const operations = [
    { type: 'put', store: 'toolReceipts', mode: 'add', value: batch.receipt },
    {
      type: 'put',
      store: batch.outcome === 'committed' ? 'applyWitnesses' : 'failureWitnesses',
      mode: 'add',
      value: batch.witness,
    },
    ...batch.provenance.map(value => ({ type: 'put', store: 'mutationProvenance', value })),
    {
      type: 'put',
      store: 'taskJournals',
      value: {
        schemaVersion: 1,
        projectId: batch.projectId,
        branchId: batch.branchId,
        sessionId: batch.sessionId,
        recordId: batch.journal.recordId,
        kind: batch.journal.kind,
        ...authority,
        value: batch.journal.value,
      },
    },
    ...batch.journalDeletes.map(recordId => ({
      type: 'delete',
      store: 'taskJournals',
      key: [batch.projectId, batch.branchId, batch.sessionId, recordId],
    })),
    {
      type: 'put',
      store: 'agentCheckpoints',
      mode: 'add',
      value: {
        schemaVersion: 1,
        projectId: batch.projectId,
        branchId: batch.branchId,
        checkpointId: batch.checkpoint.checkpointId,
        sessionId: batch.sessionId,
        callId: batch.callId,
        draftGeneration: batch.draftGeneration,
        journalRecordId: batch.journal.recordId,
        outcome: batch.outcome,
        value: batch.checkpoint.value,
      },
    },
    ...batch.artifactRefs.map(ref => ({
      type: 'put',
      store: 'artifactRefs',
      mode: 'add',
      value: {
        schemaVersion: 1,
        projectId: batch.projectId,
        branchId: batch.branchId,
        ...ref,
        callId: batch.callId,
        draftGeneration: batch.draftGeneration,
      },
    })),
  ]
  return operations
}

export const commitDurableAgentBatch = async value => {
  assertExactRecord(value, ['coordinator', 'batch'], [], 'DurableAgentCommit')
  const coordinator = ownDataValue(value, 'coordinator', 'DurableAgentCommit')
  const batch = parseDurableAgentBatch(ownDataValue(value, 'batch', 'DurableAgentCommit'))
  const readLineage = requireCoordinatorMethod(coordinator, 'readReceiptLineage')
  const lineage = parseReceiptLineage(
    await readLineage({
      projectId: batch.projectId,
      branchId: batch.branchId,
      callId: batch.callId,
    }),
    batch,
  )
  if (lineage.receiptIntent === null)
    return failContract('missing-durable-receipt-intent', 'DurableAgentBatch.receiptIntent')
  const storedIntent = createReceiptIntent(lineage.receiptIntent)
  if (!jsonDataEqual(storedIntent, batch.receiptIntent)) {
    return failContract('durable-receipt-intent-mismatch', 'DurableAgentBatch.receiptIntent')
  }

  const forceProvenanceInvalidation =
    batch.outcome === 'failed' && provenanceInvalidatingFailureCodes.has(batch.receipt.failure?.code)
  const result = await requireCoordinatorMethod(
    coordinator,
    'commit',
  )({
    schemaVersion: 1,
    batchId: durableBatchId(batch),
    projectId: batch.projectId,
    branchId: batch.branchId,
    expectedDraftGeneration: batch.expectedDraftGeneration,
    activeDocument: batch.activeDocument,
    projectSchema: batch.projectSchema,
    commitKind: 'agent-batch',
    updatedAt: batch.updatedAt,
    operations: buildOperations(batch),
    ...(forceProvenanceInvalidation ? { forceProvenanceInvalidation: true } : {}),
  })
  if (result?.status !== 'committed' || result?.draft?.draftGeneration !== batch.draftGeneration) {
    return failContract('coordinator-returned-invalid-agent-commit-result', 'DurableAgentBatch')
  }
  return freezeDto({
    schemaVersion: 1,
    status: 'committed',
    receipt: structuredClone(batch.receipt),
    draft: structuredClone(result.draft),
  })
}

export const recoverDurableAgentReceipt = async value => {
  assertExactRecord(value, ['coordinator', 'projectId', 'branchId', 'callId'], [], 'DurableAgentReceiptRecovery')
  const coordinator = ownDataValue(value, 'coordinator', 'DurableAgentReceiptRecovery')
  const authority = requireAuthority(value, 'DurableAgentReceiptRecovery')
  const lineage = parseReceiptLineage(
    await requireCoordinatorMethod(coordinator, 'readReceiptLineage')(authority),
    authority,
  )
  return classifyReceiptRecovery({
    ...authority,
    receiptIntent: lineage.receiptIntent,
    receipt: lineage.receipt,
    applyWitness: lineage.applyWitness,
    failureWitness: lineage.failureWitness,
  })
}
