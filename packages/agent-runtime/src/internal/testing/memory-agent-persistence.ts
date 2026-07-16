import type {
  AgentPersistenceBatch,
  AgentPersistencePort,
  PersistenceCommitResult,
  PersistenceReadRequest,
  PersistenceReadResult,
  PersistenceRecord,
} from '../../contracts.js'

interface StoredSession {
  generation: number
  records: readonly PersistenceRecord[]
}

interface StoredBatch {
  readonly fingerprint: string
  readonly result: PersistenceCommitResult
  rejection?: PersistenceCommitResult
}

const keyFor = (value: { projectId: string; branchId: string; sessionId: string }) =>
  `${value.projectId}\u0000${value.branchId}\u0000${value.sessionId}`

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  )
}

const fingerprint = (batch: AgentPersistenceBatch) => JSON.stringify(canonicalize(batch))

const upsertRecords = (
  stored: readonly PersistenceRecord[],
  incoming: readonly PersistenceRecord[],
): readonly PersistenceRecord[] => {
  const records = new Map(stored.map(record => [record.recordId, record]))
  for (const record of incoming) records.set(record.recordId, record)
  return [...records.values()]
}

export class MemoryAgentPersistence implements AgentPersistencePort {
  readonly #sessions = new Map<string, StoredSession>()
  readonly #batches = new Map<string, Map<string, StoredBatch>>()
  readonly commits: AgentPersistenceBatch[] = []

  async read(request: PersistenceReadRequest): Promise<PersistenceReadResult> {
    const stored = this.#sessions.get(keyFor(request)) ?? { generation: 0, records: [] }
    return structuredClone({
      schemaVersion: 1,
      projectId: request.projectId,
      branchId: request.branchId,
      sessionId: request.sessionId,
      persistenceGeneration: stored.generation,
      records: stored.records,
    })
  }

  async commit(batch: AgentPersistenceBatch): Promise<PersistenceCommitResult> {
    const clone = structuredClone(batch)
    const key = keyFor(batch)
    const stored = this.#sessions.get(key) ?? { generation: 0, records: [] }
    const batches = this.#batches.get(key) ?? new Map<string, StoredBatch>()
    const requestFingerprint = fingerprint(clone)
    const previous = batches.get(batch.batchId)
    if (previous) {
      if (previous.fingerprint === requestFingerprint) return structuredClone(previous.result)
      previous.rejection ??= {
        schemaVersion: 1,
        batchId: batch.batchId,
        status: 'rejected',
        persistenceGeneration: previous.result.persistenceGeneration,
        failure: {
          code: 'persistence-batch-id-reused',
          message: 'batchId was reused with a different persistence request',
          retryable: false,
          details: { batchId: batch.batchId },
        },
      }
      return structuredClone(previous.rejection)
    }

    if (stored.generation !== batch.expectedPersistenceGeneration) {
      const result: PersistenceCommitResult = {
        schemaVersion: 1,
        batchId: batch.batchId,
        status: 'generation-conflict',
        persistenceGeneration: stored.generation,
      }
      batches.set(batch.batchId, { fingerprint: requestFingerprint, result })
      this.#batches.set(key, batches)
      return structuredClone(result)
    }
    const next = {
      generation: stored.generation + 1,
      records: upsertRecords(stored.records, clone.records),
    }
    this.#sessions.set(key, next)
    this.commits.push(clone)
    const result: PersistenceCommitResult = {
      schemaVersion: 1,
      batchId: batch.batchId,
      status: 'committed',
      persistenceGeneration: next.generation,
    }
    batches.set(batch.batchId, { fingerprint: requestFingerprint, result })
    this.#batches.set(key, batches)
    return structuredClone(result)
  }
}
