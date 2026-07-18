import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'

import { createFieldSlotAliases, createMutationProvenanceBatch } from '../src/editor/agent/persistence/provenance.mjs'
import {
  createApplyWitness,
  createFailureWitness,
  createToolReceiptWitness,
} from '../src/editor/agent/persistence/receipt-ledger.mjs'
import { hashCanonicalJson } from '../src/lib/storage/canonical-json.mjs'
import { DashboardStorageError } from '../src/lib/storage/errors.mjs'
import { MemoryDashboardStorageBackend } from '../src/lib/storage/memory-backend.mjs'
import { ProjectPersistenceCoordinator } from '../src/lib/storage/project-persistence-coordinator.mjs'

const projectId = 'project-material-gc'
const branchId = 'main'
const source = Object.freeze({
  artifactId: 'artifact-shared',
  sourceRevision: 'source-1',
  logicalComponentId: 'logical-shared',
  sourceIntegrity: `sha256:${'f'.repeat(64)}`,
})
const materialA = Object.freeze({
  materialId: 'material-a',
  materialVersion: '1.0.0',
  buildIntegrity: `sha256:${'a'.repeat(64)}`,
})
const materialB = Object.freeze({
  materialId: 'material-b',
  materialVersion: '2.0.0',
  buildIntegrity: `sha256:${'b'.repeat(64)}`,
})

const localRef = material => ({
  ...source,
  target: { kind: 'local-material', ...material },
  rollbackTo: source,
})

const schemaWithRefs = (...refs) => ({
  componentsTree: refs.map((artifactRef, index) => ({
    id: `generated-${index}`,
    componentName: 'GeneratedMaterialHost',
    $agent: { schemaVersion: 1, artifactRef },
  })),
})

const commit = (expectedDraftGeneration, projectSchema, overrides = {}) => ({
  schemaVersion: 1,
  batchId: `material-save-${expectedDraftGeneration + 1}`,
  projectId,
  branchId,
  expectedDraftGeneration,
  activeDocument: null,
  projectSchema,
  commitKind: 'manual-save',
  updatedAt: expectedDraftGeneration + 1,
  operations: [],
  ...overrides,
})

const root = (ownerType, ownerId, materialRefs, overrides = {}) => ({
  schemaVersion: 1,
  projectId,
  branchId,
  ownerType,
  ownerId,
  artifactId: source.artifactId,
  sourceRevision: source.sourceRevision,
  ...(materialRefs === undefined ? {} : { materialRefs }),
  ...overrides,
})

const createCoordinator = backend => new ProjectPersistenceCoordinator({ backend, crypto: webcrypto })

const deferred = () => {
  let resolve
  const promise = new Promise(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

const promotionAffectedSlotKeys = nodeId =>
  [
    ...new Set([
      ...createFieldSlotAliases({ projectId, branchId, nodeId, root: 'extras', path: ['$agent'] }),
      ...createFieldSlotAliases({ projectId, branchId, nodeId, root: 'extras', path: ['artifactRef'] }),
      ...createFieldSlotAliases({ projectId, branchId, nodeId, root: 'extras', path: ['extra', 'artifactRef'] }),
    ]),
  ].sort()

const createPromotionFixture = async ({
  callId,
  sessionId,
  stage,
  material = materialA,
  failureCode = 'CORE_TRANSACTION_FAILED',
  draftGeneration = 2,
}) => {
  const taskId = `task-${callId}`
  const stepId = `step-${callId}`
  const nodeId = `node-${callId}`
  const expectedRevision = `revision-${callId}-0`
  const call = {
    schemaVersion: 1,
    projectId,
    branchId,
    sessionId,
    taskId,
    stepId,
    callId,
    capability: 'artifact.promoteLocal',
    expectedRevision,
    arguments: { schemaVersion: 1, nodeId },
  }
  const artifactIdentity = {
    ...source,
    dependencyLockDigest: `sha256:${'9'.repeat(64)}`,
  }
  const previousArtifactRef = { ...source, target: { kind: 'online' } }
  const prepare = {
    schemaVersion: 1,
    baseRevision: expectedRevision,
    documentId: `document-${callId}`,
    nodeId,
    baseMutationVersion: 3,
    previousArtifactRef,
  }
  const callDigest = await hashCanonicalJson(call, { crypto: webcrypto })
  const promotionId = await hashCanonicalJson(
    {
      schemaVersion: 1,
      kind: 'local-material-promotion-identity',
      authority: { projectId, branchId, sessionId, taskId },
      callId,
      callDigest,
      artifact: artifactIdentity,
    },
    { crypto: webcrypto },
  )
  const server = {
    schemaVersion: 1,
    status: 'active',
    promotionId,
    ...material,
    rollbackTo: source,
  }
  const output = {
    schemaVersion: 1,
    kind: 'local-material-promotion-post-images',
    componentName: 'GeneratedMaterialHost',
    nodeId,
    artifactRef: localRef(material),
  }
  const transactionFingerprint = await hashCanonicalJson(
    {
      schemaVersion: 1,
      kind: 'local-material-promotion-transaction-fingerprint',
      projectId,
      branchId,
      callId,
      promotionId,
      documentId: prepare.documentId,
      nodeId: prepare.nodeId,
      baseMutationVersion: prepare.baseMutationVersion,
      previousArtifactRef,
      artifactRef: localRef(material),
    },
    { crypto: webcrypto },
  )
  const provenance =
    stage === 'committed'
      ? createMutationProvenanceBatch({
          projectId,
          branchId,
          draftGeneration,
          slotKeys: promotionAffectedSlotKeys(nodeId),
          source: 'agent',
          callId,
        })
      : []
  const witness =
    stage === 'committed'
      ? createApplyWitness({
          schemaVersion: 1,
          projectId,
          branchId,
          callId,
          draftGeneration,
          coreMutationVersion: prepare.baseMutationVersion + 1,
          transactionFingerprint,
          affectedSlotTokens: provenance.map(({ slotKey, token }) => ({ slotKey, token })),
        })
      : createFailureWitness({
          schemaVersion: 1,
          projectId,
          branchId,
          callId,
          draftGeneration,
          transactionFingerprint,
          receiptStatus: 'not-applied',
          failureCode,
        })
  const journalValue = {
    schemaVersion: 1,
    stage,
    call,
    callDigest,
    promotionId,
    prepare,
    artifactIdentity,
    ...(stage === 'prepared' ? {} : { server }),
    ...(stage === 'committed' ? { output } : {}),
    ...(stage === 'failed' ? { failureCode } : {}),
  }
  const preImages = {
    schemaVersion: 1,
    kind: 'local-material-promotion-pre-images',
    capability: 'artifact.promoteLocal',
    documentId: prepare.documentId,
    nodeId,
    previousArtifactRef,
    artifactIdentity,
    promotionId,
    callDigest,
    expectedRevision,
  }
  const expectedPostImages = {
    schemaVersion: 1,
    kind: 'local-material-promotion-post-images',
    componentName: 'GeneratedMaterialHost',
    nodeId,
    promotionId,
    sourceRevision: source,
  }
  const preparedHash = await hashCanonicalJson(
    {
      schemaVersion: 1,
      kind: 'local-material-promotion-prepared-hash',
      projectId,
      branchId,
      callId,
      baseRevision: prepare.baseRevision,
      preImages,
      expectedPostImages,
    },
    { crypto: webcrypto },
  )
  return {
    callId,
    sessionId,
    promotionId,
    journal: {
      schemaVersion: 1,
      projectId,
      branchId,
      sessionId,
      callId,
      recordId: `promotion:${callId}`,
      kind: 'local-material-promotion',
      value: journalValue,
    },
    intent: {
      schemaVersion: 1,
      projectId,
      branchId,
      callId,
      preparedHash,
      baseRevision: prepare.baseRevision,
      preImages,
      expectedPostImages,
      status: 'pending',
    },
    receipt: {
      schemaVersion: 1,
      projectId,
      branchId,
      callId,
      status: stage === 'committed' ? 'applied' : 'not-applied',
      revision: `revision-${callId}-1`,
      witness: createToolReceiptWitness(witness),
      ...(stage === 'committed'
        ? {}
        : { failure: { code: failureCode, message: 'Core switch did not apply', retryable: false } }),
    },
    checkpointValue: {
      schemaVersion: 1,
      capability: 'artifact.promoteLocal',
      taskId,
      stepId,
      promotionId,
      status: stage === 'committed' ? 'applied' : 'not-applied',
      ...(stage === 'failed' ? { failureCode } : {}),
    },
    witness,
    provenance,
  }
}

const seedPromotionSession = (backend, fixture, records = []) =>
  backend.commitAgentPersistence({
    schemaVersion: 1,
    projectId,
    branchId,
    sessionId: fixture.sessionId,
    batchId: `session-${fixture.callId}`,
    expectedPersistenceGeneration: 0,
    records,
  })

const storeTerminalPromotion = async (coordinator, backend, fixture, expectedDraftGeneration) => {
  await seedPromotionSession(backend, fixture)
  await coordinator.recordReceiptIntent(fixture.intent)
  const draftGeneration = expectedDraftGeneration + 1
  assert.equal(fixture.witness.draftGeneration, draftGeneration)
  await coordinator.commit(
    commit(expectedDraftGeneration, schemaWithRefs(), {
      batchId: `terminal-${fixture.callId}`,
      commitKind: 'agent-batch',
      operations: [
        {
          type: 'put',
          store: 'toolReceipts',
          mode: 'add',
          value: fixture.receipt,
        },
        {
          type: 'put',
          store: fixture.receipt.status === 'applied' ? 'applyWitnesses' : 'failureWitnesses',
          mode: 'add',
          value: fixture.witness,
        },
        ...fixture.provenance.map(value => ({
          type: 'put',
          store: 'mutationProvenance',
          value,
        })),
        {
          type: 'put',
          store: 'taskJournals',
          value: {
            ...fixture.journal,
            draftGeneration,
            updatedAt: draftGeneration,
          },
        },
        {
          type: 'put',
          store: 'agentCheckpoints',
          mode: 'add',
          value: {
            schemaVersion: 1,
            projectId,
            branchId,
            sessionId: fixture.sessionId,
            checkpointId: `promotion:${fixture.callId}`,
            callId: fixture.callId,
            draftGeneration,
            journalRecordId: fixture.journal.recordId,
            outcome: fixture.journal.value.stage === 'committed' ? 'committed' : 'failed',
            value: fixture.checkpointValue,
          },
        },
      ],
    }),
  )
}

test('one source/owner retains two exact builds and every root owner contributes independently', async () => {
  const backend = new MemoryDashboardStorageBackend({ crypto: webcrypto })
  const coordinator = createCoordinator(backend)
  await coordinator.commit(commit(0, schemaWithRefs(localRef(materialB), localRef(materialA))))
  await coordinator.createProjectVersion({
    schemaVersion: 1,
    batchId: 'material-version-1',
    projectId,
    branchId,
    expectedDraftGeneration: 1,
    versionId: 'version-material-a-b',
    name: 'Material A+B',
    createdAt: 2,
    artifactRefs: [{ artifactId: source.artifactId, sourceRevision: source.sourceRevision }],
    sourceSessionId: null,
    sourceTaskId: null,
    sourceCheckpointId: null,
  })

  for (const ownerType of [
    'checkpoint',
    'task-journal',
    'tool-receipt',
    'receipt-intent',
    'compensation',
    'promotion-rollback',
    'durable-registry',
  ]) {
    await coordinator.createArtifactRoot(root(ownerType, `${ownerType}-owner`, [materialA, materialB]))
  }

  const snapshot = await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId })
  assert.deepEqual(snapshot.materialRefs, [materialA, materialB])
  assert.deepEqual([...new Set(snapshot.rootFence.map(candidate => candidate.ownerType))].sort(), [
    'checkpoint',
    'compensation',
    'durable-registry',
    'project-version',
    'promotion-rollback',
    'receipt-intent',
    'task-journal',
    'tool-receipt',
    'working-draft',
  ])
  for (const candidate of snapshot.rootFence) assert.deepEqual(candidate.materialRefs, [materialA, materialB])
  assert.match(snapshot.snapshotDigest, /^sha256:[\da-f]{64}$/u)
  assert.equal(snapshot.storeFence.length, 8)
})

test('working-draft reconciliation updates materialRefs under the same root key and uses the shared project lock', async () => {
  const backend = new MemoryDashboardStorageBackend({ crypto: webcrypto })
  const lockCalls = []
  const lockManager = {
    request(name, options, operation) {
      lockCalls.push({ name, mode: options.mode })
      return operation({ name, mode: options.mode })
    },
  }
  const coordinator = new ProjectPersistenceCoordinator({ backend, crypto: webcrypto, lockManager })
  await coordinator.commit(commit(0, schemaWithRefs(localRef(materialA))))
  const first = await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId })
  await coordinator.commit(commit(1, schemaWithRefs(localRef(materialB))))

  const storedRoots = (await backend.getAll('artifactRefs')).filter(
    candidate => candidate.ownerType === 'working-draft',
  )
  assert.equal(storedRoots.length, 1)
  assert.deepEqual(storedRoots[0].materialRefs, [materialB])
  const second = await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId })
  assert.deepEqual(second.materialRefs, [materialB])
  assert.notEqual(second.snapshotDigest, first.snapshotDigest)

  const projectLockCalls = lockCalls.filter(call => call.name.includes('project-material-lock:v1:'))
  assert.ok(projectLockCalls.length >= 4)
  assert.equal(new Set(projectLockCalls.map(call => call.name)).size, 1)
  assert.deepEqual(new Set(projectLockCalls.map(call => call.mode)), new Set(['shared']))
})

test('exclusive material GC fence blocks shared commits and provides non-reentrant double snapshots', async () => {
  const backend = new MemoryDashboardStorageBackend({ crypto: webcrypto })
  const blockedShared = deferred()
  const states = new Map()
  const lockCalls = []
  const lockManager = {
    request(name, options, operation) {
      const mode = options.mode
      lockCalls.push({ name, mode })
      const state = states.get(name) ?? { exclusive: false, release: null }
      states.set(name, state)
      if (mode === 'exclusive') {
        assert.equal(state.exclusive, false)
        state.exclusive = true
        state.release = deferred()
        return Promise.resolve()
          .then(() => operation({ name, mode }))
          .finally(() => {
            state.exclusive = false
            state.release.resolve()
          })
      }
      if (!state.exclusive) return operation({ name, mode })
      blockedShared.resolve({ name, mode })
      return state.release.promise.then(() => operation({ name, mode }))
    },
  }
  const coordinator = new ProjectPersistenceCoordinator({ backend, crypto: webcrypto, lockManager })
  await coordinator.commit(commit(0, schemaWithRefs(localRef(materialA))))

  const enteredFence = deferred()
  const continueFence = deferred()
  let escapedReadSnapshot
  const fenced = coordinator.withMaterialGcFence({ schemaVersion: 1, projectId }, async context => {
    assert.equal(context.projectId, projectId)
    escapedReadSnapshot = context.readSnapshot
    const first = await context.readSnapshot()
    enteredFence.resolve()
    await continueFence.promise
    const second = await context.readSnapshot()
    return { first, second }
  })
  await enteredFence.promise

  let commitSettled = false
  const pendingCommit = coordinator.commit(commit(1, schemaWithRefs(localRef(materialB)))).finally(() => {
    commitSettled = true
  })
  const blockedCall = await blockedShared.promise
  assert.equal(commitSettled, false)
  continueFence.resolve()

  const { first, second } = await fenced
  assert.equal(first.snapshotDigest, second.snapshotDigest)
  assert.deepEqual(first.materialRefs, [materialA])
  await pendingCommit
  assert.equal(commitSettled, true)

  const materialLockCalls = lockCalls.filter(call => call.name.includes('project-material-lock:v1:'))
  const exclusiveCall = materialLockCalls.find(call => call.mode === 'exclusive')
  assert.ok(exclusiveCall)
  assert.deepEqual(blockedCall, { name: exclusiveCall.name, mode: 'shared' })
  await assert.rejects(
    () => escapedReadSnapshot(),
    error => error.code === 'validation-failed' && error.reason === 'material-gc-fence-context-is-no-longer-active',
  )
})

test('exclusive material GC fence blocks agent-persistence and receipt-intent writes to snapshot stores', async () => {
  const backend = new MemoryDashboardStorageBackend({ crypto: webcrypto })
  const releaseExclusive = deferred()
  const enteredExclusive = deferred()
  const blockedWrites = deferred()
  let exclusive = false
  let blockedCount = 0
  const lockManager = {
    request(name, options, operation) {
      if (options.mode === 'exclusive') {
        exclusive = true
        return Promise.resolve()
          .then(() => operation({ name, mode: options.mode }))
          .finally(() => {
            exclusive = false
            releaseExclusive.resolve()
          })
      }
      if (!exclusive) return operation({ name, mode: options.mode })
      blockedCount += 1
      if (blockedCount === 2) blockedWrites.resolve()
      return releaseExclusive.promise.then(() => operation({ name, mode: options.mode }))
    },
  }
  const coordinator = new ProjectPersistenceCoordinator({ backend, crypto: webcrypto, lockManager })
  const continueFence = deferred()
  const fenced = coordinator.withMaterialGcFence({ schemaVersion: 1, projectId }, async () => {
    enteredExclusive.resolve()
    await continueFence.promise
  })
  await enteredExclusive.promise

  let persistenceSettled = false
  let intentSettled = false
  const persistenceWrite = coordinator
    .commitAgentPersistence({
      schemaVersion: 1,
      projectId,
      branchId,
      sessionId: 'locked-session',
      batchId: 'locked-agent-persistence',
      expectedPersistenceGeneration: 0,
      records: [],
    })
    .finally(() => {
      persistenceSettled = true
    })
  const intentWrite = coordinator
    .recordReceiptIntent({
      schemaVersion: 1,
      projectId,
      branchId,
      callId: 'locked-intent',
      preparedHash: `sha256:${'8'.repeat(64)}`,
      baseRevision: 'locked-base',
      preImages: { kind: 'generic-pre-image' },
      expectedPostImages: { kind: 'generic-post-image' },
      status: 'pending',
    })
    .finally(() => {
      intentSettled = true
    })

  await blockedWrites.promise
  assert.equal(persistenceSettled, false)
  assert.equal(intentSettled, false)
  continueFence.resolve()
  await Promise.all([fenced, persistenceWrite, intentWrite])
  assert.equal(persistenceSettled, true)
  assert.equal(intentSettled, true)
})

test('material GC fence owns dropped snapshot reads until they settle and propagates delayed failures', async () => {
  const snapshotStarted = deferred()
  const releaseSnapshot = deferred()
  class DelayedFailureBackend extends MemoryDashboardStorageBackend {
    async readMaterialGcStoreSnapshot(requestProjectId) {
      snapshotStarted.resolve()
      await releaseSnapshot.promise
      await super.readMaterialGcStoreSnapshot(requestProjectId)
      throw new Error('delayed-material-snapshot-failure')
    }
  }

  const backend = new DelayedFailureBackend({ crypto: webcrypto })
  let exclusive = false
  const lockManager = {
    request(name, options, operation) {
      if (options.mode !== 'exclusive') return operation({ name, mode: options.mode })
      exclusive = true
      return Promise.resolve()
        .then(() => operation({ name, mode: options.mode }))
        .finally(() => {
          exclusive = false
        })
    },
  }
  const coordinator = new ProjectPersistenceCoordinator({ backend, crypto: webcrypto, lockManager })
  let fenceSettled = false
  const fenced = coordinator
    .withMaterialGcFence({ schemaVersion: 1, projectId }, context => {
      context.readSnapshot()
      return 'callback-complete'
    })
    .finally(() => {
      fenceSettled = true
    })
  await snapshotStarted.promise
  assert.equal(exclusive, true)
  assert.equal(fenceSettled, false)
  releaseSnapshot.resolve()
  await assert.rejects(
    fenced,
    error =>
      error.code === 'integrity-mismatch' &&
      error.reason === 'stored-material-gc-snapshot-contract-is-invalid' &&
      error.cause?.message === 'delayed-material-snapshot-failure',
  )
  assert.equal(exclusive, false)
  assert.equal(fenceSettled, true)
})

const createSharedSnapshotFailureCoordinator = () => {
  const sharedError = new DashboardStorageError('integrity-mismatch', 'shared-material-gc-snapshot-failure')
  const crypto = { subtle: { digest: async () => Promise.reject(sharedError) } }
  return {
    sharedError,
    coordinator: new ProjectPersistenceCoordinator({
      backend: new MemoryDashboardStorageBackend({ crypto: webcrypto }),
      crypto,
    }),
  }
}

test('material GC fence preserves one awaited snapshot error instead of aggregating it twice', async () => {
  const { coordinator, sharedError } = createSharedSnapshotFailureCoordinator()
  let callbackError
  await assert.rejects(
    coordinator.withMaterialGcFence({ schemaVersion: 1, projectId }, async context => {
      try {
        await context.readSnapshot()
      } catch (error) {
        callbackError = error
        throw error
      }
    }),
    error =>
      error === callbackError &&
      error === sharedError &&
      !(error instanceof AggregateError) &&
      error.code === 'integrity-mismatch' &&
      error.reason === 'shared-material-gc-snapshot-failure',
  )
})

test('material GC fence counts two same-error snapshot tasks when the callback awaits one', async () => {
  const { coordinator, sharedError } = createSharedSnapshotFailureCoordinator()
  await assert.rejects(
    coordinator.withMaterialGcFence({ schemaVersion: 1, projectId }, async context => {
      const observed = context.readSnapshot()
      context.readSnapshot()
      await observed
    }),
    error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [sharedError, sharedError])
      return true
    },
  )
})

test('material GC fence aggregates an independent callback error with a snapshot error', async () => {
  const { coordinator, sharedError } = createSharedSnapshotFailureCoordinator()
  const callbackError = new Error('independent-material-gc-callback-failure')
  await assert.rejects(
    coordinator.withMaterialGcFence({ schemaVersion: 1, projectId }, context => {
      context.readSnapshot()
      throw callbackError
    }),
    error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [callbackError, sharedError])
      return true
    },
  )
})

test('material GC fence counts two dropped same-error snapshot tasks independently', async () => {
  const { coordinator, sharedError } = createSharedSnapshotFailureCoordinator()
  await assert.rejects(
    coordinator.withMaterialGcFence({ schemaVersion: 1, projectId }, context => {
      context.readSnapshot()
      context.readSnapshot()
    }),
    error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [sharedError, sharedError])
      return true
    },
  )
})

test('a missing-session generation-conflict persistence checkpoint remains a valid GC fence record', async () => {
  const backend = new MemoryDashboardStorageBackend({ crypto: webcrypto })
  const coordinator = createCoordinator(backend)
  assert.deepEqual(
    await coordinator.commitAgentPersistence({
      schemaVersion: 1,
      projectId,
      branchId,
      sessionId: 'missing-session-conflict',
      batchId: 'missing-session-conflict-batch',
      expectedPersistenceGeneration: 1,
      records: [],
    }),
    {
      schemaVersion: 1,
      batchId: 'missing-session-conflict-batch',
      status: 'generation-conflict',
      persistenceGeneration: 0,
    },
  )

  const snapshot = await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId })
  assert.deepEqual(snapshot.sessionGenerationFence, [])
  assert.equal(snapshot.storeFence.find(fence => fence.store === 'agentCheckpoints').recordCount, 1)
})

const forgedPersistenceCheckpointMutations = [
  ['empty batch id', checkpoint => (checkpoint.batchId = '')],
  ['derived checkpoint id mismatch', checkpoint => (checkpoint.checkpointId = 'forged-checkpoint-id')],
  ['session authority mismatch', checkpoint => (checkpoint.sessionId = 'forged-session')],
  ['result batch authority mismatch', checkpoint => (checkpoint.result.batchId = 'forged-batch')],
  ['unsupported result status', checkpoint => (checkpoint.result.status = 'forged')],
  ['negative result generation', checkpoint => (checkpoint.result.persistenceGeneration = -1)],
  ['rejected result without failure DTO', checkpoint => (checkpoint.result.status = 'rejected')],
  [
    'rejected result with malformed failure DTO',
    checkpoint => {
      checkpoint.result.status = 'rejected'
      checkpoint.result.failure = {
        code: 'persistence-batch-id-reused',
        message: 'forged',
        retryable: false,
        details: null,
      }
    },
  ],
]

for (const [label, mutate] of forgedPersistenceCheckpointMutations) {
  test(`material GC rejects persistence checkpoint with ${label}`, async () => {
    const backend = new MemoryDashboardStorageBackend({ crypto: webcrypto })
    const coordinator = createCoordinator(backend)
    await coordinator.commitAgentPersistence({
      schemaVersion: 1,
      projectId,
      branchId,
      sessionId: `checkpoint-${label}`,
      batchId: `checkpoint-batch-${label}`,
      expectedPersistenceGeneration: 0,
      records: [],
    })
    const checkpoint = (await backend.getAll('agentCheckpoints')).find(record => Object.hasOwn(record, 'requestHash'))
    mutate(checkpoint)
    await coordinator.commit(
      commit(0, schemaWithRefs(), {
        batchId: `overwrite-checkpoint-${label}`,
        operations: [{ type: 'put', store: 'agentCheckpoints', value: checkpoint }],
      }),
    )

    await assert.rejects(
      coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId }),
      error => error.code === 'integrity-mismatch' && error.reason === 'stored-material-gc-authority-is-invalid',
    )
  })
}

test('legacy artifact roots remain readable and are fenced with an explicit empty material set', async () => {
  const backend = new MemoryDashboardStorageBackend({ crypto: webcrypto })
  const coordinator = createCoordinator(backend)
  const legacyRoot = root('checkpoint', 'legacy-root')
  await backend.createArtifactRoot(legacyRoot)

  assert.deepEqual(await coordinator.readArtifactRoot(legacyRoot), legacyRoot)
  const snapshot = await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId })
  assert.deepEqual(snapshot.materialRefs, [])
  assert.deepEqual(snapshot.rootFence, [
    {
      branchId,
      ownerType: 'checkpoint',
      ownerId: 'legacy-root',
      artifactId: source.artifactId,
      sourceRevision: source.sourceRevision,
      materialRefs: [],
    },
  ])
})

test('Memory snapshot clones all root stores atomically and its complete fence exposes a post-clone race', async () => {
  class RacingBackend extends MemoryDashboardStorageBackend {
    raced = false

    async readMaterialGcStoreSnapshot(requestProjectId) {
      const snapshot = await super.readMaterialGcStoreSnapshot(requestProjectId)
      if (!this.raced) {
        this.raced = true
        await super.createArtifactRoot(root('checkpoint', 'raced-after-clone', [materialB]))
      }
      return snapshot
    }
  }

  const backend = new RacingBackend({ crypto: webcrypto })
  await backend.createArtifactRoot(root('checkpoint', 'before-clone', [materialA]))
  const coordinator = createCoordinator(backend)
  const beforeRace = await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId })
  assert.deepEqual(beforeRace.materialRefs, [materialA])
  assert.equal(beforeRace.storeFence.find(fence => fence.store === 'artifactRefs').recordCount, 1)

  const afterRace = await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId })
  assert.deepEqual(afterRace.materialRefs, [materialA, materialB])
  assert.equal(afterRace.storeFence.find(fence => fence.store === 'artifactRefs').recordCount, 2)
  assert.notEqual(afterRace.snapshotDigest, beforeRace.snapshotDigest)
})

test('canonical registry-active, committed, and failed promotion lineages retain only terminal materials', async () => {
  const backend = new MemoryDashboardStorageBackend({ crypto: webcrypto })
  const coordinator = createCoordinator(backend)
  await coordinator.commit(commit(0, schemaWithRefs()))
  const active = await createPromotionFixture({
    callId: 'registry-active',
    sessionId: 'session-registry-active',
    stage: 'registry-active',
  })
  const committed = await createPromotionFixture({
    callId: 'committed',
    sessionId: 'session-committed',
    stage: 'committed',
    material: materialA,
  })
  const failed = await createPromotionFixture({
    callId: 'failed',
    sessionId: 'session-failed',
    stage: 'failed',
    material: materialB,
    draftGeneration: 3,
  })
  await seedPromotionSession(backend, active, [
    { recordId: active.journal.recordId, kind: active.journal.kind, value: active.journal.value },
  ])
  await storeTerminalPromotion(coordinator, backend, committed, 1)
  await storeTerminalPromotion(coordinator, backend, failed, 2)

  const snapshot = await coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId })
  assert.deepEqual(snapshot.materialRefs, [materialA, materialB])
  assert.deepEqual(snapshot.unresolvedPromotionIds, [active.promotionId])
})

const hostilePromotionMutations = [
  ['malformed call', fixture => Object.assign(fixture.journal.value.call, { unexpected: true })],
  [
    'malformed prepare',
    fixture => {
      const { baseMutationVersion: _baseMutationVersion, ...malformed } = fixture.journal.value.prepare
      fixture.journal.value.prepare = malformed
    },
  ],
  ['wrong GeneratedMaterialHost component', fixture => (fixture.journal.value.output.componentName = 'ForgedHost')],
  ['empty node identity', fixture => (fixture.journal.value.call.arguments.nodeId = '')],
  [
    'foreign prepare source revision',
    fixture => (fixture.journal.value.prepare.previousArtifactRef.sourceRevision = 'foreign-source'),
  ],
  ['extra pre-image authority', fixture => (fixture.intent.preImages.projectId = 'foreign-project')],
  ['mismatched pre-image authority', fixture => (fixture.intent.preImages.documentId = 'foreign-document')],
  ['rollback source mismatch', fixture => (fixture.journal.value.server.rollbackTo.sourceRevision = 'foreign-source')],
  [
    'server/output material mismatch',
    fixture => (fixture.journal.value.output.artifactRef.target.materialVersion = '9.9.9'),
  ],
  [
    'missing receipt witness',
    fixture => {
      const { witness: _witness, ...receiptWithoutWitness } = fixture.receipt
      fixture.receipt = receiptWithoutWitness
    },
  ],
  ['wrong receipt witness generation', fixture => (fixture.receipt.witness.draftGeneration += 1)],
  ['zero receipt witness mutation version', fixture => (fixture.receipt.witness.coreMutationVersion = 0)],
  [
    'unadvanced receipt witness mutation version',
    fixture => (fixture.receipt.witness.coreMutationVersion = fixture.journal.value.prepare.baseMutationVersion),
  ],
  [
    'forged receipt witness affected slot',
    fixture => {
      fixture.receipt.witness.affectedSlotTokens[1].slotKey = `${projectId}/${branchId}/${fixture.journal.value.prepare.nodeId}/extras/forged`
      fixture.receipt.witness.affectedSlotTokens.sort((left, right) => left.slotKey.localeCompare(right.slotKey))
    },
  ],
  [
    'extra receipt witness affected slot',
    fixture => {
      fixture.receipt.witness.affectedSlotTokens.push({
        slotKey: `${projectId}/${branchId}/${fixture.journal.value.prepare.nodeId}/extras/forged`,
        token: fixture.receipt.witness.affectedSlotTokens[0].token,
      })
    },
  ],
  ['missing receipt witness affected slot', fixture => fixture.receipt.witness.affectedSlotTokens.pop()],
  [
    'foreign receipt witness slot token',
    fixture => (fixture.receipt.witness.affectedSlotTokens[0].token = 'agent:foreign-call'),
  ],
  ['wrong failure witness code', fixture => (fixture.receipt.witness.failureCode = 'FORGED_FAILURE'), 'failed'],
]

for (const [label, mutate, stage = 'committed'] of hostilePromotionMutations) {
  test(`material GC rejects ${label} without publishing a terminal promotion snapshot`, async () => {
    const backend = new MemoryDashboardStorageBackend({ crypto: webcrypto })
    const coordinator = createCoordinator(backend)
    await coordinator.commit(commit(0, schemaWithRefs()))
    const fixture = structuredClone(
      await createPromotionFixture({ callId: `hostile-${label}`, sessionId: `session-${label}`, stage }),
    )
    mutate(fixture)
    await storeTerminalPromotion(coordinator, backend, fixture, 1)
    await assert.rejects(
      coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId }),
      error => error.code === 'integrity-mismatch' && error.reason === 'stored-material-gc-authority-is-invalid',
    )
  })
}

test('a forged terminal journal cannot resolve a valid prepared promotion and intent', async () => {
  const backend = new MemoryDashboardStorageBackend({ crypto: webcrypto })
  const coordinator = createCoordinator(backend)
  await coordinator.commit(commit(0, schemaWithRefs()))
  const prepared = await createPromotionFixture({
    callId: 'shared-promotion',
    sessionId: 'session-prepared',
    stage: 'prepared',
  })
  await seedPromotionSession(backend, prepared, [
    { recordId: prepared.journal.recordId, kind: prepared.journal.kind, value: prepared.journal.value },
  ])
  await coordinator.recordReceiptIntent(prepared.intent)

  const forged = structuredClone(prepared)
  forged.sessionId = 'session-forged-terminal'
  forged.journal.sessionId = forged.sessionId
  forged.journal.value.stage = 'committed'
  forged.journal.value.call.sessionId = forged.sessionId
  forged.journal.value.server = {
    schemaVersion: 1,
    status: 'active',
    promotionId: forged.promotionId,
    ...materialB,
    rollbackTo: source,
  }
  forged.journal.value.output = {
    schemaVersion: 1,
    kind: 'local-material-promotion-post-images',
    componentName: 'GeneratedMaterialHost',
    nodeId: forged.journal.value.call.arguments.nodeId,
    artifactRef: localRef(materialB),
  }
  forged.receipt = {
    schemaVersion: 1,
    projectId,
    branchId,
    callId: forged.callId,
    status: 'applied',
    revision: 'forged-revision',
  }
  forged.checkpointValue.status = 'applied'
  await storeTerminalPromotion(coordinator, backend, forged, 1)

  await assert.rejects(
    coordinator.readMaterialGcSnapshot({ schemaVersion: 1, projectId }),
    error => error.code === 'integrity-mismatch' && error.reason === 'stored-material-gc-authority-is-invalid',
  )
})
