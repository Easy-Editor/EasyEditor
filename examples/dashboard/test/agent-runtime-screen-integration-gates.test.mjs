import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'

import { createHumanActivityLease } from '../src/editor/agent/activity/index.mjs'
import { createDashboardAgentHost } from '../src/editor/agent/host/index.mjs'

const coreInstanceUrl = new URL('../../../packages/core/dist/instance.js', import.meta.url)

const authority = Object.freeze({
  projectId: 'screen-integration-project',
  branchId: 'main',
  sessionId: 'screen-integration-session',
  taskId: 'screen-integration-task',
})

const createProjectSchema = (childCount = 2) => ({
  id: authority.projectId,
  version: '0.0.1',
  componentsMap: [],
  componentsTree: [
    {
      docId: 'page-1',
      id: 'root-1',
      componentName: 'ScreenRoot',
      props: { title: 'before' },
      children: Array.from({ length: childCount }, (_, index) => ({
        id: `item-${index + 1}`,
        componentName: 'ScreenItem',
        props: { title: `item-${index + 1}` },
        children: [],
      })),
    },
  ],
})

const registerMaterials = engine => {
  const configure = { props: [{ name: 'title', title: 'Title', setter: 'StringSetter' }] }
  engine.materials.createComponentMeta({ componentName: 'ScreenRoot', title: 'Root', configure })
  engine.materials.createComponentMeta({ componentName: 'ScreenItem', title: 'Item', configure })
}

const createPersistence = ({ afterIntent } = {}) => {
  let draftGeneration = 0
  let committedBatch
  return {
    get committedBatch() {
      return committedBatch
    },
    recoverDurableAgentReceipt: async () => ({ classification: 'missing' }),
    runDurableAgentWrite: async operation =>
      operation({
        draft: { draftGeneration },
        recordIntent: async intent => {
          await afterIntent?.(intent)
          return structuredClone(intent)
        },
        commitBatch: async batch => {
          committedBatch = structuredClone(batch)
          draftGeneration += 1
          return { receipt: structuredClone(batch.receipt) }
        },
      }),
  }
}

const createCall = expectedRevision => ({
  schemaVersion: 1,
  ...authority,
  stepId: 'step-1',
  callId: 'screen-write-1',
  capability: 'screen.applyChangeSet',
  expectedRevision,
  arguments: {
    schemaVersion: 1,
    documentId: 'page-1',
    operations: [
      {
        opId: 'set-root-title',
        type: 'set',
        nodeId: 'root-1',
        fieldId: 'props.title',
        value: 'agent-title',
      },
    ],
  },
})

const createHostHarness = async (t, { activityLease, afterIntent } = {}) => {
  const { TransactionCommittedError, TransactionRollbackIncompleteError, createEngine } = await import(
    coreInstanceUrl.href
  )
  const engine = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  await engine.init()
  registerMaterials(engine)
  engine.loadProject(createProjectSchema(), true)

  let coreCommitAttempts = 0
  const enginePort = {
    project: engine.project,
    materials: engine.materials,
    transactions: {
      runOnDocument(...args) {
        coreCommitAttempts += 1
        return engine.transactions.runOnDocument(...args)
      },
    },
  }
  const persistence = createPersistence({ afterIntent })
  const lease =
    activityLease ??
    Object.freeze({ generation: 0, isActive: () => false, waitUntilIdle: async () => ({ generation: 0 }) })
  const host = createDashboardAgentHost({
    activityLease: lease,
    authority,
    compensationService: Object.freeze({
      compensate: async () => assert.fail('compensation is outside this gate'),
      query: async () => null,
    }),
    enabled: true,
    engine: enginePort,
    isTransactionCommittedError: error => error instanceof TransactionCommittedError,
    isTransactionRollbackIncompleteError: error => error instanceof TransactionRollbackIncompleteError,
    now: () => 1_700_000_000_000,
    persistence,
  })
  t.after(async () => {
    host.dispose()
    lease.dispose?.()
    await engine.destroy()
  })
  return {
    engine,
    host,
    lease,
    persistence,
    get coreCommitAttempts() {
      return coreCommitAttempts
    },
  }
}

test('R1 prepare followed by a human R2 move rejects stale and preserves human schema and History', async t => {
  const engineForHumanMutation = { current: null }
  const harness = await createHostHarness(t, {
    afterIntent: () => {
      const document = engineForHumanMutation.current.project.currentDocument
      engineForHumanMutation.current.transactions.runOnDocument(
        document,
        [{ type: 'moveNode', documentId: document.id, nodeId: 'item-1', parentId: 'root-1', at: 1 }],
        { expectedMutationVersion: document.mutationVersion },
      )
    },
  })
  engineForHumanMutation.current = harness.engine
  const document = harness.engine.project.currentDocument
  const observed = await harness.host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
  const historyBefore = document.history.getState()
  assert.equal(document.history.isUndoable(), false)

  const result = await harness.host.invoke(createCall(observed.revision), { schemaVersion: 1 })
  const humanSchema = document.exportRaw()

  assert.equal(result.status, 'not-applied')
  assert.equal(result.failure.code, 'STALE_REVISION')
  assert.equal(harness.coreCommitAttempts, 0, 'stale Agent write must not enter Core')
  assert.deepEqual(
    humanSchema.children.map(child => child.id),
    ['item-2', 'item-1'],
  )
  assert.equal(document.root.getPropValue('title'), 'before')
  assert.equal(new Set(humanSchema.children.map(child => child.id)).size, 2, 'the stale path must not duplicate nodes')
  assert.notEqual(document.history.getState(), historyBefore, 'the human move remains the only new History unit')
  document.history.back()
  assert.deepEqual(
    document.exportRaw().children.map(child => child.id),
    ['item-1', 'item-2'],
    'one undo consumes the preserved human move without an empty Agent entry',
  )
  assert.equal(document.history.isUndoable(), false)
  assert.equal(document.history.isRedoable(), true)
})

test('continuous pointer lease blocks Core and release permits exactly one Agent commit attempt', async t => {
  const lease = createHumanActivityLease({ idleMs: 1 })
  const hold = lease.acquire('pointer')
  const harness = await createHostHarness(t, { activityLease: lease })
  const observed = await harness.host.observe({ schemaVersion: 1, ...authority, mode: 'full' })

  const pending = harness.host.invoke(createCall(observed.revision), { schemaVersion: 1 })
  await new Promise(resolve => setImmediate(resolve))
  hold.renew()
  hold.renew()
  assert.equal(harness.coreCommitAttempts, 0)

  hold.release()
  const result = await pending

  assert.equal(result.status, 'applied')
  assert.equal(harness.coreCommitAttempts, 1)
  assert.equal(harness.engine.project.currentDocument.root.getPropValue('title'), 'agent-title')
})

test('fixed 200-node real Core atomic commit runner keeps warmed P95 below 50ms', async t => {
  const { createEngine } = await import(coreInstanceUrl.href)
  const engine = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(async () => engine.destroy())
  await engine.init()
  engine.loadProject(createProjectSchema(199), true)
  const document = engine.project.currentDocument
  const targetId = 'item-100'
  const warmupRuns = 10
  const sampleRuns = 40

  const commit = value =>
    engine.transactions.runOnDocument(
      document,
      [{ type: 'updateProps', documentId: document.id, nodeId: targetId, props: { title: value } }],
      { expectedMutationVersion: document.mutationVersion },
    )

  for (let index = 0; index < warmupRuns; index += 1) commit(`warmup-${index}`)
  const samples = []
  for (let index = 0; index < sampleRuns; index += 1) {
    const startedAt = performance.now()
    commit(`sample-${index}`)
    samples.push(performance.now() - startedAt)
  }
  const sorted = [...samples].sort((left, right) => left - right)
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]
  t.diagnostic(JSON.stringify({ nodeCount: 200, warmupRuns, sampleRuns, samples, p95Ms: p95 }))
  assert.ok(
    p95 < 50,
    `Core atomic commit P95 ${p95.toFixed(3)}ms must remain below 50ms; samples=${JSON.stringify(samples)}`,
  )
})
