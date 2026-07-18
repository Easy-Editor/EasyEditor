import {
  normalizeArtifactRootFence,
  validateArtifactReadRequest,
  validateArtifactRecord,
  validateArtifactRootReadRequest,
  validateArtifactRootRecord,
  validateArtifactSweepRequest,
} from './artifact-contracts.mjs'
import { canonicalJsonStringify, hashCanonicalJson } from './canonical-json.mjs'
import {
  createAgentPersistenceCheckpointId,
  encodeStorageKey,
  extractStorageRecordKey,
  normalizeStorageKey,
  requireStorageStore,
  validateAgentPersistenceBatch,
  validateAgentPersistenceReadRequest,
  validateDurableProjectBatch,
  validateMigrationStateRecord,
  validateReceiptIntentRecord,
  validateReceiptLineageReadRequest,
} from './contracts.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError, isDashboardStorageError } from './errors.mjs'
import {
  advanceAgentSessionPersistenceRecord,
  normalizeArtifactRootRecord,
  normalizeStoredArtifactIdentity,
} from './lifecycle.mjs'
import { DASHBOARD_MATERIAL_GC_STORE_NAMES, createMaterialGcStoreSnapshot } from './material-gc.mjs'
import { DASHBOARD_STORAGE_STORE_NAMES } from './schema.mjs'

const clone = value => (value === undefined ? undefined : structuredClone(value))

const createEmptyStores = () => new Map(DASHBOARD_STORAGE_STORE_NAMES.map(name => [name, new Map()]))

const generationConflict = (batch, actual) =>
  new DashboardStorageError(
    DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
    'working-draft-generation-does-not-match',
    {
      projectId: batch.projectId,
      branchId: batch.branchId,
      expected: batch.expectedDraftGeneration,
      actual,
    },
  )

const operationKey = operation =>
  operation.type === 'put'
    ? extractStorageRecordKey(operation.store, operation.value)
    : normalizeStorageKey(operation.store, operation.key)

const isAgentProvenance = (record, projectId, branchId) =>
  record.projectId === projectId &&
  record.branchId === branchId &&
  typeof record.token === 'string' &&
  record.token.startsWith('agent:') &&
  record.token.length > 'agent:'.length

const invalidateAgentProvenance = (records, batch, current) => {
  if (
    batch.draft.commitKind !== 'migration' &&
    current?.projectHash === batch.draft.projectHash &&
    batch.operations.every(operation => operation.type !== 'invalidate-agent-provenance' || operation.force !== true)
  )
    return
  for (const [key, record] of records) {
    if (!isAgentProvenance(record, batch.projectId, batch.branchId)) continue
    records.set(key, {
      schemaVersion: 1,
      projectId: batch.projectId,
      branchId: batch.branchId,
      slotKey: record.slotKey,
      draftGeneration: batch.draft.draftGeneration,
      token: 'unknown',
    })
  }
}

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0)
const artifactIdentityKey = value => `${value.artifactId}\u0000${value.sourceRevision}`

const projectArtifactGenerationFence = (records, projectId) =>
  records
    .filter(record => record?.projectId === projectId)
    .map(record => {
      if (
        typeof record.branchId !== 'string' ||
        record.branchId.length === 0 ||
        !Number.isSafeInteger(record.draftGeneration) ||
        record.draftGeneration < 0
      ) {
        throw new DashboardStorageError(
          DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
          'stored-working-draft-generation-is-invalid',
          { projectId },
        )
      }
      return { branchId: record.branchId, draftGeneration: record.draftGeneration }
    })
    .sort((left, right) => compareText(left.branchId, right.branchId))

const projectArtifactIdentityFence = (records, projectId) =>
  records
    .filter(record => record?.projectId === projectId)
    .map(normalizeStoredArtifactIdentity)
    .sort((left, right) => compareText(artifactIdentityKey(left), artifactIdentityKey(right)))

const projectArtifactRootFence = (records, projectId) =>
  normalizeArtifactRootFence(records.filter(record => record?.projectId === projectId).map(normalizeArtifactRootRecord))

const assertArtifactSweepFence = (actual, expected, reason, projectId) => {
  if (canonicalJsonStringify(actual) === canonicalJsonStringify(expected)) return
  throw new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.generationConflict, reason, { projectId })
}

export class MemoryDashboardStorageBackend {
  #crypto
  #disposed = false
  #faultInjector
  #stores = createEmptyStores()

  constructor(options = {}) {
    this.#faultInjector = typeof options.faultInjector === 'function' ? options.faultInjector : null
    this.#crypto = options.crypto
  }

  #assertActive() {
    if (this.#disposed) {
      throw new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.disposed, 'memory-storage-backend-is-disposed')
    }
  }

  #injectFault(event) {
    if (!this.#faultInjector) return
    try {
      this.#faultInjector(Object.freeze({ ...event }))
    } catch (error) {
      if (isDashboardStorageError(error)) throw error
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.transactionAborted,
        'memory-storage-fault-injected',
        { phase: event.phase, operationIndex: event.operationIndex ?? -1 },
        { cause: error },
      )
    }
  }

  async get(storeValue, keyValue) {
    this.#assertActive()
    const store = requireStorageStore(storeValue)
    const key = normalizeStorageKey(store, keyValue)
    return clone(this.#stores.get(store).get(encodeStorageKey(key)))
  }

  async getAll(storeValue) {
    this.#assertActive()
    const store = requireStorageStore(storeValue)
    return [...this.#stores.get(store).values()].map(clone)
  }

  async readMaterialGcStoreSnapshot(projectId) {
    this.#assertActive()
    const stores = this.#stores
    return createMaterialGcStoreSnapshot(
      projectId,
      Object.fromEntries(DASHBOARD_MATERIAL_GC_STORE_NAMES.map(store => [store, [...stores.get(store).values()]])),
    )
  }

  async commit(value) {
    this.#assertActive()
    const batch = validateDurableProjectBatch(value)
    const workingDraftKey = encodeStorageKey([batch.projectId, batch.branchId])
    this.#injectFault({ phase: 'before-cas', batch })

    const current = this.#stores.get('workingDrafts').get(workingDraftKey)
    const actualGeneration = current === undefined ? 0 : current.draftGeneration
    if (!Number.isSafeInteger(actualGeneration) || actualGeneration < 0) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'stored-working-draft-generation-is-invalid',
        { projectId: batch.projectId, branchId: batch.branchId },
      )
    }
    if (actualGeneration !== batch.expectedDraftGeneration) throw generationConflict(batch, actualGeneration)
    this.#injectFault({ phase: 'after-cas', batch })

    const nextStores = new Map([...this.#stores].map(([name, records]) => [name, new Map(records)]))
    nextStores.get('workingDrafts').set(workingDraftKey, clone(batch.draft))
    this.#injectFault({ phase: 'after-operation', operationIndex: -1, batch })

    for (const [operationIndex, operation] of batch.operations.entries()) {
      const records = nextStores.get(operation.store)
      if (operation.type === 'invalidate-agent-provenance') {
        invalidateAgentProvenance(records, batch, current)
        this.#injectFault({ phase: 'after-operation', operationIndex, batch })
        continue
      }
      const key = encodeStorageKey(operationKey(operation))
      if (operation.type === 'delete') {
        records.delete(key)
      } else {
        if (operation.mode === 'add' && records.has(key)) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.transactionAborted,
            'storage-add-record-already-exists',
            { store: operation.store, operationIndex },
          )
        }
        records.set(key, clone(operation.value))
      }
      this.#injectFault({ phase: 'after-operation', operationIndex, batch })
    }

    this.#injectFault({ phase: 'before-commit', batch })
    this.#stores = nextStores
    return {
      schemaVersion: 1,
      batchId: batch.batchId,
      status: 'committed',
      draftGeneration: batch.draft.draftGeneration,
    }
  }

  async putMigrationState(value) {
    this.#assertActive()
    const record = validateMigrationStateRecord(value)
    const nextStores = new Map([...this.#stores].map(([name, records]) => [name, new Map(records)]))
    nextStores.get('migrationState').set(encodeStorageKey([record.projectId, record.branchId]), clone(record))
    this.#stores = nextStores
    return clone(record)
  }

  async readAgentPersistence(value) {
    this.#assertActive()
    const request = validateAgentPersistenceReadRequest(value)
    const session = this.#stores
      .get('agentSessions')
      .get(encodeStorageKey([request.projectId, request.branchId, request.sessionId]))
    const persistenceGeneration = session?.persistenceGeneration ?? 0
    if (!Number.isSafeInteger(persistenceGeneration) || persistenceGeneration < 0) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'stored-agent-session-generation-is-invalid',
      )
    }
    const records = [...this.#stores.get('taskJournals').values()]
      .filter(
        record =>
          record.projectId === request.projectId &&
          record.branchId === request.branchId &&
          record.sessionId === request.sessionId,
      )
      .map(record => ({ recordId: record.recordId, kind: record.kind, value: record.value }))
      .sort((left, right) => (left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0))
    return clone({
      schemaVersion: 1,
      projectId: request.projectId,
      branchId: request.branchId,
      sessionId: request.sessionId,
      persistenceGeneration,
      records,
    })
  }

  async commitAgentPersistence(value) {
    this.#assertActive()
    const batch = validateAgentPersistenceBatch(value)
    const requestHash = await hashCanonicalJson(batch, { crypto: this.#crypto })
    const sessionKey = encodeStorageKey([batch.projectId, batch.branchId, batch.sessionId])
    const checkpointId = createAgentPersistenceCheckpointId(batch)
    const checkpointKey = encodeStorageKey([batch.projectId, batch.branchId, checkpointId])
    const existingCheckpoint = this.#stores.get('agentCheckpoints').get(checkpointKey)
    if (existingCheckpoint) {
      if (existingCheckpoint.requestHash === requestHash) return clone(existingCheckpoint.result)
      return {
        schemaVersion: 1,
        batchId: batch.batchId,
        status: 'rejected',
        persistenceGeneration: existingCheckpoint.result.persistenceGeneration,
        failure: {
          code: 'persistence-batch-id-reused',
          message: 'batchId was reused with a different persistence request',
          retryable: false,
          details: { batchId: batch.batchId },
        },
      }
    }

    const currentSession = this.#stores.get('agentSessions').get(sessionKey)
    const currentGeneration = currentSession?.persistenceGeneration ?? 0
    if (!Number.isSafeInteger(currentGeneration) || currentGeneration < 0) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'stored-agent-session-generation-is-invalid',
      )
    }
    this.#injectFault({ phase: 'before-cas', batch })
    const result = {
      schemaVersion: 1,
      batchId: batch.batchId,
      status: currentGeneration === batch.expectedPersistenceGeneration ? 'committed' : 'generation-conflict',
      persistenceGeneration:
        currentGeneration === batch.expectedPersistenceGeneration ? currentGeneration + 1 : currentGeneration,
    }
    const checkpoint = {
      schemaVersion: 1,
      projectId: batch.projectId,
      branchId: batch.branchId,
      checkpointId,
      sessionId: batch.sessionId,
      batchId: batch.batchId,
      requestHash,
      result,
    }
    const nextStores = new Map([...this.#stores].map(([name, records]) => [name, new Map(records)]))
    this.#injectFault({ phase: 'after-cas', batch })

    if (result.status === 'committed') {
      nextStores
        .get('agentSessions')
        .set(sessionKey, advanceAgentSessionPersistenceRecord(currentSession, batch, result.persistenceGeneration))
      this.#injectFault({ phase: 'after-operation', operationIndex: 0, batch })
      for (const [index, record] of batch.records.entries()) {
        const storedRecord = {
          schemaVersion: 1,
          projectId: batch.projectId,
          branchId: batch.branchId,
          sessionId: batch.sessionId,
          recordId: record.recordId,
          kind: record.kind,
          value: record.value,
        }
        nextStores
          .get('taskJournals')
          .set(
            encodeStorageKey([batch.projectId, batch.branchId, batch.sessionId, record.recordId]),
            clone(storedRecord),
          )
        this.#injectFault({ phase: 'after-operation', operationIndex: index + 1, batch })
      }
    }
    nextStores.get('agentCheckpoints').set(checkpointKey, clone(checkpoint))
    this.#injectFault({ phase: 'after-operation', operationIndex: batch.records.length + 1, batch })
    this.#injectFault({ phase: 'before-commit', batch })
    this.#stores = nextStores
    return clone(result)
  }

  async putReceiptIntent(value) {
    this.#assertActive()
    const intent = validateReceiptIntentRecord(value)
    const key = encodeStorageKey([intent.projectId, intent.branchId, intent.callId])
    const existing = this.#stores.get('receiptIntents').get(key)
    if (existing) {
      if (canonicalJsonStringify(existing) === canonicalJsonStringify(intent)) return clone(existing)
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'receipt-intent-call-id-was-reused-with-different-bytes',
        { projectId: intent.projectId, branchId: intent.branchId, callId: intent.callId },
      )
    }
    const nextStores = new Map([...this.#stores].map(([name, records]) => [name, new Map(records)]))
    nextStores.get('receiptIntents').set(key, clone(intent))
    this.#stores = nextStores
    return clone(intent)
  }

  async readReceiptLineage(value) {
    this.#assertActive()
    const request = validateReceiptLineageReadRequest(value)
    const key = encodeStorageKey([request.projectId, request.branchId, request.callId])
    const get = store => clone(this.#stores.get(store).get(key) ?? null)
    const expectedToken = `agent:${request.callId}`
    const provenance = [...this.#stores.get('mutationProvenance').values()]
      .filter(
        record =>
          record.projectId === request.projectId &&
          record.branchId === request.branchId &&
          (record.token === expectedToken || record.callId === request.callId),
      )
      .sort((left, right) => (left.slotKey < right.slotKey ? -1 : left.slotKey > right.slotKey ? 1 : 0))
      .map(clone)
    return {
      projectId: request.projectId,
      branchId: request.branchId,
      callId: request.callId,
      receiptIntent: get('receiptIntents'),
      receipt: get('toolReceipts'),
      applyWitness: get('applyWitnesses'),
      failureWitness: get('failureWitnesses'),
      provenance,
    }
  }

  async createArtifact(value) {
    this.#assertActive()
    const artifact = validateArtifactRecord(value)
    const key = encodeStorageKey([artifact.projectId, artifact.artifactId, artifact.sourceRevision])
    const existing = this.#stores.get('artifacts').get(key)
    if (existing !== undefined) {
      if (canonicalJsonStringify(existing) !== canonicalJsonStringify(artifact)) {
        throw new DashboardStorageError(
          DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
          'artifact-revision-was-reused-with-different-bytes',
          { projectId: artifact.projectId, artifactId: artifact.artifactId, sourceRevision: artifact.sourceRevision },
        )
      }
      return clone({ schemaVersion: 1, status: 'reconciled', artifact: existing })
    }
    const nextStores = new Map([...this.#stores].map(([name, records]) => [name, new Map(records)]))
    nextStores.get('artifacts').set(key, clone(artifact))
    this.#stores = nextStores
    return clone({ schemaVersion: 1, status: 'created', artifact })
  }

  async readArtifact(value) {
    this.#assertActive()
    const request = validateArtifactReadRequest(value)
    const stored = this.#stores
      .get('artifacts')
      .get(encodeStorageKey([request.projectId, request.artifactId, request.sourceRevision]))
    return stored === undefined ? null : clone(validateArtifactRecord(stored))
  }

  async createArtifactRoot(value) {
    this.#assertActive()
    const root = validateArtifactRootRecord(value)
    const key = encodeStorageKey([
      root.projectId,
      root.branchId,
      root.ownerType,
      root.ownerId,
      root.artifactId,
      root.sourceRevision,
    ])
    const existing = this.#stores.get('artifactRefs').get(key)
    if (existing !== undefined) {
      if (canonicalJsonStringify(existing) !== canonicalJsonStringify(root)) {
        throw new DashboardStorageError(
          DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
          'artifact-root-identity-was-reused-with-different-bytes',
          { projectId: root.projectId, branchId: root.branchId },
        )
      }
      return clone({ schemaVersion: 1, status: 'reconciled', root: existing })
    }
    const nextStores = new Map([...this.#stores].map(([name, records]) => [name, new Map(records)]))
    nextStores.get('artifactRefs').set(key, clone(root))
    this.#stores = nextStores
    return clone({ schemaVersion: 1, status: 'created', root })
  }

  async readArtifactRoot(value) {
    this.#assertActive()
    const request = validateArtifactRootReadRequest(value)
    const stored = this.#stores
      .get('artifactRefs')
      .get(
        encodeStorageKey([
          request.projectId,
          request.branchId,
          request.ownerType,
          request.ownerId,
          request.artifactId,
          request.sourceRevision,
        ]),
      )
    return stored === undefined ? null : clone(validateArtifactRootRecord(stored))
  }

  async deleteArtifactRoot(value) {
    this.#assertActive()
    const root = validateArtifactRootReadRequest(value)
    const key = encodeStorageKey([
      root.projectId,
      root.branchId,
      root.ownerType,
      root.ownerId,
      root.artifactId,
      root.sourceRevision,
    ])
    if (!this.#stores.get('artifactRefs').has(key)) {
      return clone({ schemaVersion: 1, status: 'absent', root })
    }
    const nextStores = new Map([...this.#stores].map(([name, records]) => [name, new Map(records)]))
    nextStores.get('artifactRefs').delete(key)
    this.#stores = nextStores
    return clone({ schemaVersion: 1, status: 'deleted', root })
  }

  async sweepArtifacts(value) {
    this.#assertActive()
    const request = validateArtifactSweepRequest(value)
    const drafts = [...this.#stores.get('workingDrafts').values()]
    const artifacts = [...this.#stores.get('artifacts').values()]
    const roots = [...this.#stores.get('artifactRefs').values()]
    assertArtifactSweepFence(
      projectArtifactGenerationFence(drafts, request.projectId),
      request.generationFence,
      'artifact-gc-working-draft-fence-changed',
      request.projectId,
    )
    assertArtifactSweepFence(
      projectArtifactIdentityFence(artifacts, request.projectId),
      request.artifactIdentityFence,
      'artifact-gc-artifact-fence-changed',
      request.projectId,
    )
    assertArtifactSweepFence(
      projectArtifactRootFence(roots, request.projectId),
      request.rootFence,
      'artifact-gc-root-fence-changed',
      request.projectId,
    )
    const nextStores = new Map([...this.#stores].map(([name, records]) => [name, new Map(records)]))
    for (const artifact of request.deletionCandidates) {
      nextStores
        .get('artifacts')
        .delete(encodeStorageKey([request.projectId, artifact.artifactId, artifact.sourceRevision]))
    }
    this.#stores = nextStores
    return clone({
      schemaVersion: 1,
      status: 'committed',
      projectId: request.projectId,
      deletedArtifacts: request.deletionCandidates,
    })
  }

  async flush() {
    this.#assertActive()
  }

  async dispose() {
    this.#disposed = true
  }
}
