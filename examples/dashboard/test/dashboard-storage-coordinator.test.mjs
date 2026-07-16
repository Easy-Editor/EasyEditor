import assert from 'node:assert/strict'
import test from 'node:test'
import { hashCanonicalJson } from '../src/lib/storage/canonical-json.mjs'
import { MemoryDashboardStorageBackend } from '../src/lib/storage/memory-backend.mjs'
import {
  ProjectPersistenceCoordinator,
  createMigrationBatchId,
} from '../src/lib/storage/project-persistence-coordinator.mjs'

const request = (overrides = {}) => ({
  schemaVersion: 1,
  batchId: 'save-1',
  projectId: 'project-1',
  branchId: 'main',
  expectedDraftGeneration: 0,
  activeDocument: { documentId: 'document-1', fileName: 'Home', index: 0 },
  projectSchema: {
    z: 1,
    componentsTree: [{ componentName: 'Root', id: 'root' }],
    a: { beta: true, alpha: null },
  },
  commitKind: 'manual-save',
  updatedAt: 42,
  operations: [],
  ...overrides,
})

test('coordinator builds, hashes, commits, and verifies the complete canonical working draft', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })

  const committed = await coordinator.commit(request())

  assert.equal(committed.status, 'committed')
  assert.equal(committed.draft.draftGeneration, 1)
  assert.equal(committed.draft.commitKind, 'manual-save')
  assert.equal(committed.draft.projectHash, 'sha256:6eaaace39a082f37e3635f89c8a9164b51dc764fc697b404f8a6a559c88eb682')
  assert.deepEqual(await coordinator.readWorkingDraft({ projectId: 'project-1', branchId: 'main' }), committed.draft)
})

test('every non-Agent schema change conservatively invalidates Agent provenance while unchanged saves preserve it', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const slotKey = 'project-1/main/title-1/props/text'
  const agentProvenance = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    slotKey,
    draftGeneration: 1,
    token: 'agent:call-1',
  }

  await coordinator.commit(
    request({
      batchId: 'agent-save-1',
      commitKind: 'agent-batch',
      operations: [{ type: 'put', store: 'mutationProvenance', value: agentProvenance }],
    }),
  )
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', slotKey]), agentProvenance)

  await coordinator.commit(
    request({
      batchId: 'unchanged-manual-save-2',
      expectedDraftGeneration: 1,
      updatedAt: 43,
    }),
  )
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', slotKey]), agentProvenance)

  await coordinator.commit(
    request({
      batchId: 'changed-autosave-3',
      expectedDraftGeneration: 2,
      commitKind: 'autosave',
      projectSchema: { ...request().projectSchema, changed: true },
      updatedAt: 44,
    }),
  )
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', slotKey]), {
    ...agentProvenance,
    draftGeneration: 3,
    token: 'unknown',
  })

  const trustedProvenance = {
    ...agentProvenance,
    draftGeneration: 4,
    token: 'agent:call-2',
  }
  await coordinator.commit(
    request({
      batchId: 'changed-save-with-trusted-plan-4',
      expectedDraftGeneration: 3,
      projectSchema: { ...request().projectSchema, changedAgain: true },
      updatedAt: 45,
      operations: [{ type: 'put', store: 'mutationProvenance', value: trustedProvenance }],
    }),
  )
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', slotKey]), trustedProvenance)

  const migratedSchema = { ...request().projectSchema, importedFromLegacy: true }
  const migrated = await coordinator.commitMigration({
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 4,
    sourceDraftGeneration: 5,
    source: 'legacy-local-storage',
    diagnostics: [],
    activeDocument: request().activeDocument,
    projectSchema: migratedSchema,
    projectHash: await hashCanonicalJson(migratedSchema),
    updatedAt: 46,
  })
  assert.equal(migrated.draftGeneration, 6)
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', slotKey]), {
    ...trustedProvenance,
    draftGeneration: 6,
    token: 'unknown',
  })
})

test('callers cannot inject the coordinator-controlled provenance invalidation operation', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })

  await assert.rejects(
    coordinator.commit(
      request({
        commitKind: 'agent-batch',
        operations: [{ type: 'invalidate-agent-provenance', store: 'mutationProvenance' }],
      }),
    ),
    error =>
      error.code === 'validation-failed' &&
      error.reason === 'project-persistence-provenance-invalidation-is-coordinator-controlled',
  )
  assert.equal(await backend.get('workingDrafts', ['project-1', 'main']), undefined)
})

test('migration commit validates the caller hash and uses a stable coordinator batch identity', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const migration = {
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 0,
    sourceDraftGeneration: 0,
    source: 'projectSchema',
    diagnostics: [],
    activeDocument: null,
    projectSchema: request().projectSchema,
    projectHash: 'sha256:6eaaace39a082f37e3635f89c8a9164b51dc764fc697b404f8a6a559c88eb682',
    updatedAt: 42,
  }

  const result = await coordinator.commitMigration(migration)
  assert.match(createMigrationBatchId(migration), /^migration-v1:/u)
  assert.equal(result.commitKind, 'migration')
  assert.equal(result.draftGeneration, 1)

  assert.deepEqual(await coordinator.commitMigration(migration), result)

  await assert.rejects(
    coordinator.commitMigration({
      ...migration,
      expectedDraftGeneration: 1,
      sourceDraftGeneration: 1,
      projectHash: `sha256:${'0'.repeat(64)}`,
    }),
    error => error.code === 'integrity-mismatch',
  )
  assert.equal((await coordinator.readWorkingDraft({ projectId: 'project-1', branchId: 'main' })).draftGeneration, 1)
})

test('migration preserves provenance only for a no-op and invalidates a provenance-blind advancing interval', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const slotKey = 'project-1/main/title-1/props/text'
  const agentProvenance = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    slotKey,
    draftGeneration: 1,
    token: 'agent:call-1',
  }
  const initial = await coordinator.commit(
    request({
      batchId: 'agent-before-migration',
      commitKind: 'agent-batch',
      operations: [{ type: 'put', store: 'mutationProvenance', value: agentProvenance }],
    }),
  )

  const sameGeneration = await coordinator.commitMigration({
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 1,
    sourceDraftGeneration: 1,
    source: 'indexeddb',
    diagnostics: [],
    activeDocument: initial.draft.activeDocument,
    projectSchema: initial.draft.projectSchema,
    projectHash: initial.draft.projectHash,
    updatedAt: 43,
  })
  assert.deepEqual(sameGeneration, initial.draft)
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', slotKey]), agentProvenance)

  const advanced = await coordinator.commitMigration({
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 1,
    sourceDraftGeneration: 2,
    source: 'legacy-local-storage',
    diagnostics: [{ code: 'provenance-blind-legacy-interval' }],
    activeDocument: initial.draft.activeDocument,
    projectSchema: initial.draft.projectSchema,
    projectHash: initial.draft.projectHash,
    updatedAt: 44,
  })
  assert.equal(advanced.draftGeneration, 3)
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', slotKey]), {
    ...agentProvenance,
    draftGeneration: 3,
    token: 'unknown',
  })
})

test('equal-generation migration with the canonical hash is a no-op and preserves prior migration state', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const committed = await coordinator.commit(request())
  const priorMigrationState = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    status: 'draft-committed',
    source: 'projectSchema',
    sourceDraftGeneration: 0,
    targetGeneration: 1,
    diagnostics: [{ code: 'prior-migration' }],
    updatedAt: 41,
  }
  await coordinator.recordMigrationState(priorMigrationState)

  const result = await coordinator.commitMigration({
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 1,
    sourceDraftGeneration: 1,
    source: 'projectSchema',
    diagnostics: [{ code: 'equal-generation-retry' }],
    activeDocument: committed.draft.activeDocument,
    projectSchema: committed.draft.projectSchema,
    projectHash: committed.draft.projectHash,
    updatedAt: 43,
  })

  assert.deepEqual(result, committed.draft)
  assert.equal(result.draftGeneration, 1)
  assert.deepEqual(await backend.get('migrationState', ['project-1', 'main']), priorMigrationState)
})

test('migration rejects stale/divergent legacy state and may jump only to source generation plus one', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const initial = {
    projectId: 'project-1',
    branchId: 'main',
    expectedDraftGeneration: 0,
    sourceDraftGeneration: 0,
    source: 'projectSchema',
    diagnostics: [{ code: 'complete-project-selected' }],
    activeDocument: null,
    projectSchema: request().projectSchema,
    projectHash: 'sha256:6eaaace39a082f37e3635f89c8a9164b51dc764fc697b404f8a6a559c88eb682',
    updatedAt: 42,
  }
  await coordinator.commitMigration(initial)

  await assert.rejects(
    coordinator.commitMigration({
      ...initial,
      expectedDraftGeneration: 1,
      sourceDraftGeneration: 1,
      projectSchema: { other: true },
      projectHash: 'sha256:dbcbb05208bbb6cc1181867c1498e0e60dcbe6e4097bbada64fe1408114fa81b',
    }),
    error => error.code === 'integrity-mismatch' && error.reason === 'migration-source-diverges-at-the-same-generation',
  )

  const jumped = await coordinator.commitMigration({
    ...initial,
    expectedDraftGeneration: 1,
    sourceDraftGeneration: 5,
    projectSchema: { future: true },
    projectHash: 'sha256:441d8359709e5c753d9ea01a18416a141f8db52c51e46e43777110639093fbd8',
  })
  assert.equal(jumped.draftGeneration, 6)
  assert.deepEqual(await backend.get('migrationState', ['project-1', 'main']), {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    status: 'draft-committed',
    source: 'projectSchema',
    sourceDraftGeneration: 5,
    targetGeneration: 6,
    diagnostics: [{ code: 'complete-project-selected' }],
    updatedAt: 42,
  })

  await assert.rejects(
    coordinator.commitMigration(initial),
    error => error.code === 'generation-conflict' && error.reason === 'migration-source-generation-is-stale',
  )
  assert.equal((await coordinator.readWorkingDraft({ projectId: 'project-1', branchId: 'main' })).draftGeneration, 6)
})

test('migration failure records typed diagnostics without creating or advancing a working draft', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })

  const record = await coordinator.recordMigrationFailure({
    projectId: 'project-1',
    branchId: 'main',
    source: 'page-fragments',
    sourceDraftGeneration: 3,
    diagnostics: [{ code: 'missing-page-fragment', key: 'pageSchema:missing' }],
    updatedAt: 50,
  })

  assert.equal(record.status, 'failed')
  assert.equal(record.targetGeneration, null)
  assert.deepEqual(await backend.get('migrationState', ['project-1', 'main']), record)
  assert.equal(await backend.get('workingDrafts', ['project-1', 'main']), undefined)
})

test('failed atomic migration commit writes neither its draft nor migration state', async () => {
  const backend = new MemoryDashboardStorageBackend({
    faultInjector(event) {
      if (
        event.batch.draft?.commitKind === 'migration' &&
        event.phase === 'after-operation' &&
        event.operationIndex === 0
      ) {
        throw new Error('simulated migration transaction abort')
      }
    },
  })
  const coordinator = new ProjectPersistenceCoordinator({ backend })

  await assert.rejects(
    coordinator.commitMigration({
      projectId: 'project-1',
      branchId: 'main',
      expectedDraftGeneration: 0,
      sourceDraftGeneration: 0,
      source: 'projectSchema',
      diagnostics: [],
      activeDocument: null,
      projectSchema: request().projectSchema,
      projectHash: 'sha256:6eaaace39a082f37e3635f89c8a9164b51dc764fc697b404f8a6a559c88eb682',
      updatedAt: 42,
    }),
    error => error.code === 'transaction-aborted',
  )
  assert.equal(await backend.get('workingDrafts', ['project-1', 'main']), undefined)
  assert.equal(await backend.get('migrationState', ['project-1', 'main']), undefined)
})

class InstrumentedBackend {
  constructor(delay = 5) {
    this.inner = new MemoryDashboardStorageBackend()
    this.delay = delay
    this.activeCommits = 0
    this.maximumConcurrentCommits = 0
  }

  async get(...args) {
    return this.inner.get(...args)
  }

  async getAll(...args) {
    return this.inner.getAll(...args)
  }

  async commit(value) {
    this.activeCommits += 1
    this.maximumConcurrentCommits = Math.max(this.maximumConcurrentCommits, this.activeCommits)
    try {
      await new Promise(resolve => setTimeout(resolve, this.delay))
      return await this.inner.commit(value)
    } finally {
      this.activeCommits -= 1
    }
  }

  async flush() {
    return this.inner.flush()
  }

  async dispose() {
    return this.inner.dispose()
  }
}

test('coordinator serializes one project/branch while leaving independent branches concurrent', async () => {
  const backend = new InstrumentedBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })

  const sameBranch = await Promise.all([
    coordinator.commit(request()),
    coordinator.commit(request({ batchId: 'save-2', expectedDraftGeneration: 1, updatedAt: 43 })),
  ])
  assert.deepEqual(
    sameBranch.map(result => result.draft.draftGeneration),
    [1, 2],
  )
  assert.equal(backend.maximumConcurrentCommits, 1)

  backend.maximumConcurrentCommits = 0
  await Promise.all([
    coordinator.commit(request({ batchId: 'main-save-3', expectedDraftGeneration: 2, updatedAt: 44 })),
    coordinator.commit(
      request({ batchId: 'branch-save-1', branchId: 'experiment', expectedDraftGeneration: 0, updatedAt: 44 }),
    ),
  ])
  assert.equal(backend.maximumConcurrentCommits, 2)
})

test('readWorkingDraft occupies the project/branch tail so a later save cannot overtake the read', async () => {
  const inner = new MemoryDashboardStorageBackend()
  const writer = new ProjectPersistenceCoordinator({ backend: inner })
  await writer.commit(request())

  let releaseRead
  let markReadStarted
  const readGate = new Promise(resolve => {
    releaseRead = resolve
  })
  const readStarted = new Promise(resolve => {
    markReadStarted = resolve
  })
  let blockRead = true
  const backend = {
    async get(...args) {
      if (blockRead) {
        blockRead = false
        markReadStarted()
        await readGate
      }
      return inner.get(...args)
    },
    getAll: (...args) => inner.getAll(...args),
    commit: value => inner.commit(value),
    flush: () => inner.flush(),
    dispose: () => inner.dispose(),
  }
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const read = coordinator.readWorkingDraft({ projectId: 'project-1', branchId: 'main' })
  await readStarted
  const save = coordinator.commit(request({ batchId: 'save-2', expectedDraftGeneration: 1, updatedAt: 43 }))

  assert.equal((await inner.get('workingDrafts', ['project-1', 'main'])).draftGeneration, 1)
  releaseRead()
  assert.equal((await read).draftGeneration, 1)
  assert.equal((await save).draft.draftGeneration, 2)
})

test('flush waits queued commits and dispose drains once before rejecting new work', async () => {
  let releaseCommit
  const gate = new Promise(resolve => {
    releaseCommit = resolve
  })
  const inner = new MemoryDashboardStorageBackend()
  let disposeCalls = 0
  const backend = {
    get: (...args) => inner.get(...args),
    getAll: (...args) => inner.getAll(...args),
    async commit(value) {
      await gate
      return inner.commit(value)
    },
    flush: () => inner.flush(),
    async dispose() {
      disposeCalls += 1
      await inner.dispose()
    },
  }
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const commit = coordinator.commit(request())
  let flushed = false
  const flush = coordinator.flush().then(() => {
    flushed = true
  })

  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(flushed, false)
  releaseCommit()
  await commit
  await flush

  await Promise.all([coordinator.dispose(), coordinator.dispose()])
  assert.equal(disposeCalls, 1)
  await assert.rejects(coordinator.commit(request({ batchId: 'after-dispose' })), error => error.code === 'disposed')
})

test('coordinator rejects a stored draft whose project hash no longer matches its full schema', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const writer = new ProjectPersistenceCoordinator({ backend })
  await writer.commit(request())

  const tamperingBackend = {
    ...backend,
    get: async (...args) => {
      const stored = await backend.get(...args)
      if (stored) stored.projectHash = `sha256:${'0'.repeat(64)}`
      return stored
    },
    getAll: (...args) => backend.getAll(...args),
    commit: value => backend.commit(value),
    flush: () => backend.flush(),
    dispose: () => backend.dispose(),
  }
  const reader = new ProjectPersistenceCoordinator({ backend: tamperingBackend })

  await assert.rejects(
    reader.readWorkingDraft({ projectId: 'project-1', branchId: 'main' }),
    error => error.code === 'integrity-mismatch',
  )
})

test('coordinator exposes narrow durable Agent-session and receipt-lineage seams without advancing the draft clock', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const intent = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    callId: 'call-1',
    preparedHash: `sha256:${'a'.repeat(64)}`,
    baseRevision: 'revision-1',
    preImages: { title: 'Before' },
    expectedPostImages: { title: 'After' },
    status: 'pending',
  }
  assert.deepEqual(await coordinator.recordReceiptIntent(intent), intent)
  assert.deepEqual(
    (await coordinator.readReceiptLineage({ projectId: 'project-1', branchId: 'main', callId: 'call-1' }))
      .receiptIntent,
    intent,
  )

  assert.deepEqual(
    await coordinator.commitAgentPersistence({
      schemaVersion: 1,
      projectId: 'project-1',
      branchId: 'main',
      sessionId: 'session-1',
      batchId: 'agent-batch-1',
      expectedPersistenceGeneration: 0,
      records: [{ recordId: 'journal-1', kind: 'journal', value: { phase: 'OBSERVE' } }],
    }),
    {
      schemaVersion: 1,
      batchId: 'agent-batch-1',
      status: 'committed',
      persistenceGeneration: 1,
    },
  )
  assert.equal(
    (
      await coordinator.readAgentPersistence({
        schemaVersion: 1,
        projectId: 'project-1',
        branchId: 'main',
        sessionId: 'session-1',
        expectedPersistenceGeneration: 0,
      })
    ).persistenceGeneration,
    1,
  )
  assert.equal(await backend.get('workingDrafts', ['project-1', 'main']), undefined)
})
