import { canonicalJsonStringify, hashCanonicalJson } from './canonical-json.mjs'
import {
  createAgentPersistenceCheckpointId,
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
import { advanceAgentSessionPersistenceRecord } from './lifecycle.mjs'
import {
  DASHBOARD_STORAGE_DATABASE_NAME,
  DASHBOARD_STORAGE_DATABASE_VERSION,
  ensureDashboardStorageSchema,
} from './schema.mjs'

const clone = value => (value === undefined ? undefined : structuredClone(value))

const errorName = error => (typeof error?.name === 'string' ? error.name : '')

const mapIndexedDbError = (error, context, details = {}) => {
  if (isDashboardStorageError(error)) return error
  const name = errorName(error)
  if (name === 'QuotaExceededError') {
    return new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.quotaExceeded, `${context}-quota-exceeded`, details, {
      cause: error,
    })
  }
  if (name === 'VersionError') {
    return new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
      `${context}-database-version-is-newer-than-reader`,
      details,
      { cause: error },
    )
  }
  if (name === 'AbortError' || name === 'ConstraintError' || name === 'TransactionInactiveError') {
    return new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.transactionAborted,
      `${context}-transaction-aborted`,
      details,
      { cause: error },
    )
  }
  if (name === 'NotFoundError') {
    return new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.migrationFailed,
      `${context}-required-store-is-missing`,
      details,
      { cause: error },
    )
  }
  return new DashboardStorageError(
    context === 'open'
      ? DASHBOARD_STORAGE_ERROR_CODE.storageUnavailable
      : DASHBOARD_STORAGE_ERROR_CODE.transactionAborted,
    `${context}-indexeddb-operation-failed`,
    { ...details, ...(name ? { errorName: name } : {}) },
    { cause: error },
  )
}

const requestResult = request =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new DOMException('IndexedDB request failed', 'UnknownError'))
  })

const transactionCompletion = transaction =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new DOMException('IndexedDB transaction failed', 'AbortError'))
    transaction.onabort = () =>
      reject(transaction.error ?? new DOMException('IndexedDB transaction aborted', 'AbortError'))
  })

const abortQuietly = transaction => {
  try {
    transaction.abort()
  } catch {
    // The transaction may already have aborted because of the original request failure.
  }
}

export const openDashboardStorageDatabase = indexedDB => {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    return Promise.reject(
      new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.storageUnavailable, 'indexeddb-factory-is-unavailable'),
    )
  }

  return new Promise((resolve, reject) => {
    let request
    let settled = false
    let upgradeFailure = null
    const rejectOnce = error => {
      if (settled) return
      settled = true
      reject(error)
    }
    try {
      request = indexedDB.open(DASHBOARD_STORAGE_DATABASE_NAME, DASHBOARD_STORAGE_DATABASE_VERSION)
    } catch (error) {
      rejectOnce(mapIndexedDbError(error, 'open'))
      return
    }

    request.onupgradeneeded = () => {
      try {
        ensureDashboardStorageSchema(request.result)
      } catch (error) {
        upgradeFailure = error
        abortQuietly(request.transaction)
        rejectOnce(
          new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.migrationFailed,
            'indexeddb-schema-upgrade-failed',
            {},
            { cause: error },
          ),
        )
      }
    }
    request.onblocked = () => {
      rejectOnce(
        new DashboardStorageError(
          DASHBOARD_STORAGE_ERROR_CODE.databaseBlocked,
          'indexeddb-open-is-blocked-by-an-older-connection',
        ),
      )
    }
    request.onerror = () => rejectOnce(mapIndexedDbError(upgradeFailure ?? request.error, 'open'))
    request.onsuccess = () => {
      const database = request.result
      if (settled) {
        database.close()
        return
      }
      settled = true
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

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

const isAgentProvenance = (record, projectId, branchId) =>
  record.projectId === projectId &&
  record.branchId === branchId &&
  typeof record.token === 'string' &&
  record.token.startsWith('agent:') &&
  record.token.length > 'agent:'.length

const invalidatedProvenance = (record, batch) => ({
  schemaVersion: 1,
  projectId: batch.projectId,
  branchId: batch.branchId,
  slotKey: record.slotKey,
  draftGeneration: batch.draft.draftGeneration,
  token: 'unknown',
})

export class IndexedDbDashboardStorageBackend {
  #databasePromise = null
  #disposePromise = null
  #disposed = false
  #crypto
  #indexedDB
  #pending = new Set()

  constructor(options = {}) {
    this.#indexedDB = options.indexedDB ?? globalThis.indexedDB
    this.#crypto = options.crypto
  }

  #assertActive() {
    if (this.#disposed) {
      throw new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.disposed, 'indexeddb-storage-backend-is-disposed')
    }
  }

  #database() {
    this.#databasePromise ??= openDashboardStorageDatabase(this.#indexedDB)
    return this.#databasePromise
  }

  #track(operation) {
    const task = Promise.resolve().then(operation)
    this.#pending.add(task)
    const remove = () => this.#pending.delete(task)
    task.then(remove, remove)
    return task
  }

  async get(storeValue, keyValue) {
    this.#assertActive()
    const store = requireStorageStore(storeValue)
    const key = normalizeStorageKey(store, keyValue)
    return this.#track(async () => {
      const database = await this.#database()
      let transaction
      let completed
      try {
        transaction = database.transaction([store], 'readonly')
        completed = transactionCompletion(transaction)
        const result = await requestResult(transaction.objectStore(store).get(key))
        await completed
        return clone(result)
      } catch (error) {
        if (transaction) abortQuietly(transaction)
        await completed?.catch(() => undefined)
        throw mapIndexedDbError(error, 'read', { store })
      }
    })
  }

  async getAll(storeValue) {
    this.#assertActive()
    const store = requireStorageStore(storeValue)
    return this.#track(async () => {
      const database = await this.#database()
      let transaction
      let completed
      try {
        transaction = database.transaction([store], 'readonly')
        completed = transactionCompletion(transaction)
        const result = await requestResult(transaction.objectStore(store).getAll())
        await completed
        return result.map(clone)
      } catch (error) {
        if (transaction) abortQuietly(transaction)
        await completed?.catch(() => undefined)
        throw mapIndexedDbError(error, 'read-all', { store })
      }
    })
  }

  async commit(value) {
    this.#assertActive()
    const batch = validateDurableProjectBatch(value)
    return this.#track(async () => {
      const database = await this.#database()
      const stores = [...new Set(['workingDrafts', ...batch.operations.map(operation => operation.store)])]
      let transaction
      let completed
      let firstWriteError = null
      try {
        transaction = database.transaction(stores, 'readwrite')
        completed = transactionCompletion(transaction)
        const workingDrafts = transaction.objectStore('workingDrafts')
        const current = await requestResult(workingDrafts.get([batch.projectId, batch.branchId]))
        const actualGeneration = current === undefined ? 0 : current.draftGeneration
        if (!Number.isSafeInteger(actualGeneration) || actualGeneration < 0) {
          abortQuietly(transaction)
          await completed.catch(() => undefined)
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
            'stored-working-draft-generation-is-invalid',
            { projectId: batch.projectId, branchId: batch.branchId },
          )
        }
        if (actualGeneration !== batch.expectedDraftGeneration) {
          abortQuietly(transaction)
          await completed.catch(() => undefined)
          throw generationConflict(batch, actualGeneration)
        }

        const observeWrite = request => {
          request.onerror = () => {
            firstWriteError ??= request.error
          }
        }
        observeWrite(workingDrafts.put(batch.draft))
        for (const operation of batch.operations) {
          const objectStore = transaction.objectStore(operation.store)
          if (operation.type === 'invalidate-agent-provenance') {
            if (
              operation.force === true ||
              batch.draft.commitKind === 'migration' ||
              current?.projectHash !== batch.draft.projectHash
            ) {
              const provenance = await requestResult(objectStore.getAll())
              for (const record of provenance) {
                if (isAgentProvenance(record, batch.projectId, batch.branchId)) {
                  observeWrite(objectStore.put(invalidatedProvenance(record, batch)))
                }
              }
            }
            continue
          }
          let request
          if (operation.type === 'delete') {
            request = objectStore.delete(operation.key)
          } else {
            extractStorageRecordKey(operation.store, operation.value)
            request = operation.mode === 'add' ? objectStore.add(operation.value) : objectStore.put(operation.value)
          }
          observeWrite(request)
        }
        await completed
        return {
          schemaVersion: 1,
          batchId: batch.batchId,
          status: 'committed',
          draftGeneration: batch.draft.draftGeneration,
        }
      } catch (error) {
        if (transaction) abortQuietly(transaction)
        await completed?.catch(() => undefined)
        throw mapIndexedDbError(firstWriteError ?? error, 'commit', {
          projectId: batch.projectId,
          branchId: batch.branchId,
        })
      }
    })
  }

  async putMigrationState(value) {
    this.#assertActive()
    const record = validateMigrationStateRecord(value)
    return this.#track(async () => {
      const database = await this.#database()
      let transaction
      let completed
      let writeError = null
      try {
        transaction = database.transaction(['migrationState'], 'readwrite')
        completed = transactionCompletion(transaction)
        const request = transaction.objectStore('migrationState').put(record)
        request.onerror = () => {
          writeError = request.error
        }
        await completed
        return clone(record)
      } catch (error) {
        if (transaction) abortQuietly(transaction)
        await completed?.catch(() => undefined)
        throw mapIndexedDbError(writeError ?? error, 'migration-state', {
          projectId: record.projectId,
          branchId: record.branchId,
        })
      }
    })
  }

  async readAgentPersistence(value) {
    this.#assertActive()
    const request = validateAgentPersistenceReadRequest(value)
    return this.#track(async () => {
      const database = await this.#database()
      let transaction
      let completed
      try {
        transaction = database.transaction(['agentSessions', 'taskJournals'], 'readonly')
        completed = transactionCompletion(transaction)
        const sessionRequest = requestResult(
          transaction.objectStore('agentSessions').get([request.projectId, request.branchId, request.sessionId]),
        )
        const journalsRequest = requestResult(transaction.objectStore('taskJournals').getAll())
        const [session, allJournals] = await Promise.all([sessionRequest, journalsRequest])
        await completed
        const persistenceGeneration = session?.persistenceGeneration ?? 0
        if (!Number.isSafeInteger(persistenceGeneration) || persistenceGeneration < 0) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
            'stored-agent-session-generation-is-invalid',
          )
        }
        const records = allJournals
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
      } catch (error) {
        if (transaction) abortQuietly(transaction)
        await completed?.catch(() => undefined)
        throw mapIndexedDbError(error, 'agent-persistence-read', {
          projectId: request.projectId,
          branchId: request.branchId,
        })
      }
    })
  }

  async commitAgentPersistence(value) {
    this.#assertActive()
    const batch = validateAgentPersistenceBatch(value)
    const requestHash = await hashCanonicalJson(batch, { crypto: this.#crypto })
    const checkpointId = createAgentPersistenceCheckpointId(batch)
    return this.#track(async () => {
      const database = await this.#database()
      let transaction
      let completed
      let firstWriteError = null
      try {
        transaction = database.transaction(['agentSessions', 'taskJournals', 'agentCheckpoints'], 'readwrite')
        completed = transactionCompletion(transaction)
        const sessions = transaction.objectStore('agentSessions')
        const journals = transaction.objectStore('taskJournals')
        const checkpoints = transaction.objectStore('agentCheckpoints')
        const checkpointRequest = requestResult(checkpoints.get([batch.projectId, batch.branchId, checkpointId]))
        const sessionRequest = requestResult(sessions.get([batch.projectId, batch.branchId, batch.sessionId]))
        const [existingCheckpoint, currentSession] = await Promise.all([checkpointRequest, sessionRequest])
        if (existingCheckpoint) {
          if (
            typeof existingCheckpoint.requestHash !== 'string' ||
            !existingCheckpoint.result ||
            !Number.isSafeInteger(existingCheckpoint.result.persistenceGeneration)
          ) {
            abortQuietly(transaction)
            await completed.catch(() => undefined)
            throw new DashboardStorageError(
              DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
              'stored-agent-persistence-checkpoint-is-invalid',
            )
          }
          await completed
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

        const currentGeneration = currentSession?.persistenceGeneration ?? 0
        if (!Number.isSafeInteger(currentGeneration) || currentGeneration < 0) {
          abortQuietly(transaction)
          await completed.catch(() => undefined)
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
            'stored-agent-session-generation-is-invalid',
          )
        }
        const committed = currentGeneration === batch.expectedPersistenceGeneration
        const result = {
          schemaVersion: 1,
          batchId: batch.batchId,
          status: committed ? 'committed' : 'generation-conflict',
          persistenceGeneration: committed ? currentGeneration + 1 : currentGeneration,
        }
        const observeWrite = writeRequest => {
          writeRequest.onerror = () => {
            firstWriteError ??= writeRequest.error
          }
        }
        if (committed) {
          observeWrite(
            sessions.put(advanceAgentSessionPersistenceRecord(currentSession, batch, result.persistenceGeneration)),
          )
          for (const record of batch.records) {
            observeWrite(
              journals.put({
                schemaVersion: 1,
                projectId: batch.projectId,
                branchId: batch.branchId,
                sessionId: batch.sessionId,
                recordId: record.recordId,
                kind: record.kind,
                value: record.value,
              }),
            )
          }
        }
        observeWrite(
          checkpoints.put({
            schemaVersion: 1,
            projectId: batch.projectId,
            branchId: batch.branchId,
            checkpointId,
            sessionId: batch.sessionId,
            batchId: batch.batchId,
            requestHash,
            result,
          }),
        )
        await completed
        return clone(result)
      } catch (error) {
        if (transaction) abortQuietly(transaction)
        await completed?.catch(() => undefined)
        throw mapIndexedDbError(firstWriteError ?? error, 'agent-persistence-commit', {
          projectId: batch.projectId,
          branchId: batch.branchId,
        })
      }
    })
  }

  async putReceiptIntent(value) {
    this.#assertActive()
    const intent = validateReceiptIntentRecord(value)
    return this.#track(async () => {
      const database = await this.#database()
      let transaction
      let completed
      let writeError = null
      try {
        transaction = database.transaction(['receiptIntents'], 'readwrite')
        completed = transactionCompletion(transaction)
        const store = transaction.objectStore('receiptIntents')
        const existing = await requestResult(store.get([intent.projectId, intent.branchId, intent.callId]))
        if (existing) {
          if (canonicalJsonStringify(existing) !== canonicalJsonStringify(intent)) {
            abortQuietly(transaction)
            await completed.catch(() => undefined)
            throw new DashboardStorageError(
              DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
              'receipt-intent-call-id-was-reused-with-different-bytes',
              { projectId: intent.projectId, branchId: intent.branchId, callId: intent.callId },
            )
          }
          await completed
          return clone(existing)
        }
        const request = store.add(intent)
        request.onerror = () => {
          writeError = request.error
        }
        await completed
        return clone(intent)
      } catch (error) {
        if (transaction) abortQuietly(transaction)
        await completed?.catch(() => undefined)
        throw mapIndexedDbError(writeError ?? error, 'receipt-intent', {
          projectId: intent.projectId,
          branchId: intent.branchId,
        })
      }
    })
  }

  async readReceiptLineage(value) {
    this.#assertActive()
    const request = validateReceiptLineageReadRequest(value)
    return this.#track(async () => {
      const database = await this.#database()
      const stores = ['receiptIntents', 'toolReceipts', 'applyWitnesses', 'failureWitnesses', 'mutationProvenance']
      let transaction
      let completed
      try {
        transaction = database.transaction(stores, 'readonly')
        completed = transactionCompletion(transaction)
        const key = [request.projectId, request.branchId, request.callId]
        const [receiptIntent, receipt, applyWitness, failureWitness, allProvenance] = await Promise.all([
          requestResult(transaction.objectStore('receiptIntents').get(key)),
          requestResult(transaction.objectStore('toolReceipts').get(key)),
          requestResult(transaction.objectStore('applyWitnesses').get(key)),
          requestResult(transaction.objectStore('failureWitnesses').get(key)),
          requestResult(transaction.objectStore('mutationProvenance').getAll()),
        ])
        await completed
        const expectedToken = `agent:${request.callId}`
        const provenance = allProvenance
          .filter(
            record =>
              record.projectId === request.projectId &&
              record.branchId === request.branchId &&
              (record.token === expectedToken || record.callId === request.callId),
          )
          .sort((left, right) => (left.slotKey < right.slotKey ? -1 : left.slotKey > right.slotKey ? 1 : 0))
        return clone({
          projectId: request.projectId,
          branchId: request.branchId,
          callId: request.callId,
          receiptIntent: receiptIntent ?? null,
          receipt: receipt ?? null,
          applyWitness: applyWitness ?? null,
          failureWitness: failureWitness ?? null,
          provenance,
        })
      } catch (error) {
        if (transaction) abortQuietly(transaction)
        await completed?.catch(() => undefined)
        throw mapIndexedDbError(error, 'receipt-lineage-read', {
          projectId: request.projectId,
          branchId: request.branchId,
        })
      }
    })
  }

  async flush() {
    this.#assertActive()
    await Promise.all([...this.#pending])
  }

  async dispose() {
    if (this.#disposePromise) return this.#disposePromise
    this.#disposed = true
    this.#disposePromise = (async () => {
      await Promise.allSettled([...this.#pending])
      if (!this.#databasePromise) return
      const database = await this.#databasePromise.catch(() => null)
      database?.close()
    })()
    return this.#disposePromise
  }
}
