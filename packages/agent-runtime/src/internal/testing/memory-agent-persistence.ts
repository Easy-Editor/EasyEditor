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

const keyFor = (value: { projectId: string; branchId: string; sessionId: string }) =>
  `${value.projectId}\u0000${value.branchId}\u0000${value.sessionId}`

export class MemoryAgentPersistence implements AgentPersistencePort {
  readonly #sessions = new Map<string, StoredSession>()
  readonly commits: AgentPersistenceBatch[] = []

  async read(request: PersistenceReadRequest): Promise<PersistenceReadResult> {
    const stored = this.#sessions.get(keyFor(request)) ?? { generation: 0, records: [] }
    return structuredClone({
      schemaVersion: 1,
      projectId: request.projectId,
      branchId: request.branchId,
      sessionId: request.sessionId,
      draftGeneration: stored.generation,
      records: stored.records,
    })
  }

  async commit(batch: AgentPersistenceBatch): Promise<PersistenceCommitResult> {
    const clone = structuredClone(batch)
    const key = keyFor(batch)
    const stored = this.#sessions.get(key) ?? { generation: 0, records: [] }
    if (stored.generation !== batch.expectedDraftGeneration) {
      return {
        schemaVersion: 1,
        batchId: batch.batchId,
        status: 'generation-conflict',
        draftGeneration: stored.generation,
      }
    }
    const next = { generation: stored.generation + 1, records: clone.records }
    this.#sessions.set(key, next)
    this.commits.push(clone)
    return {
      schemaVersion: 1,
      batchId: batch.batchId,
      status: 'committed',
      draftGeneration: next.generation,
    }
  }
}
