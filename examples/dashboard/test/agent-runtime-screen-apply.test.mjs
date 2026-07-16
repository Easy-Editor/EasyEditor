import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCREEN_APPLY_CHANGESET_FAILURE_CODE,
  ScreenApplyChangeSetError,
  createScreenApplyChangeSetHandler,
} from '../src/editor/agent/capabilities/screen/apply.mjs'

const SHA_PREPARED = `sha256:${'a'.repeat(64)}`
const SHA_TRANSACTION = `sha256:${'b'.repeat(64)}`
const authority = Object.freeze({
  projectId: 'project-a',
  branchId: 'main',
  sessionId: 'session-a',
  taskId: 'task-a',
})

const call = Object.freeze({
  schemaVersion: 1,
  ...authority,
  stepId: 'step-a',
  callId: 'call-a',
  capability: 'screen.applyChangeSet',
  expectedRevision: 'revision-1',
  arguments: {
    schemaVersion: 1,
    documentId: 'document-a',
    operations: [{ opId: 'set-title', type: 'set', nodeId: 'text-a', fieldId: 'props.text', value: 'after' }],
  },
})

const beforeSchema = Object.freeze({
  componentName: 'Root',
  id: 'document-a',
  children: [{ componentName: 'Text', id: 'text-a', props: { text: 'before' } }],
})
const afterSchema = Object.freeze({
  componentName: 'Root',
  id: 'document-a',
  children: [{ componentName: 'Text', id: 'text-a', props: { text: 'after' } }],
})
const affectedFieldSlots = Object.freeze([
  {
    nodeId: 'text-a',
    fieldId: 'props.text',
    root: 'props',
    path: ['text'],
    slotKey: 'project-a/main/text-a/props/text',
    aliases: ['project-a/main/text-a/props', 'project-a/main/text-a/props/text'],
  },
])
const affectedStructuralSlots = Object.freeze([
  { kind: 'node-subtree', nodeId: 'text-a', slotKey: 'project-a/main/node/text-a/subtree' },
])
const affectedSlotKeys = Object.freeze([
  'project-a/main/node/text-a/subtree',
  'project-a/main/text-a/props',
  'project-a/main/text-a/props/text',
])
const inverseOperations = Object.freeze([
  {
    sourceOperationId: 'set-title',
    sourceOperationIndex: 0,
    operation: { opId: 'inverse:set-title', type: 'set', nodeId: 'text-a', fieldId: 'props.text', value: 'before' },
  },
])
const insertedNodeIdentities = Object.freeze([])
const preImages = Object.freeze([
  {
    operationIndex: 0,
    kind: 'field',
    nodeId: 'text-a',
    fieldId: 'props.text',
    root: 'props',
    path: ['text'],
    existed: true,
    value: 'before',
  },
])
const postImages = Object.freeze([
  {
    operationIndex: 0,
    kind: 'field',
    nodeId: 'text-a',
    fieldId: 'props.text',
    root: 'props',
    path: ['text'],
    existed: true,
    value: 'after',
  },
])
const compiled = Object.freeze({
  schemaVersion: 1,
  projectId: authority.projectId,
  branchId: authority.branchId,
  callId: call.callId,
  documentId: call.arguments.documentId,
  baseMutationVersion: 4,
  materialRegistryVersion: 9,
  manifestFingerprints: [],
  insertedNodeIdentities,
  operations: call.arguments.operations,
  commands: [{ type: 'updateProps', documentId: 'document-a', nodeId: 'text-a', props: { text: 'after' } }],
  preImages,
  expectedPostImages: postImages,
  inverseOperations,
  affectedFieldSlots,
  affectedStructuralSlots,
  affectedSlotKeys,
  fingerprintInputs: {
    preparedHash: {
      schemaVersion: 1,
      kind: 'prepared-input',
      insertedNodeIdentities,
      preImages,
      expectedPostImages: postImages,
      inverseOperations,
      affectedFieldSlots,
      affectedStructuralSlots,
      affectedSlotKeys,
    },
    transactionFingerprint: { schemaVersion: 1, kind: 'transaction-input' },
  },
})

class FakeTransactionCommittedError extends Error {}
class FakeTransactionRollbackIncompleteError extends Error {}

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

const createHarness = (overrides = {}) => {
  const events = []
  const documentHandle = Object.freeze({ id: 'bound-document-a' })
  const state = {
    activityGeneration: 3,
    active: false,
    revision: 'revision-1',
    fence: { schemaVersion: 1, documentBindingGeneration: 2, mutationVersion: 4, materialRegistryVersion: 9 },
    mutationVersion: 4,
    schema: structuredClone(beforeSchema),
  }
  let snapshotCount = 0
  let storedIntent = null
  let committedBatch = null
  let recovery = overrides.recovery ?? { classification: 'missing' }

  const dependencies = {
    authority,
    activityLease: {
      waitUntilIdle: async () => {
        events.push('lease:wait')
        return { generation: state.activityGeneration }
      },
      isActive: () => state.active,
      get generation() {
        return state.activityGeneration
      },
    },
    persistence: {
      recoverDurableAgentReceipt: async request => {
        events.push('recover')
        assert.deepEqual(request, { projectId: authority.projectId, branchId: authority.branchId, callId: call.callId })
        return structuredClone(recovery)
      },
      runDurableAgentWrite: async operation => {
        events.push('write:start')
        return operation({
          draft: {
            schemaVersion: 1,
            projectId: authority.projectId,
            branchId: authority.branchId,
            draftGeneration: 0,
          },
          recordIntent: async intent => {
            events.push('intent:record')
            storedIntent = structuredClone(intent)
            overrides.afterRecordIntent?.({ state, intent })
            return structuredClone(intent)
          },
          commitBatch: async batch => {
            events.push('batch:commit')
            committedBatch = structuredClone(batch)
            if (overrides.commitGate) await overrides.commitGate.promise
            if (overrides.commitError) throw overrides.commitError
            return { schemaVersion: 1, status: 'committed', receipt: structuredClone(batch.receipt), draft: {} }
          },
        })
      },
    },
    captureFullSnapshot: async () => {
      snapshotCount += 1
      events.push(`snapshot:${snapshotCount}`)
      return { schemaVersion: 1, revision: state.revision }
    },
    capturePrepareContext: async input => {
      events.push('prepare:capture')
      assert.equal(input.snapshot.revision, state.revision)
      assert.deepEqual(input.changeSet, call.arguments)
      return {
        documentHandle,
        document: { id: 'document-a', mutationVersion: state.mutationVersion, schema: structuredClone(state.schema) },
        materialRegistryVersion: 9,
        manifests: [{ schemaVersion: 1, componentName: 'Text' }],
        fence: structuredClone(state.fence),
      }
    },
    captureCurrentFence: async () => {
      events.push('fence:capture')
      overrides.afterCaptureFence?.({ state })
      return structuredClone(state.fence)
    },
    captureDocumentState: handle => {
      events.push('document:capture')
      assert.equal(handle, documentHandle)
      return { id: 'document-a', mutationVersion: state.mutationVersion, schema: structuredClone(state.schema) }
    },
    captureProject: async () => {
      events.push('project:capture')
      return {
        activeDocument: { documentId: 'document-a', fileName: 'document-a', index: 0 },
        projectSchema: {
          version: '1.0.0',
          componentsTree: [{ ...structuredClone(state.schema), docId: 'document-a', fileName: 'document-a' }],
        },
      }
    },
    compileChangeSet: input => {
      events.push('compile')
      assert.deepEqual(input.changeSet, call.arguments)
      assert.equal(input.expectedMutationVersion, 4)
      return structuredClone(compiled)
    },
    hashCanonicalJson: async input => {
      const kind = input?.kind
      events.push(`hash:${kind}`)
      if (kind === 'screen-apply-change-set-prepared') {
        assert.equal(input.capability, 'screen.applyChangeSet')
        assert.deepEqual(input.preImages.manifestFingerprints, compiled.manifestFingerprints)
        assert.deepEqual(input.preImages.operations, compiled.operations)
        assert.deepEqual(input.preImages.commands, compiled.commands)
        return SHA_PREPARED
      }
      if (kind === 'screen-apply-change-set-transaction') return SHA_TRANSACTION
      throw new Error('unexpected hash input')
    },
    runOnDocument: (handle, commands, options) => {
      events.push('core:run')
      assert.equal(handle, documentHandle)
      assert.deepEqual(commands, compiled.commands)
      assert.deepEqual(options, { agentCallId: call.callId, expectedMutationVersion: 4 })
      const mode = overrides.coreMode ?? 'applied'
      if (
        mode === 'applied' ||
        mode === 'committed-applied' ||
        mode === 'rollback-changed' ||
        mode === 'rollback-incomplete'
      ) {
        state.schema = structuredClone(afterSchema)
        state.mutationVersion = 5
        state.revision = 'revision-2'
        state.fence = { ...state.fence, mutationVersion: 5 }
      }
      if (mode === 'committed-applied' || mode === 'committed-no-change') {
        throw new FakeTransactionCommittedError('observer failed after commit')
      }
      if (mode === 'rollback' || mode === 'rollback-changed') throw new Error('transaction failed and rolled back')
      if (mode === 'rollback-incomplete') throw new FakeTransactionRollbackIncompleteError('rollback incomplete')
      return { status: 'committed' }
    },
    isTransactionCommittedError: error => error instanceof FakeTransactionCommittedError,
    isTransactionRollbackIncompleteError: error => error instanceof FakeTransactionRollbackIncompleteError,
    now: () => 100,
  }

  return {
    events,
    state,
    handler: createScreenApplyChangeSetHandler(dependencies),
    get storedIntent() {
      return storedIntent
    },
    get committedBatch() {
      return committedBatch
    },
    setRecovery(value) {
      recovery = value
    },
  }
}

const expectedPreImagePayload = {
  schemaVersion: 1,
  kind: 'screen-change-set-pre-images',
  documentId: 'document-a',
  baseMutationVersion: 4,
  materialRegistryVersion: 9,
  manifestFingerprints: compiled.manifestFingerprints,
  insertedNodeIdentities,
  operations: compiled.operations,
  commands: compiled.commands,
  images: preImages,
  inverseOperations,
  affectedFieldSlots,
  affectedStructuralSlots,
  affectedSlotKeys,
}

const expectedPostImagePayload = {
  schemaVersion: 1,
  kind: 'screen-change-set-post-images',
  documentId: 'document-a',
  images: postImages,
  affectedFieldSlots,
  affectedStructuralSlots,
  affectedSlotKeys,
}

test('normal apply is recovery-first, persists the frozen prepared intent, and ACKs only after one durable batch', async () => {
  const commitGate = deferred()
  const harness = createHarness({ commitGate })
  let settled = false
  const pending = harness.handler(call).then(result => {
    settled = true
    return result
  })

  await tick()
  assert.equal(settled, false)
  assert.equal(harness.events.at(-1), 'batch:commit')
  commitGate.resolve()
  const result = await pending

  assert.deepEqual(result, { schemaVersion: 1, callId: 'call-a', status: 'applied', revision: 'revision-2' })
  assert.deepEqual(harness.events, [
    'recover',
    'lease:wait',
    'snapshot:1',
    'prepare:capture',
    'compile',
    'hash:screen-apply-change-set-transaction',
    'hash:screen-apply-change-set-prepared',
    'write:start',
    'intent:record',
    'fence:capture',
    'core:run',
    'document:capture',
    'snapshot:2',
    'project:capture',
    'batch:commit',
  ])
  assert.deepEqual(harness.storedIntent, {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: call.callId,
    preparedHash: SHA_PREPARED,
    baseRevision: 'revision-1',
    preImages: expectedPreImagePayload,
    expectedPostImages: expectedPostImagePayload,
    status: 'pending',
  })
  assert.equal(Object.isFrozen(harness.committedBatch.receiptIntent), false, 'test harness stores a detached clone')
  assert.equal(harness.committedBatch.expectedDraftGeneration, 0)
  assert.equal(harness.committedBatch.receipt.status, 'applied')
  assert.equal(harness.committedBatch.witness.transactionFingerprint, SHA_TRANSACTION)
  assert.deepEqual(
    harness.committedBatch.provenance.map(record => [record.slotKey, record.token]),
    affectedSlotKeys.map(slotKey => [slotKey, 'agent:call-a']),
  )
  assert.equal(harness.committedBatch.journal.recordId, 'call:call-a')
  assert.equal(harness.committedBatch.checkpoint.checkpointId, 'call:call-a')
})

test('an existing durable outcome or indeterminate lineage returns before lease, compile, intent, or Core effects', async () => {
  const recoveredReceipt = {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: call.callId,
    status: 'applied',
    revision: 'recovered-revision',
    witness: {
      schemaVersion: 1,
      kind: 'apply',
      draftGeneration: 1,
      coreMutationVersion: 5,
      transactionFingerprint: SHA_TRANSACTION,
      affectedSlotTokens: [],
    },
  }
  const recoveredIntent = {
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: call.callId,
    preparedHash: SHA_PREPARED,
    baseRevision: 'revision-1',
    preImages: expectedPreImagePayload,
    expectedPostImages: expectedPostImagePayload,
    status: 'pending',
  }
  const committed = createHarness({
    recovery: { classification: 'committed', receiptIntent: recoveredIntent, receipt: recoveredReceipt },
  })
  assert.deepEqual(await committed.handler(call), {
    schemaVersion: 1,
    callId: call.callId,
    status: 'applied',
    revision: 'recovered-revision',
  })
  assert.deepEqual(committed.events, [
    'recover',
    'hash:screen-apply-change-set-prepared',
    'hash:screen-apply-change-set-transaction',
  ])

  const indeterminate = createHarness({
    recovery: { classification: 'indeterminate', reason: 'missing-durable-receipt' },
  })
  const result = await indeterminate.handler(call)
  assert.equal(result.status, 'indeterminate')
  assert.equal(result.failure.code, SCREEN_APPLY_CHANGESET_FAILURE_CODE.indeterminateReceipt)
  assert.deepEqual(indeterminate.events, ['recover'])
})

test('normal and committed-error raw-schema outcomes classify applied versus durable NO_CHANGE exactly', async t => {
  for (const [name, coreMode, expectedStatus] of [
    ['normal-applied', 'applied', 'applied'],
    ['normal-no-change', 'no-change', 'not-applied'],
    ['committed-applied', 'committed-applied', 'applied'],
    ['committed-no-change', 'committed-no-change', 'not-applied'],
  ]) {
    await t.test(name, async () => {
      const harness = createHarness({ coreMode })
      const result = await harness.handler(call)
      assert.equal(result.status, expectedStatus)
      if (expectedStatus === 'not-applied') {
        assert.equal(result.failure.code, SCREEN_APPLY_CHANGESET_FAILURE_CODE.noChange)
        assert.equal(harness.committedBatch.witness.failureCode, SCREEN_APPLY_CHANGESET_FAILURE_CODE.noChange)
        assert.deepEqual(harness.committedBatch.provenance, [])
      } else {
        assert.equal(harness.committedBatch.witness.coreMutationVersion, 5)
      }
    })
  }
})

test('rollback-complete terminalizes as not-applied while incomplete or contradictory outcomes stay indeterminate', async t => {
  const rollback = createHarness({ coreMode: 'rollback' })
  const rollbackResult = await rollback.handler(call)
  assert.equal(rollbackResult.status, 'not-applied')
  assert.equal(rollbackResult.failure.code, SCREEN_APPLY_CHANGESET_FAILURE_CODE.coreTransactionFailed)
  assert.equal(rollback.committedBatch.witness.failureCode, SCREEN_APPLY_CHANGESET_FAILURE_CODE.coreTransactionFailed)

  for (const [name, coreMode, code] of [
    ['rollback-incomplete', 'rollback-incomplete', SCREEN_APPLY_CHANGESET_FAILURE_CODE.rollbackIncomplete],
    [
      'rollback-claimed-but-schema-changed',
      'rollback-changed',
      SCREEN_APPLY_CHANGESET_FAILURE_CODE.indeterminateCoreOutcome,
    ],
  ]) {
    await t.test(name, async () => {
      const harness = createHarness({ coreMode })
      const result = await harness.handler(call)
      assert.equal(result.status, 'indeterminate')
      assert.equal(result.failure.code, code)
      assert.equal(harness.committedBatch, null)
      assert.equal(harness.events.includes('snapshot:2'), true)
    })
  }
})

test('post-intent human activity and a changed prepare fence terminalize without executing Core', async t => {
  await t.test('human activity wins', async () => {
    const harness = createHarness({
      afterRecordIntent: ({ state }) => {
        state.activityGeneration += 1
        state.active = true
      },
    })
    const result = await harness.handler(call)
    assert.equal(result.status, 'not-applied')
    assert.equal(result.failure.code, SCREEN_APPLY_CHANGESET_FAILURE_CODE.humanActivity)
    assert.equal(harness.events.includes('core:run'), false)
    assert.equal(harness.committedBatch.witness.failureCode, SCREEN_APPLY_CHANGESET_FAILURE_CODE.humanActivity)
  })

  await t.test('stale document or manifest fence', async () => {
    const harness = createHarness({
      afterRecordIntent: ({ state }) => {
        state.fence = { ...state.fence, materialRegistryVersion: 10 }
      },
    })
    const result = await harness.handler(call)
    assert.equal(result.status, 'not-applied')
    assert.equal(result.failure.code, SCREEN_APPLY_CHANGESET_FAILURE_CODE.staleRevision)
    assert.equal(harness.events.includes('core:run'), false)
    assert.equal(harness.events.includes('fence:capture'), true)
  })

  await t.test('activity immediately after the fence still wins before Core', async () => {
    const harness = createHarness({
      afterCaptureFence: ({ state }) => {
        state.activityGeneration += 1
        state.active = true
      },
    })
    const result = await harness.handler(call)
    assert.equal(result.status, 'not-applied')
    assert.equal(result.failure.code, SCREEN_APPLY_CHANGESET_FAILURE_CODE.humanActivity)
    assert.equal(harness.events.includes('fence:capture'), true)
    assert.equal(harness.events.includes('core:run'), false)
  })
})

test('a durable failure after a Core schema change returns only synthetic APPLIED_UNDURABLE indeterminate evidence', async () => {
  const harness = createHarness({ commitError: new Error('quota') })
  const result = await harness.handler(call)
  assert.equal(result.status, 'indeterminate')
  assert.equal(result.failure.code, SCREEN_APPLY_CHANGESET_FAILURE_CODE.appliedUndurable)
  assert.equal(result.failure.retryable, false)
  assert.equal(result.failure.details.requiredPause, true)
  assert.equal(harness.events.includes('core:run'), true)
  assert.equal(harness.events.at(-1), 'batch:commit')
})

test('hostile accessor-backed calls fail closed without invoking getters or any injected side effect', async () => {
  const harness = createHarness()
  let getterCalls = 0
  const hostile = { ...call }
  Object.defineProperty(hostile, 'arguments', {
    enumerable: true,
    get() {
      getterCalls += 1
      return call.arguments
    },
  })

  await assert.rejects(
    harness.handler(hostile),
    error => error instanceof ScreenApplyChangeSetError && error.code === 'INVALID_CALL',
  )
  assert.equal(getterCalls, 0)
  assert.deepEqual(harness.events, [])
})
