import { canonicalJsonStringify } from './canonical-json.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'
import { DASHBOARD_STORAGE_STORES } from './schema.mjs'

export const DASHBOARD_DRAFT_COMMIT_KINDS = Object.freeze([
  'migration',
  'autosave',
  'manual-save',
  'agent-batch',
  'version-restore',
])

export const MEMORY_STORAGE_FAULT_PHASES = Object.freeze([
  'before-cas',
  'after-cas',
  'after-operation',
  'before-commit',
])

export const DASHBOARD_MIGRATION_SOURCES = Object.freeze([
  'projectSchema',
  'page-fragments',
  'legacy-local-storage',
  'indexeddb',
  'unknown',
])

const batchFields = Object.freeze([
  'branchId',
  'batchId',
  'draft',
  'expectedDraftGeneration',
  'operations',
  'projectId',
  'schemaVersion',
])
const draftFields = Object.freeze([
  'activeDocument',
  'branchId',
  'commitKind',
  'draftGeneration',
  'projectHash',
  'projectId',
  'projectSchema',
  'schemaVersion',
  'updatedAt',
])
const activeDocumentFields = Object.freeze(['documentId', 'fileName', 'index'])
const migrationStateFields = Object.freeze([
  'branchId',
  'diagnostics',
  'projectId',
  'schemaVersion',
  'source',
  'sourceDraftGeneration',
  'status',
  'targetGeneration',
  'updatedAt',
])
const agentPersistenceReadFields = Object.freeze([
  'branchId',
  'expectedPersistenceGeneration',
  'projectId',
  'schemaVersion',
  'sessionId',
])
const agentPersistenceBatchFields = Object.freeze([
  'batchId',
  'branchId',
  'expectedPersistenceGeneration',
  'projectId',
  'records',
  'schemaVersion',
  'sessionId',
])
const agentPersistenceRecordFields = Object.freeze(['kind', 'recordId', 'value'])
const receiptIntentFields = Object.freeze([
  'baseRevision',
  'branchId',
  'callId',
  'expectedPostImages',
  'preImages',
  'preparedHash',
  'projectId',
  'schemaVersion',
  'status',
])
const receiptLineageReadFields = Object.freeze(['branchId', 'callId', 'projectId'])

const failure = (reason, details = {}) =>
  new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.validationFailed, reason, details)

const isPlainObject = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertPlainObject = (value, label) => {
  if (!isPlainObject(value)) throw failure(`${label}-must-be-a-json-object`)
}

const assertExactFields = (value, fields, label) => {
  assertPlainObject(value, label)
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw failure(`${label}-fields-must-match-contract`)
  }
}

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) throw failure(`${label}-must-be-a-non-empty-string`)
  return value
}

const requireGeneration = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw failure(`${label}-must-be-a-non-negative-safe-integer`)
  return value
}

const requireKeyPart = (value, label) => {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw failure(`${label}-must-be-an-indexeddb-key-part`)
}

export const requireStorageStore = store => {
  if (typeof store !== 'string' || !Object.hasOwn(DASHBOARD_STORAGE_STORES, store)) {
    throw failure('unknown-storage-store', { store: typeof store === 'string' ? store : '' })
  }
  return store
}

const keyPathParts = store => {
  const keyPath = DASHBOARD_STORAGE_STORES[store].keyPath
  return Array.isArray(keyPath) ? keyPath : [keyPath]
}

export const normalizeStorageKey = (storeValue, key) => {
  const store = requireStorageStore(storeValue)
  const parts = keyPathParts(store)
  if (parts.length === 1) {
    return requireKeyPart(key, `${store}-key`)
  }
  if (!Array.isArray(key) || key.length !== parts.length) {
    throw failure(`${store}-key-must-match-key-path`)
  }
  return key.map((part, index) => requireKeyPart(part, `${store}-key-${parts[index]}`))
}

export const extractStorageRecordKey = (storeValue, value) => {
  const store = requireStorageStore(storeValue)
  assertPlainObject(value, `${store}-record`)
  const parts = keyPathParts(store)
  const key = parts.map(part => requireKeyPart(value[part], `${store}.${part}`))
  return parts.length === 1 ? key[0] : key
}

export const encodeStorageKey = key => canonicalJsonStringify(key)

const normalizeActiveDocument = value => {
  if (value === null) return null
  assertExactFields(value, activeDocumentFields, 'active-document')
  return {
    documentId: requireNonEmptyString(value.documentId, 'active-document.documentId'),
    fileName: requireNonEmptyString(value.fileName, 'active-document.fileName'),
    index: requireGeneration(value.index, 'active-document.index'),
  }
}

const normalizeDraft = (value, projectId, branchId, expectedDraftGeneration) => {
  assertExactFields(value, draftFields, 'canonical-working-draft')
  if (value.schemaVersion !== 1) throw failure('canonical-working-draft-schema-version-is-unsupported')
  if (value.projectId !== projectId || value.branchId !== branchId) {
    throw failure('canonical-working-draft-authority-mismatch')
  }
  if (!DASHBOARD_DRAFT_COMMIT_KINDS.includes(value.commitKind)) {
    throw failure('canonical-working-draft-commit-kind-is-unsupported')
  }
  if (
    (value.commitKind === 'migration' && value.draftGeneration <= expectedDraftGeneration) ||
    (value.commitKind !== 'migration' && value.draftGeneration !== expectedDraftGeneration + 1)
  ) {
    throw failure(
      value.commitKind === 'migration'
        ? 'canonical-migration-draft-generation-must-advance'
        : 'canonical-working-draft-generation-must-advance-once',
    )
  }
  assertPlainObject(value.projectSchema, 'canonical-working-draft.projectSchema')
  if (typeof value.projectHash !== 'string' || !/^sha256:[\da-f]{64}$/u.test(value.projectHash)) {
    throw failure('canonical-working-draft-project-hash-is-invalid')
  }
  return {
    schemaVersion: 1,
    projectId,
    branchId,
    draftGeneration: value.draftGeneration,
    activeDocument: normalizeActiveDocument(value.activeDocument),
    projectSchema: value.projectSchema,
    projectHash: value.projectHash,
    commitKind: value.commitKind,
    updatedAt: requireGeneration(value.updatedAt, 'canonical-working-draft.updatedAt'),
  }
}

const assertOperationAuthority = (value, projectId, branchId, store) => {
  if (Object.hasOwn(value, 'projectId') && value.projectId !== projectId) {
    throw failure(`${store}-record-project-authority-mismatch`)
  }
  if (Object.hasOwn(value, 'branchId') && value.branchId !== branchId) {
    throw failure(`${store}-record-branch-authority-mismatch`)
  }
}

const assertOperationKeyAuthority = (key, projectId, branchId, store) => {
  const parts = keyPathParts(store)
  const values = parts.length === 1 ? [key] : key
  const projectIndex = parts.indexOf('projectId')
  if (projectIndex < 0 || values[projectIndex] !== projectId) {
    throw failure(`${store}-key-project-authority-mismatch`)
  }
  const branchIndex = parts.indexOf('branchId')
  if (branchIndex >= 0 && values[branchIndex] !== branchId) {
    throw failure(`${store}-key-branch-authority-mismatch`)
  }
}

const normalizeOperation = (operation, projectId, branchId) => {
  assertPlainObject(operation, 'storage-operation')
  const store = requireStorageStore(operation.store)
  if (store === 'workingDrafts') throw failure('working-draft-is-coordinator-controlled')
  if (operation.type === 'invalidate-agent-provenance') {
    assertExactFields(operation, ['store', 'type'], 'storage-invalidate-agent-provenance-operation')
    if (store !== 'mutationProvenance') {
      throw failure('storage-invalidate-agent-provenance-operation-store-is-unsupported')
    }
    return { type: 'invalidate-agent-provenance', store }
  }
  if (operation.type === 'put') {
    const expectedFields =
      operation.mode === undefined ? ['store', 'type', 'value'] : ['mode', 'store', 'type', 'value']
    assertExactFields(operation, expectedFields, 'storage-put-operation')
    if (operation.mode !== undefined && operation.mode !== 'put' && operation.mode !== 'add') {
      throw failure('storage-put-operation-mode-is-unsupported')
    }
    extractStorageRecordKey(store, operation.value)
    assertOperationAuthority(operation.value, projectId, branchId, store)
    return { type: 'put', store, value: operation.value, mode: operation.mode ?? 'put' }
  }
  if (operation.type === 'delete') {
    assertExactFields(operation, ['key', 'store', 'type'], 'storage-delete-operation')
    const key = normalizeStorageKey(store, operation.key)
    assertOperationKeyAuthority(key, projectId, branchId, store)
    return { type: 'delete', store, key }
  }
  throw failure('storage-operation-type-is-unsupported')
}

export const validateMigrationStateRecord = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, migrationStateFields, 'migration-state-record')
  if (value.schemaVersion !== 1) throw failure('migration-state-schema-version-is-unsupported')
  const projectId = requireNonEmptyString(value.projectId, 'migration-state.projectId')
  const branchId = requireNonEmptyString(value.branchId, 'migration-state.branchId')
  if (!DASHBOARD_MIGRATION_SOURCES.includes(value.source)) {
    throw failure('migration-state.source-is-unsupported')
  }
  if (value.status !== 'draft-committed' && value.status !== 'failed') {
    throw failure('migration-state.status-is-unsupported')
  }
  const sourceDraftGeneration = requireGeneration(value.sourceDraftGeneration, 'migration-state.sourceDraftGeneration')
  if (!Array.isArray(value.diagnostics)) throw failure('migration-state.diagnostics-must-be-an-array')
  for (const diagnostic of value.diagnostics) assertPlainObject(diagnostic, 'migration-state.diagnostic')
  if (value.status === 'failed' && value.targetGeneration !== null) {
    throw failure('failed-migration-state-target-generation-must-be-null')
  }
  if (
    value.status === 'draft-committed' &&
    (!Number.isSafeInteger(value.targetGeneration) || value.targetGeneration <= sourceDraftGeneration)
  ) {
    throw failure('committed-migration-state-target-generation-must-advance')
  }
  return structuredClone({
    schemaVersion: 1,
    projectId,
    branchId,
    status: value.status,
    source: value.source,
    sourceDraftGeneration,
    targetGeneration: value.targetGeneration,
    diagnostics: value.diagnostics,
    updatedAt: requireGeneration(value.updatedAt, 'migration-state.updatedAt'),
  })
}

export const validateAgentPersistenceReadRequest = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, agentPersistenceReadFields, 'agent-persistence-read')
  if (value.schemaVersion !== 1) throw failure('agent-persistence-read-schema-version-is-unsupported')
  return structuredClone({
    schemaVersion: 1,
    projectId: requireNonEmptyString(value.projectId, 'agent-persistence-read.projectId'),
    branchId: requireNonEmptyString(value.branchId, 'agent-persistence-read.branchId'),
    sessionId: requireNonEmptyString(value.sessionId, 'agent-persistence-read.sessionId'),
    expectedPersistenceGeneration: requireGeneration(
      value.expectedPersistenceGeneration,
      'agent-persistence-read.expectedPersistenceGeneration',
    ),
  })
}

export const validateAgentPersistenceBatch = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, agentPersistenceBatchFields, 'agent-persistence-batch')
  if (value.schemaVersion !== 1) throw failure('agent-persistence-batch-schema-version-is-unsupported')
  if (!Array.isArray(value.records)) throw failure('agent-persistence-batch.records-must-be-an-array')
  const recordIds = new Set()
  const records = value.records.map(record => {
    assertExactFields(record, agentPersistenceRecordFields, 'agent-persistence-record')
    const recordId = requireNonEmptyString(record.recordId, 'agent-persistence-record.recordId')
    if (recordIds.has(recordId)) throw failure('agent-persistence-record-ids-must-be-unique')
    recordIds.add(recordId)
    return {
      recordId,
      kind: requireNonEmptyString(record.kind, 'agent-persistence-record.kind'),
      value: record.value,
    }
  })
  return structuredClone({
    schemaVersion: 1,
    projectId: requireNonEmptyString(value.projectId, 'agent-persistence-batch.projectId'),
    branchId: requireNonEmptyString(value.branchId, 'agent-persistence-batch.branchId'),
    sessionId: requireNonEmptyString(value.sessionId, 'agent-persistence-batch.sessionId'),
    batchId: requireNonEmptyString(value.batchId, 'agent-persistence-batch.batchId'),
    expectedPersistenceGeneration: requireGeneration(
      value.expectedPersistenceGeneration,
      'agent-persistence-batch.expectedPersistenceGeneration',
    ),
    records,
  })
}

export const createAgentPersistenceCheckpointId = value =>
  `agent-persistence-v1:${encodeURIComponent(value.sessionId)}:${encodeURIComponent(value.batchId)}`

export const validateReceiptIntentRecord = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, receiptIntentFields, 'receipt-intent')
  if (value.schemaVersion !== 1) throw failure('receipt-intent-schema-version-is-unsupported')
  if (value.status !== 'pending') throw failure('receipt-intent-status-must-be-pending')
  if (typeof value.preparedHash !== 'string' || !/^sha256:[\da-f]{64}$/u.test(value.preparedHash)) {
    throw failure('receipt-intent-prepared-hash-is-invalid')
  }
  return structuredClone({
    schemaVersion: 1,
    projectId: requireNonEmptyString(value.projectId, 'receipt-intent.projectId'),
    branchId: requireNonEmptyString(value.branchId, 'receipt-intent.branchId'),
    callId: requireNonEmptyString(value.callId, 'receipt-intent.callId'),
    preparedHash: value.preparedHash,
    baseRevision: requireNonEmptyString(value.baseRevision, 'receipt-intent.baseRevision'),
    preImages: value.preImages,
    expectedPostImages: value.expectedPostImages,
    status: 'pending',
  })
}

export const validateReceiptLineageReadRequest = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, receiptLineageReadFields, 'receipt-lineage-read')
  return structuredClone({
    projectId: requireNonEmptyString(value.projectId, 'receipt-lineage-read.projectId'),
    branchId: requireNonEmptyString(value.branchId, 'receipt-lineage-read.branchId'),
    callId: requireNonEmptyString(value.callId, 'receipt-lineage-read.callId'),
  })
}

export const validateDurableProjectBatch = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, batchFields, 'durable-project-batch')
  if (value.schemaVersion !== 1) throw failure('durable-project-batch-schema-version-is-unsupported')
  const projectId = requireNonEmptyString(value.projectId, 'durable-project-batch.projectId')
  const branchId = requireNonEmptyString(value.branchId, 'durable-project-batch.branchId')
  const expectedDraftGeneration = requireGeneration(
    value.expectedDraftGeneration,
    'durable-project-batch.expectedDraftGeneration',
  )
  if (!Array.isArray(value.operations)) throw failure('durable-project-batch.operations-must-be-an-array')

  const normalized = {
    schemaVersion: 1,
    batchId: requireNonEmptyString(value.batchId, 'durable-project-batch.batchId'),
    projectId,
    branchId,
    expectedDraftGeneration,
    draft: normalizeDraft(value.draft, projectId, branchId, expectedDraftGeneration),
    operations: value.operations.map(operation => normalizeOperation(operation, projectId, branchId)),
  }
  return structuredClone(normalized)
}
