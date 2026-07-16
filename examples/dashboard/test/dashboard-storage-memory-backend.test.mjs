import assert from 'node:assert/strict'
import test from 'node:test'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from '../src/lib/storage/errors.mjs'
import { MemoryDashboardStorageBackend } from '../src/lib/storage/memory-backend.mjs'

const hash = suffix => `sha256:${suffix.padEnd(64, '0')}`

const draft = (draftGeneration, suffix = String(draftGeneration)) => ({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'main',
  draftGeneration,
  activeDocument: { documentId: 'document-1', fileName: 'Home', index: 0 },
  projectSchema: { componentsTree: [{ id: `root-${draftGeneration}` }] },
  projectHash: hash(suffix),
  commitKind: 'manual-save',
  updatedAt: draftGeneration,
})

const batch = (expectedDraftGeneration, operations = []) => ({
  schemaVersion: 1,
  batchId: `batch-${expectedDraftGeneration + 1}`,
  projectId: 'project-1',
  branchId: 'main',
  expectedDraftGeneration,
  draft: draft(expectedDraftGeneration + 1),
  operations,
})

const agentBatch = (overrides = {}) => ({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'main',
  sessionId: 'session-1',
  batchId: 'agent-batch-1',
  expectedPersistenceGeneration: 0,
  records: [{ recordId: 'journal-1', kind: 'journal', value: { phase: 'OBSERVE' } }],
  ...overrides,
})

const receiptIntent = (overrides = {}) => ({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'main',
  callId: 'call-1',
  preparedHash: `sha256:${'a'.repeat(64)}`,
  baseRevision: 'revision-1',
  preImages: { title: 'Before' },
  expectedPostImages: { title: 'After' },
  status: 'pending',
  ...overrides,
})

test('memory backend atomically commits a canonical draft and typed multi-store operations under generation CAS', async () => {
  const backend = new MemoryDashboardStorageBackend()

  const result = await backend.commit(
    batch(0, [
      {
        type: 'put',
        store: 'projects',
        value: { schemaVersion: 1, projectId: 'project-1', updatedAt: 1 },
      },
      {
        type: 'put',
        store: 'toolReceipts',
        value: {
          schemaVersion: 1,
          projectId: 'project-1',
          branchId: 'main',
          callId: 'call-1',
          status: 'committed',
        },
      },
    ]),
  )

  assert.deepEqual(result, {
    schemaVersion: 1,
    batchId: 'batch-1',
    status: 'committed',
    draftGeneration: 1,
  })
  assert.deepEqual(await backend.get('workingDrafts', ['project-1', 'main']), draft(1))
  assert.equal((await backend.get('toolReceipts', ['project-1', 'main', 'call-1'])).status, 'committed')

  await assert.rejects(backend.commit(batch(0)), error => {
    assert.equal(error.code, 'generation-conflict')
    assert.deepEqual(error.details, { projectId: 'project-1', branchId: 'main', expected: 0, actual: 1 })
    return true
  })
  assert.equal((await backend.get('workingDrafts', ['project-1', 'main'])).draftGeneration, 1)
})

test('memory backend atomically invalidates only current-scope Agent provenance when the project hash changes', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const agentSlot = 'project-1/main/title-1/props/text'
  const humanSlot = 'project-1/main/title-2/props/text'
  const agentProvenance = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    slotKey: agentSlot,
    draftGeneration: 1,
    token: 'agent:call-1',
  }
  const humanProvenance = {
    ...agentProvenance,
    slotKey: humanSlot,
    token: 'human',
  }
  const invalidate = { type: 'invalidate-agent-provenance', store: 'mutationProvenance' }

  await backend.commit(
    batch(0, [
      { type: 'put', store: 'mutationProvenance', value: agentProvenance },
      { type: 'put', store: 'mutationProvenance', value: humanProvenance },
    ]),
  )
  const unchanged = batch(1, [invalidate])
  unchanged.draft.projectHash = draft(1).projectHash
  await backend.commit(unchanged)
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', agentSlot]), agentProvenance)

  await backend.commit(batch(2, [invalidate]))
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', agentSlot]), {
    ...agentProvenance,
    draftGeneration: 3,
    token: 'unknown',
  })
  assert.deepEqual(await backend.get('mutationProvenance', ['project-1', 'main', humanSlot]), humanProvenance)

  await assert.rejects(backend.commit(batch(0, [invalidate])), error => error.code === 'generation-conflict')
  assert.equal((await backend.get('workingDrafts', ['project-1', 'main'])).draftGeneration, 3)
  assert.equal((await backend.get('mutationProvenance', ['project-1', 'main', agentSlot])).token, 'unknown')
})

test('memory provenance invalidation rolls back with an aborted ordinary commit', async () => {
  const agentSlot = 'project-1/main/title-1/props/text'
  const backend = new MemoryDashboardStorageBackend({
    faultInjector(event) {
      if (event.batch.batchId === 'batch-2' && event.phase === 'after-operation' && event.operationIndex === 0) {
        throw new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.quotaExceeded, 'test-quota-exceeded')
      }
    },
  })
  await backend.commit(
    batch(0, [
      {
        type: 'put',
        store: 'mutationProvenance',
        value: {
          schemaVersion: 1,
          projectId: 'project-1',
          branchId: 'main',
          slotKey: agentSlot,
          draftGeneration: 1,
          token: 'agent:call-1',
        },
      },
    ]),
  )

  await assert.rejects(
    backend.commit(batch(1, [{ type: 'invalidate-agent-provenance', store: 'mutationProvenance' }])),
    error => error.code === 'quota-exceeded',
  )
  assert.equal((await backend.get('workingDrafts', ['project-1', 'main'])).draftGeneration, 1)
  assert.equal((await backend.get('mutationProvenance', ['project-1', 'main', agentSlot])).token, 'agent:call-1')
})

test('provenance invalidation is a narrow exact operation and does not loosen put contracts', async () => {
  for (const operation of [
    { type: 'invalidate-agent-provenance', store: 'toolReceipts' },
    { type: 'invalidate-agent-provenance', store: 'mutationProvenance', extra: true },
    { type: 'put', store: 'mutationProvenance', mode: 'replace', value: {} },
    { type: 'unknown-operation', store: 'mutationProvenance' },
  ]) {
    const backend = new MemoryDashboardStorageBackend()
    await assert.rejects(backend.commit(batch(0, [operation])), error => error.code === 'validation-failed')
    assert.equal(await backend.get('workingDrafts', ['project-1', 'main']), undefined)
  }
})

test('delete operations cannot escape the committing project or branch authority', async () => {
  const cases = [
    { store: 'toolReceipts', key: ['project-2', 'main', 'call-1'] },
    { store: 'toolReceipts', key: ['project-1', 'other-branch', 'call-1'] },
    { store: 'artifacts', key: ['project-2', 'artifact-1', 'revision-1'] },
    { store: 'grants', key: ['user-1', 'project-2', 'read', 1] },
  ]

  for (const operation of cases) {
    const backend = new MemoryDashboardStorageBackend()
    await assert.rejects(
      backend.commit(batch(0, [{ type: 'delete', ...operation }])),
      error => error.code === 'validation-failed' && error.message.includes('authority-mismatch'),
    )
    assert.equal(await backend.get('workingDrafts', ['project-1', 'main']), undefined)
  }
})

test('memory fault injection preserves the previous transaction without partial writes', async () => {
  const backend = new MemoryDashboardStorageBackend({
    faultInjector(event) {
      if (event.batch.batchId === 'batch-2' && event.phase === 'after-operation' && event.operationIndex === 0) {
        throw new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.quotaExceeded, 'test-quota-exceeded')
      }
    },
  })
  await backend.commit(
    batch(0, [
      {
        type: 'put',
        store: 'projects',
        value: { schemaVersion: 1, projectId: 'project-1', updatedAt: 1 },
      },
    ]),
  )

  await assert.rejects(
    backend.commit(
      batch(1, [
        {
          type: 'put',
          store: 'projects',
          value: { schemaVersion: 1, projectId: 'project-1', updatedAt: 2 },
        },
        {
          type: 'put',
          store: 'toolReceipts',
          value: {
            schemaVersion: 1,
            projectId: 'project-1',
            branchId: 'main',
            callId: 'call-2',
          },
        },
      ]),
    ),
    error => error.code === 'quota-exceeded',
  )

  assert.equal((await backend.get('workingDrafts', ['project-1', 'main'])).draftGeneration, 1)
  assert.equal((await backend.get('projects', 'project-1')).updatedAt, 1)
  assert.equal(await backend.get('toolReceipts', ['project-1', 'main', 'call-2']), undefined)
})

test('memory reads are detached clones and disposal rejects further access', async () => {
  const backend = new MemoryDashboardStorageBackend()
  await backend.commit(batch(0))

  const first = await backend.get('workingDrafts', ['project-1', 'main'])
  first.projectSchema.componentsTree[0].id = 'mutated-outside-storage'
  assert.equal((await backend.get('workingDrafts', ['project-1', 'main'])).projectSchema.componentsTree[0].id, 'root-1')

  await backend.flush()
  await backend.dispose()
  await assert.rejects(backend.get('workingDrafts', ['project-1', 'main']), error => error.code === 'disposed')
  await assert.rejects(backend.commit(batch(1)), error => error.code === 'disposed')
})

test('memory backend exposes only a typed single-record migration-state write seam', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const record = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    status: 'failed',
    source: 'page-fragments',
    sourceDraftGeneration: 0,
    targetGeneration: null,
    diagnostics: [{ code: 'malformed-page-fragment' }],
    updatedAt: 9,
  }

  assert.deepEqual(await backend.putMigrationState(record), record)
  assert.deepEqual(await backend.get('migrationState', ['project-1', 'main']), record)
  await assert.rejects(
    backend.putMigrationState({ ...record, targetGeneration: 1 }),
    error => error.code === 'validation-failed',
  )
})

test('memory Agent persistence uses a separate session generation with durable idempotency and record upserts', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const firstBatch = agentBatch()
  assert.deepEqual(await backend.commitAgentPersistence(firstBatch), {
    schemaVersion: 1,
    batchId: 'agent-batch-1',
    status: 'committed',
    persistenceGeneration: 1,
  })
  assert.deepEqual(await backend.commitAgentPersistence(firstBatch), {
    schemaVersion: 1,
    batchId: 'agent-batch-1',
    status: 'committed',
    persistenceGeneration: 1,
  })
  assert.deepEqual(await backend.commitAgentPersistence(agentBatch({ records: [] })), {
    schemaVersion: 1,
    batchId: 'agent-batch-1',
    status: 'rejected',
    persistenceGeneration: 1,
    failure: {
      code: 'persistence-batch-id-reused',
      message: 'batchId was reused with a different persistence request',
      retryable: false,
      details: { batchId: 'agent-batch-1' },
    },
  })

  const stale = agentBatch({
    batchId: 'agent-stale',
    records: [{ recordId: 'must-not-write', kind: 'journal', value: { phase: 'STALE' } }],
  })
  assert.deepEqual(await backend.commitAgentPersistence(stale), {
    schemaVersion: 1,
    batchId: 'agent-stale',
    status: 'generation-conflict',
    persistenceGeneration: 1,
  })
  await backend.commitAgentPersistence(
    agentBatch({
      batchId: 'agent-batch-2',
      expectedPersistenceGeneration: 1,
      records: [
        { recordId: 'journal-1', kind: 'journal', value: { phase: 'VERIFY' } },
        { recordId: 'checkpoint-1', kind: 'checkpoint', value: { verified: true } },
      ],
    }),
  )
  assert.deepEqual(await backend.commitAgentPersistence(stale), {
    schemaVersion: 1,
    batchId: 'agent-stale',
    status: 'generation-conflict',
    persistenceGeneration: 1,
  })

  assert.deepEqual(
    await backend.readAgentPersistence({
      schemaVersion: 1,
      projectId: 'project-1',
      branchId: 'main',
      sessionId: 'session-1',
      expectedPersistenceGeneration: 0,
    }),
    {
      schemaVersion: 1,
      projectId: 'project-1',
      branchId: 'main',
      sessionId: 'session-1',
      persistenceGeneration: 2,
      records: [
        { recordId: 'checkpoint-1', kind: 'checkpoint', value: { verified: true } },
        { recordId: 'journal-1', kind: 'journal', value: { phase: 'VERIFY' } },
      ],
    },
  )
  assert.equal(await backend.get('workingDrafts', ['project-1', 'main']), undefined)
  assert.equal(await backend.get('taskJournals', ['project-1', 'main', 'session-1', 'must-not-write']), undefined)
})

test('memory Agent persistence fault injection leaves session, journals, and checkpoint unchanged', async () => {
  const backend = new MemoryDashboardStorageBackend({
    faultInjector(event) {
      if (event.batch.batchId === 'agent-fault' && event.phase === 'after-operation' && event.operationIndex === 1) {
        throw new Error('simulated Agent persistence crash')
      }
    },
  })

  await assert.rejects(
    backend.commitAgentPersistence(
      agentBatch({
        batchId: 'agent-fault',
        records: [{ recordId: 'journal-fault', kind: 'journal', value: { phase: 'EXECUTE' } }],
      }),
    ),
    error => error.code === 'transaction-aborted',
  )
  assert.deepEqual(await backend.getAll('agentSessions'), [])
  assert.deepEqual(await backend.getAll('taskJournals'), [])
  assert.deepEqual(await backend.getAll('agentCheckpoints'), [])
})

test('memory receipt intent is add-idempotent and lineage reads only matching Agent provenance', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const intent = receiptIntent()
  assert.deepEqual(await backend.putReceiptIntent(intent), intent)
  assert.deepEqual(await backend.putReceiptIntent(intent), intent)
  await assert.rejects(
    backend.putReceiptIntent(receiptIntent({ baseRevision: 'different-revision' })),
    error => error.code === 'integrity-mismatch',
  )

  await backend.commit(
    batch(0, [
      {
        type: 'put',
        store: 'toolReceipts',
        value: { schemaVersion: 1, projectId: 'project-1', branchId: 'main', callId: 'call-1', status: 'applied' },
      },
      {
        type: 'put',
        store: 'applyWitnesses',
        value: { schemaVersion: 1, projectId: 'project-1', branchId: 'main', callId: 'call-1', draftGeneration: 1 },
      },
      {
        type: 'put',
        store: 'mutationProvenance',
        value: {
          schemaVersion: 1,
          projectId: 'project-1',
          branchId: 'main',
          slotKey: 'slot-b',
          token: 'agent:call-1',
        },
      },
      {
        type: 'put',
        store: 'mutationProvenance',
        value: {
          schemaVersion: 1,
          projectId: 'project-1',
          branchId: 'main',
          slotKey: 'slot-human',
          token: 'human',
        },
      },
    ]),
  )
  const lineage = await backend.readReceiptLineage({ projectId: 'project-1', branchId: 'main', callId: 'call-1' })
  assert.deepEqual(lineage.receiptIntent, intent)
  assert.equal(lineage.receipt.status, 'applied')
  assert.equal(lineage.applyWitness.draftGeneration, 1)
  assert.equal(lineage.failureWitness, null)
  assert.deepEqual(
    lineage.provenance.map(record => record.slotKey),
    ['slot-b'],
  )
})
