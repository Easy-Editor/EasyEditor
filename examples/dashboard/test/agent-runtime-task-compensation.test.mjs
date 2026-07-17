import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compensationCursorCheckpointId,
  compensationRunRecordId,
  compensationTargetClaimRecordId,
  createTaskCompensationService,
  deriveCompensationRunId,
  deriveInverseCompensationCallId,
  inspectScreenCompensationSafety,
  parseCompensationRun,
  parseRuntimeTaskCompensationTarget,
  parseScreenCompensationPlan,
  projectCompensationRunReceipt,
} from '../src/editor/agent/compensation/index.mjs'
import {
  commitDurableAgentBatch,
  recordDurableAgentIntent,
} from '../src/editor/agent/persistence/durable-agent-commit.mjs'
import {
  createAgentProvenanceToken,
  createChildrenOrderSlotKey,
  createFieldSlotAliases,
  createFieldSlotKey,
  createMutationProvenanceBatch,
  createNodeExistenceSlotKey,
  createNodeParentSlotKey,
  createNodeSubtreeSlotKey,
} from '../src/editor/agent/persistence/provenance.mjs'
import {
  PersistenceLineageContractError,
  createApplyWitness,
  createFailureWitness,
  createReceiptIntent,
  createToolReceipt,
  createToolReceiptWitness,
} from '../src/editor/agent/persistence/receipt-ledger.mjs'
import { MemoryDashboardStorageBackend, ProjectPersistenceCoordinator } from '../src/lib/storage/index.mjs'

const SHA_A = `sha256:${'a'.repeat(64)}`
const SHA_B = `sha256:${'b'.repeat(64)}`
const scope = Object.freeze({ projectId: 'project-compensation', branchId: 'main', sessionId: 'session-1' })
const projectScope = Object.freeze({ projectId: scope.projectId, branchId: scope.branchId })
const activeDocument = Object.freeze({ documentId: 'page-home', fileName: 'home', index: 0 })
const projectSchema = Object.freeze({
  version: '1.0.0',
  componentsTree: [{ id: 'root', docId: 'page-home', fileName: 'home', componentName: 'Root' }],
})

const target = (callIndex = [{ callId: 'forward-1', capability: 'screen.applyChangeSet' }]) => ({
  schemaVersion: 1,
  taskId: 'task-1',
  sessionId: scope.sessionId,
  phase: 'COMPLETED',
  callIndexComplete: true,
  callIndex,
})

const fieldPlanPayload = ({ callId = 'forward-1', nodeId = 'text-1', before = 'A', after = 'B' } = {}) => {
  const exact = createFieldSlotKey({ ...projectScope, nodeId, root: 'props', path: ['text'] })
  const aliases = createFieldSlotAliases({ ...projectScope, nodeId, root: 'props', path: ['text'] })
  const fieldSlots = [{ nodeId, fieldId: 'props.text', root: 'props', path: ['text'], slotKey: exact, aliases }]
  const preImage = {
    operationIndex: 0,
    kind: 'field',
    nodeId,
    fieldId: 'props.text',
    root: 'props',
    path: ['text'],
    existed: true,
    value: before,
  }
  const postImage = { ...preImage, value: after }
  return {
    callId,
    affectedSlotKeys: [...aliases].sort(),
    preImages: {
      schemaVersion: 1,
      kind: 'screen-change-set-pre-images',
      documentId: 'page-home',
      baseMutationVersion: 4,
      materialRegistryVersion: 2,
      insertedNodeIdentities: [],
      images: [preImage],
      inverseOperations: [
        {
          sourceOperationId: `set-${callId}`,
          sourceOperationIndex: 0,
          operation: { opId: `inverse:set-${callId}`, type: 'set', nodeId, fieldId: 'props.text', value: before },
        },
      ],
      affectedFieldSlots: fieldSlots,
      affectedStructuralSlots: [],
      affectedSlotKeys: [...aliases].sort(),
    },
    expectedPostImages: {
      schemaVersion: 1,
      kind: 'screen-change-set-post-images',
      documentId: 'page-home',
      images: [postImage],
      affectedFieldSlots: fieldSlots,
      affectedStructuralSlots: [],
      affectedSlotKeys: [...aliases].sort(),
    },
  }
}

const structuralPlanPayload = kind => {
  const nodeId = kind === 'create' ? 'created-1' : kind === 'delete' ? 'deleted-1' : 'moved-1'
  const node = { id: nodeId, componentName: 'Text', props: { text: kind } }
  const nodeSlots = [
    { kind: 'node-existence', nodeId, slotKey: createNodeExistenceSlotKey({ ...projectScope, nodeId }) },
    { kind: 'node-parent', nodeId, slotKey: createNodeParentSlotKey({ ...projectScope, nodeId }) },
    { kind: 'node-subtree', nodeId, slotKey: createNodeSubtreeSlotKey({ ...projectScope, nodeId }) },
  ]
  const parentId = kind === 'move' ? 'new-parent' : 'root'
  const orderSlot = {
    kind: 'children-order',
    parentId,
    slotKey: createChildrenOrderSlotKey({ ...projectScope, parentId }),
  }
  const structural = [...nodeSlots, orderSlot]
  const affectedSlotKeys = structural.map(entry => entry.slotKey).sort()
  let preImages
  let postImages
  let inverse
  let identities = []
  if (kind === 'create') {
    preImages = [
      { operationIndex: 0, kind: 'node', nodeId, existed: false, node: null },
      {
        operationIndex: 0,
        kind: 'placement',
        nodeId,
        existed: false,
        parentId: null,
        index: null,
        beforeId: null,
        afterId: null,
      },
    ]
    postImages = [
      { operationIndex: 0, kind: 'node', nodeId, existed: true, node },
      {
        operationIndex: 0,
        kind: 'placement',
        nodeId,
        existed: true,
        parentId,
        index: 0,
        beforeId: null,
        afterId: null,
      },
    ]
    inverse = {
      sourceOperationId: 'create',
      sourceOperationIndex: 0,
      operation: { opId: 'inverse:create', type: 'remove', nodeId },
    }
    identities = [{ opId: 'create', nodeId }]
  } else if (kind === 'delete') {
    preImages = [
      { operationIndex: 0, kind: 'node', nodeId, existed: true, node },
      {
        operationIndex: 0,
        kind: 'placement',
        nodeId,
        existed: true,
        parentId,
        index: 1,
        beforeId: 'before',
        afterId: null,
      },
    ]
    postImages = [
      { operationIndex: 0, kind: 'node', nodeId, existed: false, node: null },
      {
        operationIndex: 0,
        kind: 'placement',
        nodeId,
        existed: false,
        parentId: null,
        index: null,
        beforeId: null,
        afterId: null,
      },
    ]
    inverse = {
      sourceOperationId: 'delete',
      sourceOperationIndex: 0,
      anchors: { beforeId: 'before', afterId: null },
      operation: {
        opId: 'inverse:delete',
        type: 'insert',
        parentId,
        position: { place: 'after', siblingId: 'before' },
        node,
      },
    }
  } else {
    preImages = [
      {
        operationIndex: 0,
        kind: 'placement',
        nodeId,
        existed: true,
        parentId: 'old-parent',
        index: 0,
        beforeId: null,
        afterId: null,
      },
    ]
    postImages = [
      {
        operationIndex: 0,
        kind: 'placement',
        nodeId,
        existed: true,
        parentId,
        index: 0,
        beforeId: null,
        afterId: null,
      },
    ]
    inverse = {
      sourceOperationId: 'move',
      sourceOperationIndex: 0,
      anchors: { beforeId: null, afterId: null },
      operation: { opId: 'inverse:move', type: 'move', nodeId, parentId: 'old-parent', position: { place: 'first' } },
    }
  }
  return {
    affectedSlotKeys,
    preImages: {
      schemaVersion: 1,
      kind: 'screen-change-set-pre-images',
      documentId: 'page-home',
      baseMutationVersion: 4,
      materialRegistryVersion: 2,
      insertedNodeIdentities: identities,
      images: preImages,
      inverseOperations: [inverse],
      affectedFieldSlots: [],
      affectedStructuralSlots: structural,
      affectedSlotKeys,
    },
    expectedPostImages: {
      schemaVersion: 1,
      kind: 'screen-change-set-post-images',
      documentId: 'page-home',
      images: postImages,
      affectedFieldSlots: [],
      affectedStructuralSlots: structural,
      affectedSlotKeys,
    },
  }
}

const observationFor = (payload, overrides = {}) => ({
  schemaVersion: 1,
  documentId: 'page-home',
  images: structuredClone(payload.expectedPostImages.images),
  identityStates: payload.preImages.insertedNodeIdentities.map(({ nodeId }) => ({ nodeId, state: 'matches' })),
  anchorStates: payload.preImages.inverseOperations
    .filter(record => record.anchors !== undefined)
    .map(record => ({ sourceOperationId: record.sourceOperationId, state: 'valid' })),
  ambiguous: false,
  ...overrides,
})

const provenanceFor = (payload, callId) =>
  createMutationProvenanceBatch({
    projectId: scope.projectId,
    branchId: scope.branchId,
    draftGeneration: 7,
    slotKeys: payload.affectedSlotKeys,
    source: 'agent',
    callId,
  })

const safeInput = (payload, callId = 'forward-1') => ({
  originalCallId: callId,
  inverseCallId: 'inverse-1',
  plan: payload,
  observation: observationFor(payload),
  provenanceRecords: provenanceFor(payload, callId),
})

test('strict compensation DTOs reject incomplete indexes, nested compensation, and public raw restore payloads', () => {
  assert.deepEqual(parseRuntimeTaskCompensationTarget(target()), target())
  for (const invalid of [
    { ...target(), callIndexComplete: false },
    { ...target(), callIndex: [...target().callIndex, target().callIndex[0]] },
    { ...target(), callIndex: [{ callId: 'nested', capability: 'task.compensate' }] },
    { ...target(), rawSubtree: { id: 'forged' } },
  ]) {
    assert.throws(() => parseRuntimeTaskCompensationTarget(invalid), PersistenceLineageContractError)
  }

  const first = deriveInverseCompensationCallId({
    projectId: scope.projectId,
    branchId: scope.branchId,
    outerCompensationCallId: 'outer:1',
    originalCallId: 'forward/1',
  })
  assert.equal(
    first,
    deriveInverseCompensationCallId({
      projectId: scope.projectId,
      branchId: scope.branchId,
      outerCompensationCallId: 'outer:1',
      originalCallId: 'forward/1',
    }),
  )
  assert.notEqual(
    first,
    deriveInverseCompensationCallId({
      projectId: scope.projectId,
      branchId: scope.branchId,
      outerCompensationCallId: 'outer:1',
      originalCallId: 'forward:1',
    }),
  )
  assert.throws(
    () =>
      parseCompensationRun({
        ...runningRun(),
        status: 'paused',
        pause: {
          code: 'PROVENANCE_UNCERTAIN',
          resumeSafe: false,
          failure: {
            code: 'PERSISTENCE_FAILURE',
            message: 'mismatch',
            retryable: false,
            details: { resumeSafe: false },
          },
        },
      }),
    PersistenceLineageContractError,
  )
})

test('set/create/move/delete compensation plans require exact post-images, aliases, identities, provenance, and anchors', () => {
  for (const payload of [
    fieldPlanPayload(),
    structuralPlanPayload('create'),
    structuralPlanPayload('move'),
    structuralPlanPayload('delete'),
  ]) {
    assert.equal(
      parseScreenCompensationPlan({
        preImages: payload.preImages,
        expectedPostImages: payload.expectedPostImages,
      }).documentId,
      'page-home',
    )
    assert.deepEqual(inspectScreenCompensationSafety(safeInput(payload)), { status: 'safe' })
  }

  const field = fieldPlanPayload()
  assert.equal(
    inspectScreenCompensationSafety({
      ...safeInput(field),
      provenanceRecords: provenanceFor(field, 'forward-1').map((record, index) =>
        index === 0 ? { ...record, token: 'human' } : record,
      ),
    }).conflict.code,
    'PROVENANCE_CHANGED',
    'away-and-back equality remains unsafe once provenance changed',
  )
  assert.equal(
    inspectScreenCompensationSafety({
      ...safeInput(field),
      provenanceRecords: provenanceFor(field, 'forward-1').slice(1),
    }).conflict.code,
    'PROVENANCE_CHANGED',
    'missing an ancestor alias fails closed',
  )

  const create = structuralPlanPayload('create')
  assert.throws(
    () =>
      parseScreenCompensationPlan({
        preImages: create.preImages,
        expectedPostImages: {
          ...create.expectedPostImages,
          images: [...create.expectedPostImages.images, create.expectedPostImages.images[0]],
        },
      }),
    PersistenceLineageContractError,
  )
  assert.equal(
    inspectScreenCompensationSafety({
      ...safeInput(create),
      observation: observationFor(create, {
        identityStates: [{ nodeId: 'created-1', state: 'reused' }],
      }),
    }).conflict.code,
    'IDENTITY_REUSED',
  )
  assert.equal(
    inspectScreenCompensationSafety({
      ...safeInput(create),
      observation: observationFor(create, {
        identityStates: [{ nodeId: 'created-1', state: 'missing' }],
      }),
    }).conflict.code,
    'POST_IMAGE_CHANGED',
  )

  for (const kind of ['move', 'delete']) {
    const payload = structuralPlanPayload(kind)
    assert.equal(
      inspectScreenCompensationSafety({
        ...safeInput(payload),
        observation: observationFor(payload, {
          anchorStates: [{ sourceOperationId: kind, state: 'invalid' }],
        }),
      }).conflict.code,
      'ANCHOR_INVALID',
    )
  }
})

const runningRun = (outerCallId = 'outer-1', taskId = 'task-1', originalCallIds = ['forward-1']) => ({
  schemaVersion: 1,
  compensationRunId: deriveCompensationRunId({ projectId: scope.projectId, branchId: scope.branchId, outerCallId }),
  outerCallId,
  sessionId: scope.sessionId,
  taskId,
  cursor: 0,
  originalCallIds,
  conflicts: [],
  status: 'running',
})

const seedDraft = coordinator =>
  coordinator.commit({
    schemaVersion: 1,
    batchId: 'seed-draft',
    projectId: scope.projectId,
    branchId: scope.branchId,
    expectedDraftGeneration: 0,
    activeDocument,
    projectSchema,
    commitKind: 'manual-save',
    updatedAt: 1,
    operations: [],
  })

test('coordinator atomically acquires one constant-key run/claim, resumes the same outer call, and rejects a collision', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  await seedDraft(coordinator)
  const run = runningRun()
  const commit = (action, value = run, expectedDraftGeneration = 1) =>
    coordinator.commitCompensationRunState({
      schemaVersion: 1,
      action,
      ...scope,
      outerCallId: value.outerCallId,
      targetTaskId: value.taskId,
      expectedDraftGeneration,
      activeDocument,
      projectSchema,
      updatedAt: expectedDraftGeneration + 10,
      run: value,
    })

  assert.equal((await commit('acquire')).status, 'committed')
  assert.deepEqual(await coordinator.readCompensationRun({ schemaVersion: 1, ...scope, outerCallId: 'outer-1' }), run)
  assert.deepEqual(await coordinator.listCompensationRuns({ schemaVersion: 1, ...scope }), [
    {
      schemaVersion: 1,
      ...scope,
      outerCallId: 'outer-1',
      writerCallId: 'outer-1',
      draftGeneration: 2,
      updatedAt: 11,
      run,
    },
  ])
  assert.deepEqual(
    await coordinator.readCompensationTargetClaim({ schemaVersion: 1, ...scope, targetTaskId: 'task-1' }),
    {
      schemaVersion: 1,
      ...scope,
      targetTaskId: 'task-1',
      outerCallId: 'outer-1',
      status: 'active',
    },
  )
  assert.equal((await commit('acquire', run, 2)).status, 'resumed')
  assert.equal(
    (await coordinator.readWorkingDraft(projectScope)).draftGeneration,
    2,
    'idempotent resume does not advance',
  )

  const competing = runningRun('outer-2')
  await assert.rejects(commit('acquire', competing, 2), /already-claimed/)
  assert.equal(await coordinator.readCompensationRun({ schemaVersion: 1, ...scope, outerCallId: 'outer-2' }), null)

  const completed = { ...run, cursor: 1, status: 'completed' }
  assert.equal((await commit('release', completed, 2)).status, 'committed')
  assert.equal(
    await backend.get('taskJournals', [
      scope.projectId,
      scope.branchId,
      scope.sessionId,
      compensationTargetClaimRecordId('task-1'),
    ]),
    undefined,
  )

  const pausedAfterTerminal = parseCompensationRun({
    ...completed,
    status: 'paused',
    pause: {
      code: 'AMBIGUOUS_RECEIPT',
      resumeSafe: false,
      failure: {
        code: 'AMBIGUOUS_RECEIPT',
        message: 'terminal lineage became indeterminate',
        retryable: false,
        details: { resumeSafe: false },
      },
    },
  })
  assert.equal((await commit('retain', pausedAfterTerminal, 3)).status, 'committed')
  assert.equal(
    (
      await coordinator.readCompensationTargetClaim({
        schemaVersion: 1,
        ...scope,
        targetTaskId: run.taskId,
      })
    ).outerCallId,
    run.outerCallId,
    'fail-closed pause can atomically restore a missing claim',
  )
})

test('exact-key compensation reads reject hostile stored accessors without invoking them', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  await seedDraft(coordinator)
  const originalGet = backend.get.bind(backend)
  let accessorReads = 0
  backend.get = async (store, key) => {
    if (store !== 'taskJournals') return originalGet(store, key)
    const hostile = {
      schemaVersion: 1,
      projectId: scope.projectId,
      branchId: scope.branchId,
      sessionId: scope.sessionId,
      recordId: compensationRunRecordId('outer-hostile'),
      kind: 'compensation-run',
      draftGeneration: 1,
      updatedAt: 1,
      value: runningRun('outer-hostile'),
    }
    Object.defineProperty(hostile, 'callId', {
      enumerable: true,
      get() {
        accessorReads += 1
        return 'outer-hostile'
      },
    })
    return hostile
  }
  await assert.rejects(
    coordinator.readCompensationRun({ schemaVersion: 1, ...scope, outerCallId: 'outer-hostile' }),
    error => error?.code === 'integrity-mismatch',
  )
  assert.equal(accessorReads, 0)
})

test('scoped compensation listing is deterministic and fails closed on a forged compensation namespace', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  await seedDraft(coordinator)
  const run = runningRun('outer-list')
  await coordinator.commitCompensationRunState({
    schemaVersion: 1,
    action: 'acquire',
    ...scope,
    outerCallId: run.outerCallId,
    targetTaskId: run.taskId,
    expectedDraftGeneration: 1,
    activeDocument,
    projectSchema,
    updatedAt: 2,
    run,
  })

  const listed = await coordinator.listCompensationRuns({ schemaVersion: 1, ...scope })
  assert.deepEqual(
    listed.map(record => record.outerCallId),
    ['outer-list'],
  )
  await assert.rejects(
    coordinator.listCompensationRuns({ schemaVersion: 1, ...scope, unknown: true }),
    error => error?.code === 'validation-failed',
  )

  const forgeWriter = record =>
    record.recordId === compensationRunRecordId('outer-list') ? { ...record, callId: 'outer-list-forged' } : record
  const originalGet = backend.get.bind(backend)
  const originalGetAll = backend.getAll.bind(backend)
  backend.get = async (store, key) => {
    const record = await originalGet(store, key)
    return store === 'taskJournals' && record ? forgeWriter(record) : record
  }
  backend.getAll = async store => {
    const records = await originalGetAll(store)
    if (store !== 'taskJournals') return records
    return records.map(forgeWriter)
  }
  await assert.rejects(
    coordinator.readCompensationRun({ schemaVersion: 1, ...scope, outerCallId: 'outer-list' }),
    error => error?.code === 'integrity-mismatch',
  )
  await assert.rejects(
    coordinator.listCompensationRuns({ schemaVersion: 1, ...scope }),
    error => error?.code === 'integrity-mismatch',
  )
})

test('terminal inverse durable batch deletes the target claim atomically with receipt, run cursor, and checkpoint', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  await seedDraft(coordinator)
  const run = runningRun()
  await coordinator.commitCompensationRunState({
    schemaVersion: 1,
    action: 'acquire',
    ...scope,
    outerCallId: run.outerCallId,
    targetTaskId: run.taskId,
    expectedDraftGeneration: 1,
    activeDocument,
    projectSchema,
    updatedAt: 2,
    run,
  })
  const callId = deriveInverseCompensationCallId({
    projectId: scope.projectId,
    branchId: scope.branchId,
    outerCompensationCallId: run.outerCallId,
    originalCallId: 'forward-1',
  })
  const intent = createReceiptIntent({
    schemaVersion: 1,
    projectId: scope.projectId,
    branchId: scope.branchId,
    callId,
    preparedHash: SHA_A,
    baseRevision: 'core:4',
    preImages: [],
    expectedPostImages: [],
    status: 'pending',
  })
  const witness = createFailureWitness({
    schemaVersion: 1,
    projectId: scope.projectId,
    branchId: scope.branchId,
    callId,
    draftGeneration: 3,
    transactionFingerprint: SHA_B,
    receiptStatus: 'not-applied',
    failureCode: 'COMPENSATION_CONFLICT',
  })
  const receipt = createToolReceipt({
    schemaVersion: 1,
    projectId: scope.projectId,
    branchId: scope.branchId,
    callId,
    status: 'not-applied',
    revision: 'core:4',
    witness: createToolReceiptWitness(witness),
    failure: { code: 'COMPENSATION_CONFLICT', message: 'changed', retryable: false },
  })
  const completed = parseCompensationRun({
    ...run,
    cursor: 1,
    conflicts: [
      {
        originalCallId: 'forward-1',
        inverseCallId: callId,
        code: 'PROVENANCE_CHANGED',
        slotKeys: ['slot-1'],
      },
    ],
    status: 'completed-with-conflicts',
  })
  await recordDurableAgentIntent({ coordinator, intent })
  const checkpointId = compensationCursorCheckpointId(completed.compensationRunId, completed.cursor, callId)
  await commitDurableAgentBatch({
    coordinator,
    batch: {
      schemaVersion: 1,
      projectId: scope.projectId,
      branchId: scope.branchId,
      callId,
      expectedDraftGeneration: 2,
      activeDocument,
      projectSchema,
      updatedAt: 3,
      receiptIntent: intent,
      receipt,
      witness,
      provenance: [],
      sessionId: scope.sessionId,
      journal: {
        recordId: compensationRunRecordId(run.outerCallId),
        kind: 'compensation-run',
        value: completed,
      },
      journalDeletes: [compensationTargetClaimRecordId(run.taskId)],
      checkpoint: {
        checkpointId,
        value: {
          schemaVersion: 1,
          compensationRunId: completed.compensationRunId,
          cursor: completed.cursor,
          inverseCallId: callId,
          originalCallId: 'forward-1',
        },
      },
    },
  })
  assert.equal(
    await backend.get('taskJournals', [
      scope.projectId,
      scope.branchId,
      scope.sessionId,
      compensationTargetClaimRecordId(run.taskId),
    ]),
    undefined,
  )
  assert.deepEqual(
    await coordinator.readCompensationRun({ schemaVersion: 1, ...scope, outerCallId: run.outerCallId }),
    completed,
  )
  assert.deepEqual(await coordinator.listCompensationRuns({ schemaVersion: 1, ...scope }), [
    {
      schemaVersion: 1,
      ...scope,
      outerCallId: run.outerCallId,
      writerCallId: callId,
      draftGeneration: 3,
      updatedAt: 3,
      run: completed,
    },
  ])
  assert.deepEqual(
    await backend.get('taskJournals', [
      scope.projectId,
      scope.branchId,
      scope.sessionId,
      compensationRunRecordId(run.outerCallId),
    ]),
    {
      schemaVersion: 1,
      ...scope,
      recordId: compensationRunRecordId(run.outerCallId),
      kind: 'compensation-run',
      callId,
      draftGeneration: 3,
      updatedAt: 3,
      writerCheckpointId: checkpointId,
      value: completed,
    },
  )
  assert.ok(await backend.get('toolReceipts', [scope.projectId, scope.branchId, callId]))
  assert.ok(await backend.get('agentCheckpoints', [scope.projectId, scope.branchId, checkpointId]))

  const originalGet = backend.get.bind(backend)
  const originalGetAll = backend.getAll.bind(backend)
  const forgeInverseWriter = value =>
    value?.recordId === compensationRunRecordId(run.outerCallId)
      ? { ...value, callId: 'forged-nonempty-inverse-writer' }
      : value
  backend.get = async (store, key) => {
    const value = await originalGet(store, key)
    return store === 'taskJournals' ? forgeInverseWriter(value) : value
  }
  backend.getAll = async store => {
    const values = await originalGetAll(store)
    return store === 'taskJournals' ? values.map(forgeInverseWriter) : values
  }
  await assert.rejects(
    coordinator.readCompensationRun({ schemaVersion: 1, ...scope, outerCallId: run.outerCallId }),
    error => error?.code === 'integrity-mismatch',
  )
  await assert.rejects(
    coordinator.listCompensationRuns({ schemaVersion: 1, ...scope }),
    error => error?.code === 'integrity-mismatch',
  )

  backend.get = async (store, key) => {
    const value = await originalGet(store, key)
    if (store !== 'taskJournals' || value?.recordId !== compensationRunRecordId(run.outerCallId)) return value
    const { writerCheckpointId: _legacyMissingPointer, ...legacyV1Record } = value
    return legacyV1Record
  }
  backend.getAll = originalGetAll
  assert.deepEqual(
    await coordinator.readCompensationRun({ schemaVersion: 1, ...scope, outerCallId: run.outerCallId }),
    completed,
    'schemaVersion 1 run heads written before writerCheckpointId derive the same exact checkpoint key',
  )
})

const createFakePersistence = plans => {
  let draft = {
    schemaVersion: 1,
    projectId: scope.projectId,
    branchId: scope.branchId,
    draftGeneration: 1,
    activeDocument,
    projectSchema,
    projectHash: SHA_A,
    commitKind: 'manual-save',
    updatedAt: 1,
  }
  const runs = new Map()
  const claims = new Map()
  const receipts = new Map(
    plans.map(({ callId }) => [callId, { classification: 'committed', receipt: { status: 'applied' } }]),
  )
  const lineages = new Map(
    plans.map(plan => [
      plan.callId,
      {
        projectId: scope.projectId,
        branchId: scope.branchId,
        callId: plan.callId,
        receiptIntent: {
          schemaVersion: 1,
          projectId: scope.projectId,
          branchId: scope.branchId,
          callId: plan.callId,
          preparedHash: SHA_A,
          baseRevision: 'core:4',
          preImages: plan.preImages,
          expectedPostImages: plan.expectedPostImages,
          status: 'pending',
        },
        receipt: {},
        applyWitness: {},
        failureWitness: null,
        provenance: [],
      },
    ]),
  )
  const provenance = new Map(
    plans.flatMap(plan => provenanceFor(plan, plan.callId).map(record => [record.slotKey, record])),
  )
  const persistence = {
    runs,
    claims,
    receipts,
    throwAfterCommitOnce: false,
    indeterminateAfterCommitReason: null,
    claimReadOverride: null,
    recoveryOverrides: new Map(),
    async readCompensationRun({ outerCallId }) {
      return structuredClone(runs.get(outerCallId) ?? null)
    },
    async readCompensationTargetClaim({ targetTaskId }) {
      const claim = structuredClone(claims.get(targetTaskId) ?? null)
      return typeof persistence.claimReadOverride === 'function'
        ? structuredClone(persistence.claimReadOverride({ targetTaskId, claim }))
        : claim
    },
    async commitCompensationRunState(input) {
      const existing = claims.get(input.targetTaskId)
      if (input.action === 'acquire' && existing && existing.outerCallId !== input.outerCallId)
        throw new Error('claimed')
      if (input.action === 'acquire' && !existing) {
        claims.set(input.targetTaskId, {
          schemaVersion: 1,
          ...scope,
          targetTaskId: input.targetTaskId,
          outerCallId: input.outerCallId,
          status: 'active',
        })
      }
      if (input.action === 'retain' && !existing) {
        claims.set(input.targetTaskId, {
          schemaVersion: 1,
          ...scope,
          targetTaskId: input.targetTaskId,
          outerCallId: input.outerCallId,
          status: 'active',
        })
      }
      runs.set(input.outerCallId, structuredClone(input.run))
      if (input.action === 'release') claims.delete(input.targetTaskId)
      draft = { ...draft, draftGeneration: draft.draftGeneration + 1, updatedAt: input.updatedAt }
      return {
        schemaVersion: 1,
        status: 'committed',
        run: structuredClone(input.run),
        draft,
        compatibilityWarning: null,
      }
    },
    async recoverDurableAgentReceipt({ callId }) {
      return structuredClone(
        persistence.recoveryOverrides.get(callId) ?? receipts.get(callId) ?? { classification: 'missing' },
      )
    },
    async runDurableAgentWrite(operation) {
      return operation({
        draft: structuredClone(draft),
        async readReceiptLineage({ callId }) {
          return structuredClone(lineages.get(callId))
        },
        async readMutationProvenance({ slotKeys }) {
          return {
            schemaVersion: 1,
            ...scope,
            slotKeys,
            records: slotKeys.map(slotKey => structuredClone(provenance.get(slotKey) ?? null)),
          }
        },
        async recordIntent(intent) {
          return structuredClone(intent)
        },
        async commitBatch(batch) {
          receipts.set(batch.callId, {
            classification: batch.receipt.status === 'applied' ? 'committed' : 'failed',
            receipt: structuredClone(batch.receipt),
          })
          runs.set(batch.journal.value.outerCallId, structuredClone(batch.journal.value))
          for (const recordId of batch.journalDeletes ?? []) {
            if (recordId === compensationTargetClaimRecordId(batch.journal.value.taskId))
              claims.delete(batch.journal.value.taskId)
          }
          for (const record of batch.provenance) provenance.set(record.slotKey, structuredClone(record))
          draft = {
            ...draft,
            draftGeneration: draft.draftGeneration + 1,
            activeDocument: batch.activeDocument,
            projectSchema: batch.projectSchema,
            updatedAt: batch.updatedAt,
          }
          if (persistence.throwAfterCommitOnce) {
            persistence.throwAfterCommitOnce = false
            if (persistence.indeterminateAfterCommitReason !== null) {
              persistence.recoveryOverrides.set(batch.callId, {
                classification: 'indeterminate',
                reason: persistence.indeterminateAfterCommitReason,
              })
              persistence.indeterminateAfterCommitReason = null
            }
            throw new Error('simulated-ack-loss-after-atomic-commit')
          }
          return { schemaVersion: 1, status: 'committed', receipt: batch.receipt, draft, compatibilityWarning: null }
        },
      })
    },
  }
  return persistence
}

const inverseExecutor = executionOrder => ({
  async prepare(input) {
    executionOrder.push(input.originalCallId)
    const intent = createReceiptIntent({
      schemaVersion: 1,
      projectId: scope.projectId,
      branchId: scope.branchId,
      callId: input.inverseCallId,
      preparedHash: SHA_A,
      baseRevision: `draft:${input.draft.draftGeneration}`,
      preImages: [],
      expectedPostImages: [],
      status: 'pending',
    })
    return {
      receiptIntent: intent,
      async execute() {
        const draftGeneration = input.draft.draftGeneration + 1
        if (input.kind === 'conflict' || input.kind === 'empty') {
          const failureCode = input.kind === 'empty' ? 'NO_CHANGE' : 'COMPENSATION_CONFLICT'
          const witness = createFailureWitness({
            schemaVersion: 1,
            projectId: scope.projectId,
            branchId: scope.branchId,
            callId: input.inverseCallId,
            draftGeneration,
            transactionFingerprint: SHA_B,
            receiptStatus: 'not-applied',
            failureCode,
          })
          return {
            activeDocument,
            projectSchema,
            receipt: createToolReceipt({
              schemaVersion: 1,
              projectId: scope.projectId,
              branchId: scope.branchId,
              callId: input.inverseCallId,
              status: 'not-applied',
              revision: `draft:${draftGeneration}`,
              witness: createToolReceiptWitness(witness),
              failure: { code: failureCode, message: failureCode, retryable: false },
            }),
            witness,
            provenance: [],
            updatedAt: draftGeneration,
          }
        }
        const provenance = createMutationProvenanceBatch({
          projectId: scope.projectId,
          branchId: scope.branchId,
          draftGeneration,
          slotKeys: input.plan.affectedSlotKeys,
          source: 'agent',
          callId: input.inverseCallId,
        })
        const witness = createApplyWitness({
          schemaVersion: 1,
          projectId: scope.projectId,
          branchId: scope.branchId,
          callId: input.inverseCallId,
          draftGeneration,
          coreMutationVersion: draftGeneration,
          transactionFingerprint: SHA_B,
          affectedSlotTokens: provenance.map(({ slotKey, token }) => ({ slotKey, token })),
        })
        return {
          activeDocument,
          projectSchema,
          receipt: createToolReceipt({
            schemaVersion: 1,
            projectId: scope.projectId,
            branchId: scope.branchId,
            callId: input.inverseCallId,
            status: 'applied',
            revision: `draft:${draftGeneration}`,
            witness: createToolReceiptWitness(witness),
          }),
          witness,
          provenance,
          updatedAt: draftGeneration,
        }
      },
    }
  },
})

test('service plans applied receipts in reverse order, resumes a running cursor, and releases the claim at terminal commit', async () => {
  const plans = [
    fieldPlanPayload({ callId: 'forward-1', nodeId: 'text-1', before: 'A', after: 'B' }),
    fieldPlanPayload({ callId: 'forward-2', nodeId: 'text-2', before: 'C', after: 'D' }),
  ]
  const persistence = createFakePersistence(plans)
  const executionOrder = []
  const observer = {
    async observe({ originalCallId }) {
      const plan = plans.find(entry => entry.callId === originalCallId)
      return observationFor(plan)
    },
  }
  const service = createTaskCompensationService({
    ...scope,
    persistence,
    observer,
    inverseExecutor: inverseExecutor(executionOrder),
    now: () => 10,
  })
  const receipt = await service.compensate({
    schemaVersion: 1,
    outerCallId: 'outer-service',
    target: target([
      { callId: 'forward-1', capability: 'screen.applyChangeSet' },
      { callId: 'read-only', capability: 'screen.inspect' },
      { callId: 'forward-2', capability: 'screen.applyChangeSet' },
    ]),
  })
  assert.equal(receipt.status, 'applied')
  assert.equal(Object.hasOwn(receipt, 'revision'), false)
  assert.deepEqual(executionOrder, ['forward-2', 'forward-1'])
  assert.equal(persistence.claims.has('task-1'), false)
  assert.equal(persistence.runs.get('outer-service').status, 'completed')
  assert.equal((await service.query({ schemaVersion: 1, outerCallId: 'outer-service' })).status, 'applied')

  const resumedPlan = [fieldPlanPayload({ callId: 'forward-resume', nodeId: 'resume-1' })]
  const resumedPersistence = createFakePersistence(resumedPlan)
  const resumedRun = runningRun('outer-resume', 'task-1', ['forward-resume'])
  resumedPersistence.runs.set('outer-resume', resumedRun)
  resumedPersistence.claims.set('task-1', {
    schemaVersion: 1,
    ...scope,
    targetTaskId: 'task-1',
    outerCallId: 'outer-resume',
    status: 'active',
  })
  const resumedOrder = []
  const resumedService = createTaskCompensationService({
    ...scope,
    persistence: resumedPersistence,
    observer: {
      async observe() {
        return observationFor(resumedPlan[0])
      },
    },
    inverseExecutor: inverseExecutor(resumedOrder),
  })
  const resumedReceipt = await resumedService.compensate({
    schemaVersion: 1,
    outerCallId: 'outer-resume',
    target: target([{ callId: 'forward-resume', capability: 'screen.applyChangeSet' }]),
  })
  assert.equal(resumedReceipt.status, 'applied')
  assert.deepEqual(resumedOrder, ['forward-resume'])
})

for (const scenario of [
  {
    name: 'restart after run acquisition and before the first inverse batch',
    cursor: 0,
    completedOriginalCallIds: [],
    expectedExecutionOrder: ['forward-restart-2', 'forward-restart-1'],
  },
  {
    name: 'restart after the first inverse batch committed and before its ACK',
    cursor: 1,
    completedOriginalCallIds: ['forward-restart-2'],
    expectedExecutionOrder: ['forward-restart-1'],
  },
]) {
  test(`two-inverse durable ${scenario.name} resumes from the next unconfirmed cursor`, async () => {
    const outerCallId = `outer-restart-${scenario.cursor}`
    const plans = [
      fieldPlanPayload({ callId: 'forward-restart-1', nodeId: 'restart-node-1', before: 'A', after: 'B' }),
      fieldPlanPayload({ callId: 'forward-restart-2', nodeId: 'restart-node-2', before: 'C', after: 'D' }),
    ]
    const reverseOriginalCallIds = plans.map(plan => plan.callId).reverse()
    const persistence = createFakePersistence(plans)
    persistence.runs.set(outerCallId, {
      ...runningRun(outerCallId, 'task-1', reverseOriginalCallIds),
      cursor: scenario.cursor,
    })
    persistence.claims.set('task-1', {
      schemaVersion: 1,
      ...scope,
      targetTaskId: 'task-1',
      outerCallId,
      status: 'active',
    })
    for (const originalCallId of scenario.completedOriginalCallIds) {
      const inverseCallId = deriveInverseCompensationCallId({
        projectId: scope.projectId,
        branchId: scope.branchId,
        outerCompensationCallId: outerCallId,
        originalCallId,
      })
      persistence.receipts.set(inverseCallId, { classification: 'committed', receipt: { status: 'applied' } })
    }
    const executionOrder = []
    const serviceAfterRestart = createTaskCompensationService({
      ...scope,
      persistence,
      observer: {
        async observe({ originalCallId }) {
          return observationFor(plans.find(plan => plan.callId === originalCallId))
        },
      },
      inverseExecutor: inverseExecutor(executionOrder),
    })

    const receipt = await serviceAfterRestart.compensate({
      schemaVersion: 1,
      outerCallId,
      target: target(plans.map(plan => ({ callId: plan.callId, capability: 'screen.applyChangeSet' }))),
    })

    assert.equal(receipt.status, 'applied')
    assert.deepEqual(executionOrder, scenario.expectedExecutionOrder)
    assert.equal(persistence.runs.get(outerCallId).cursor, 2)
    assert.equal(persistence.runs.get(outerCallId).status, 'completed')
    assert.equal(persistence.claims.has('task-1'), false)
    for (const originalCallId of reverseOriginalCallIds) {
      const inverseCallId = deriveInverseCompensationCallId({
        projectId: scope.projectId,
        branchId: scope.branchId,
        outerCompensationCallId: outerCallId,
        originalCallId,
      })
      assert.equal(persistence.receipts.get(inverseCallId).classification, 'committed')
    }
  })
}

test('beforeInverse runs for every real inverse before entering the serialized durable writer', async () => {
  const plan = fieldPlanPayload({ callId: 'forward-before-inverse', nodeId: 'before-inverse-1' })
  const persistence = createFakePersistence([plan])
  const originalRunWrite = persistence.runDurableAgentWrite.bind(persistence)
  let insideWriter = false
  persistence.runDurableAgentWrite = operation =>
    originalRunWrite(async session => {
      insideWriter = true
      try {
        return await operation(session)
      } finally {
        insideWriter = false
      }
    })
  const calls = []
  const service = createTaskCompensationService({
    ...scope,
    persistence,
    beforeInverse(input) {
      assert.equal(insideWriter, false)
      calls.push(input)
    },
    observer: { observe: async () => observationFor(plan) },
    inverseExecutor: inverseExecutor([]),
  })
  await service.compensate({
    schemaVersion: 1,
    outerCallId: 'outer-before-inverse',
    target: target([{ callId: plan.callId, capability: 'screen.applyChangeSet' }]),
  })
  assert.deepEqual(calls, [
    {
      schemaVersion: 1,
      ...scope,
      outerCallId: 'outer-before-inverse',
      originalCallId: plan.callId,
      inverseCallId: deriveInverseCompensationCallId({
        projectId: scope.projectId,
        branchId: scope.branchId,
        outerCompensationCallId: 'outer-before-inverse',
        originalCallId: plan.callId,
      }),
    },
  ])
})

test('a safe inverse that durably returns non-applied advances only with a conservative conflict', async () => {
  const plan = fieldPlanPayload({ callId: 'forward-stale-inverse', nodeId: 'stale-inverse-1' })
  const persistence = createFakePersistence([plan])
  const baseExecutor = inverseExecutor([])
  const service = createTaskCompensationService({
    ...scope,
    persistence,
    observer: { observe: async () => observationFor(plan) },
    inverseExecutor: {
      async prepare(input) {
        const prepared = await baseExecutor.prepare(input)
        return {
          receiptIntent: prepared.receiptIntent,
          async execute() {
            const draftGeneration = input.draft.draftGeneration + 1
            const witness = createFailureWitness({
              schemaVersion: 1,
              ...projectScope,
              callId: input.inverseCallId,
              draftGeneration,
              transactionFingerprint: SHA_B,
              receiptStatus: 'not-applied',
              failureCode: 'STALE_REVISION',
            })
            return {
              activeDocument,
              projectSchema,
              receipt: createToolReceipt({
                schemaVersion: 1,
                ...projectScope,
                callId: input.inverseCallId,
                status: 'not-applied',
                revision: `draft:${draftGeneration}`,
                witness: createToolReceiptWitness(witness),
                failure: { code: 'STALE_REVISION', message: 'stale', retryable: false },
              }),
              witness,
              provenance: [],
              updatedAt: draftGeneration,
            }
          },
        }
      },
    },
  })
  const receipt = await service.compensate({
    schemaVersion: 1,
    outerCallId: 'outer-stale-inverse',
    target: target([{ callId: plan.callId, capability: 'screen.applyChangeSet' }]),
  })
  const run = persistence.runs.get('outer-stale-inverse')
  assert.equal(receipt.status, 'applied')
  assert.equal(run.status, 'completed-with-conflicts')
  assert.equal(run.cursor, 1)
  assert.deepEqual(run.conflicts, [
    {
      originalCallId: plan.callId,
      inverseCallId: deriveInverseCompensationCallId({
        projectId: scope.projectId,
        branchId: scope.branchId,
        outerCompensationCallId: 'outer-stale-inverse',
        originalCallId: plan.callId,
      }),
      code: 'AMBIGUOUS',
      slotKeys: plan.affectedSlotKeys,
    },
  ])
})

test('inverse ACK loss recovers the atomic cursor advance without replaying the effect', async () => {
  const plan = fieldPlanPayload({ callId: 'forward-ack-loss', nodeId: 'ack-loss-1' })
  const persistence = createFakePersistence([plan])
  persistence.throwAfterCommitOnce = true
  const executionOrder = []
  const service = createTaskCompensationService({
    ...scope,
    persistence,
    observer: {
      async observe() {
        return observationFor(plan)
      },
    },
    inverseExecutor: inverseExecutor(executionOrder),
  })
  const receipt = await service.compensate({
    schemaVersion: 1,
    outerCallId: 'outer-ack-loss',
    target: target([{ callId: plan.callId, capability: 'screen.applyChangeSet' }]),
  })
  assert.equal(receipt.status, 'applied')
  assert.deepEqual(executionOrder, ['forward-ack-loss'])
  assert.equal(persistence.runs.get('outer-ack-loss').status, 'completed')
  assert.equal(persistence.claims.has('task-1'), false)
})

test('indeterminate ACK-loss recovery durably pauses the advanced run and restores its claim', async () => {
  const plan = fieldPlanPayload({ callId: 'forward-ack-indeterminate', nodeId: 'ack-indeterminate-1' })
  const persistence = createFakePersistence([plan])
  const outerCallId = 'outer-ack-indeterminate'
  persistence.throwAfterCommitOnce = true
  persistence.indeterminateAfterCommitReason = 'malformed inverse lineage'
  const executionOrder = []
  const service = createTaskCompensationService({
    ...scope,
    persistence,
    observer: {
      async observe() {
        return observationFor(plan)
      },
    },
    inverseExecutor: inverseExecutor(executionOrder),
  })
  const receipt = await service.compensate({
    schemaVersion: 1,
    outerCallId,
    target: target([{ callId: plan.callId, capability: 'screen.applyChangeSet' }]),
  })
  assert.equal(receipt.status, 'indeterminate')
  assert.equal(receipt.failure.code, 'AMBIGUOUS_RECEIPT')
  assert.equal(receipt.failure.details.resumeSafe, false)
  assert.deepEqual(executionOrder, [plan.callId])
  assert.equal(persistence.runs.get(outerCallId).status, 'paused')
  assert.equal(persistence.runs.get(outerCallId).cursor, 1, 'pause never regresses the atomically stored cursor')
  assert.equal(persistence.claims.get('task-1').outerCallId, outerCallId)
})

test('running compensation revalidates the exact target claim before every inverse and durably pauses on loss', async () => {
  const plan = fieldPlanPayload({ callId: 'forward-claim-loss', nodeId: 'claim-loss-1' })
  const persistence = createFakePersistence([plan])
  let claimReads = 0
  persistence.claimReadOverride = ({ targetTaskId, claim }) => {
    claimReads += 1
    if (claimReads !== 3) return claim
    persistence.claims.delete(targetTaskId)
    return null
  }
  const executionOrder = []
  const service = createTaskCompensationService({
    ...scope,
    persistence,
    observer: {
      async observe() {
        return observationFor(plan)
      },
    },
    inverseExecutor: inverseExecutor(executionOrder),
  })
  const receipt = await service.compensate({
    schemaVersion: 1,
    outerCallId: 'outer-claim-loss',
    target: target([{ callId: plan.callId, capability: 'screen.applyChangeSet' }]),
  })
  assert.equal(receipt.status, 'indeterminate')
  assert.equal(receipt.failure.code, 'PERSISTENCE_FAILURE')
  assert.deepEqual(executionOrder, [])
  assert.equal(persistence.runs.get('outer-claim-loss').status, 'paused')
  assert.equal(persistence.claims.get('task-1').outerCallId, 'outer-claim-loss')
})

test('resume pauses on a foreign target claim and rejects a forged stable run identity', async () => {
  const plan = fieldPlanPayload({ callId: 'forward-resume-claim', nodeId: 'resume-claim-1' })
  const persistence = createFakePersistence([plan])
  const run = runningRun('outer-resume-claim', 'task-1', [plan.callId])
  persistence.runs.set(run.outerCallId, run)
  persistence.claims.set(run.taskId, {
    schemaVersion: 1,
    ...scope,
    targetTaskId: run.taskId,
    outerCallId: 'outer-foreign',
    status: 'active',
  })
  const service = createTaskCompensationService({
    ...scope,
    persistence,
    observer: {
      async observe() {
        return observationFor(plan)
      },
    },
    inverseExecutor: inverseExecutor([]),
  })
  const receipt = await service.compensate({
    schemaVersion: 1,
    outerCallId: run.outerCallId,
    target: target([{ callId: plan.callId, capability: 'screen.applyChangeSet' }]),
  })
  assert.equal(receipt.failure.code, 'PERSISTENCE_FAILURE')
  assert.equal(persistence.runs.get(run.outerCallId).status, 'paused')
  assert.equal(persistence.claims.get(run.taskId).outerCallId, 'outer-foreign', 'foreign ownership is never stolen')

  const forgedPersistence = createFakePersistence([plan])
  forgedPersistence.runs.set(run.outerCallId, { ...run, compensationRunId: 'forged-run-id' })
  forgedPersistence.claims.set(run.taskId, {
    schemaVersion: 1,
    ...scope,
    targetTaskId: run.taskId,
    outerCallId: run.outerCallId,
    status: 'active',
  })
  const forgedService = createTaskCompensationService({
    ...scope,
    persistence: forgedPersistence,
    observer: {
      async observe() {
        return observationFor(plan)
      },
    },
    inverseExecutor: inverseExecutor([]),
  })
  await assert.rejects(
    forgedService.compensate({
      schemaVersion: 1,
      outerCallId: run.outerCallId,
      target: target([{ callId: plan.callId, capability: 'screen.applyChangeSet' }]),
    }),
    PersistenceLineageContractError,
  )
})

test('malformed observation pauses durably as provenance-uncertain and retains the claim', async () => {
  const plan = fieldPlanPayload({ callId: 'forward-uncertain', nodeId: 'uncertain-1' })
  const persistence = createFakePersistence([plan])
  const service = createTaskCompensationService({
    ...scope,
    persistence,
    observer: {
      async observe() {
        return { schemaVersion: 1 }
      },
    },
    inverseExecutor: inverseExecutor([]),
  })
  const receipt = await service.compensate({
    schemaVersion: 1,
    outerCallId: 'outer-uncertain',
    target: target([{ callId: plan.callId, capability: 'screen.applyChangeSet' }]),
  })
  assert.equal(receipt.status, 'indeterminate')
  assert.equal(receipt.failure.code, 'PROVENANCE_UNCERTAIN')
  assert.equal(receipt.failure.details.resumeSafe, false)
  assert.equal(persistence.runs.get('outer-uncertain').status, 'paused')
  assert.equal(persistence.claims.has('task-1'), true)
  assert.equal(
    (await service.query({ schemaVersion: 1, outerCallId: 'outer-uncertain' })).failure.code,
    'PROVENANCE_UNCERTAIN',
  )
})

test('running and paused query projections expose exact resume safety', () => {
  const running = runningRun()
  const runningReceipt = projectCompensationRunReceipt({
    projectId: scope.projectId,
    branchId: scope.branchId,
    run: running,
  })
  assert.equal(runningReceipt.failure.code, 'COMPENSATION_IN_PROGRESS')
  assert.equal(runningReceipt.failure.details.resumeSafe, true)

  const paused = parseCompensationRun({
    ...running,
    status: 'paused',
    pause: {
      code: 'PROVENANCE_UNCERTAIN',
      resumeSafe: false,
      failure: {
        code: 'PROVENANCE_UNCERTAIN',
        message: 'ambiguous',
        retryable: false,
        details: { resumeSafe: false },
      },
    },
  })
  const pausedReceipt = projectCompensationRunReceipt({
    projectId: scope.projectId,
    branchId: scope.branchId,
    run: paused,
  })
  assert.equal(pausedReceipt.status, 'indeterminate')
  assert.equal(pausedReceipt.failure.details.resumeSafe, false)
})
