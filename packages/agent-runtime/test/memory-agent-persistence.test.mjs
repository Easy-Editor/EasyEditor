import assert from 'node:assert/strict'
import test from 'node:test'
import { MemoryAgentPersistence } from '../dist/testing.js'

const binding = {
  projectId: 'project-1',
  branchId: 'branch-1',
  sessionId: 'session-1',
}

const createBatch = ({ batchId = 'batch-1', generation = 0, records } = {}) => ({
  schemaVersion: 1,
  ...binding,
  batchId,
  expectedPersistenceGeneration: generation,
  records: records ?? [{ recordId: 'record-1', kind: 'journal', value: { phase: 'OBSERVE' } }],
})

const read = persistence =>
  persistence.read({
    schemaVersion: 1,
    ...binding,
    expectedPersistenceGeneration: 0,
  })

test('replaying the same canonical batch returns its original result without writing twice', async () => {
  const persistence = new MemoryAgentPersistence()
  const first = createBatch({
    records: [{ recordId: 'record-1', kind: 'journal', value: { phase: 'OBSERVE', metadata: { a: 1, b: 2 } } }],
  })
  const replay = {
    records: [{ value: { metadata: { b: 2, a: 1 }, phase: 'OBSERVE' }, kind: 'journal', recordId: 'record-1' }],
    expectedPersistenceGeneration: 0,
    batchId: 'batch-1',
    sessionId: 'session-1',
    branchId: 'branch-1',
    projectId: 'project-1',
    schemaVersion: 1,
  }

  const originalResult = await persistence.commit(first)
  const replayResult = await persistence.commit(replay)

  assert.deepEqual(replayResult, originalResult)
  assert.deepEqual(originalResult, {
    schemaVersion: 1,
    batchId: 'batch-1',
    status: 'committed',
    persistenceGeneration: 1,
  })
  assert.equal(persistence.commits.length, 1)
  assert.equal((await read(persistence)).persistenceGeneration, 1)
})

test('reusing a batch id for a different request is rejected with a stable failure', async () => {
  const persistence = new MemoryAgentPersistence()
  await persistence.commit(createBatch())
  await persistence.commit(createBatch({ batchId: 'batch-2', generation: 1 }))
  const conflict = createBatch({
    records: [{ recordId: 'record-1', kind: 'journal', value: { phase: 'PLAN_STEP' } }],
  })

  const firstRejection = await persistence.commit(conflict)
  const repeatedRejection = await persistence.commit(structuredClone(conflict))

  assert.deepEqual(firstRejection, {
    schemaVersion: 1,
    batchId: 'batch-1',
    status: 'rejected',
    persistenceGeneration: 1,
    failure: {
      code: 'persistence-batch-id-reused',
      message: 'batchId was reused with a different persistence request',
      retryable: false,
      details: { batchId: 'batch-1' },
    },
  })
  assert.deepEqual(repeatedRejection, firstRejection)
  assert.equal(persistence.commits.length, 2)
})

test('a stale persistence generation performs no writes', async () => {
  const persistence = new MemoryAgentPersistence()
  await persistence.commit(createBatch())

  const rejected = await persistence.commit(
    createBatch({
      batchId: 'batch-2',
      generation: 0,
      records: [{ recordId: 'record-2', kind: 'journal', value: { phase: 'PLAN_STEP' } }],
    }),
  )

  assert.deepEqual(rejected, {
    schemaVersion: 1,
    batchId: 'batch-2',
    status: 'generation-conflict',
    persistenceGeneration: 1,
  })
  assert.equal(persistence.commits.length, 1)
  assert.deepEqual((await read(persistence)).records, [
    { recordId: 'record-1', kind: 'journal', value: { phase: 'OBSERVE' } },
  ])
})

test('committed records upsert by record id without erasing unrelated records', async () => {
  const persistence = new MemoryAgentPersistence()
  await persistence.commit(
    createBatch({
      records: [
        { recordId: 'record-1', kind: 'journal', value: { phase: 'OBSERVE' } },
        { recordId: 'record-2', kind: 'receipt', value: { status: 'applied' } },
      ],
    }),
  )

  await persistence.commit(
    createBatch({
      batchId: 'batch-2',
      generation: 1,
      records: [
        { recordId: 'record-1', kind: 'journal', value: { phase: 'COMPLETED' } },
        { recordId: 'record-3', kind: 'witness', value: { verified: true } },
      ],
    }),
  )

  assert.deepEqual((await read(persistence)).records, [
    { recordId: 'record-1', kind: 'journal', value: { phase: 'COMPLETED' } },
    { recordId: 'record-2', kind: 'receipt', value: { status: 'applied' } },
    { recordId: 'record-3', kind: 'witness', value: { verified: true } },
  ])
})
