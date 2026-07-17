import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveCompensationRunId } from '../src/editor/agent/compensation/index.mjs'
import {
  AgentWorkspaceManualReconciliationRequiredError,
  createDashboardAgentWorkspaceProductionRecoveryBridge,
} from '../src/pages/editor/AgentWorkspace/production-recovery-bridge.mjs'

const binding = Object.freeze({ projectId: 'project-1', branchId: 'main', sessionId: 'session-1' })

const appliedUndurable = Object.freeze({
  schemaVersion: 1,
  kind: 'applied-undurable',
  recoveryId: 'applied-undurable-v1:session-1:task-1:call-1',
  taskId: 'task-1',
  callId: 'call-1',
  occurredAt: 23,
})

const compensationRecord = (overrides = {}) => {
  const { run: runOverrides = {}, ...recordOverrides } = overrides
  const outerCallId = overrides.outerCallId ?? 'compensate-call-1'
  const run = {
    schemaVersion: 1,
    compensationRunId: deriveCompensationRunId({
      projectId: binding.projectId,
      branchId: binding.branchId,
      outerCallId,
    }),
    outerCallId,
    sessionId: binding.sessionId,
    taskId: 'task-target',
    cursor: 2,
    originalCallIds: ['call-a', 'call-b'],
    conflicts: [
      {
        originalCallId: 'call-b',
        inverseCallId: 'inverse-b',
        code: 'POST_IMAGE_CHANGED',
        slotKeys: ['node:z:title', 'node:a:position'],
      },
      {
        originalCallId: 'call-a',
        inverseCallId: 'inverse-a',
        code: 'PROVENANCE_CHANGED',
        slotKeys: ['node:a:position'],
      },
    ],
    status: 'completed-with-conflicts',
    ...runOverrides,
  }
  return Object.freeze({
    schemaVersion: 1,
    ...binding,
    outerCallId,
    writerCallId: outerCallId,
    draftGeneration: 31,
    updatedAt: 1_721_234_567_890,
    run,
    ...recordOverrides,
  })
}

const createHarness = ({ recoveries = [appliedUndurable], records = [compensationRecord()], receipt } = {}) => {
  const calls = []
  const state = { recoveries, records }
  const runtime = {
    getSnapshot() {
      return {
        schemaVersion: 1,
        binding,
        status: 'ready',
        phase: 'PAUSED',
        revision: 1,
        tasks: [],
        recoveries: state.recoveries,
      }
    },
    async resume(taskId) {
      calls.push(['resume', taskId])
    },
  }
  const persistence = {
    async listCompensationRuns(request) {
      calls.push(['list', request])
      return state.records
    },
    async recoverDurableAgentReceipt(request) {
      calls.push(['receipt', request])
      return receipt ?? { classification: 'missing' }
    },
  }
  return {
    bridge: createDashboardAgentWorkspaceProductionRecoveryBridge({ persistence }),
    calls,
    persistence,
    runtime,
    state,
  }
}

test('projects finite Runtime recovery IDs and strictly parsed terminal compensation conflicts', async () => {
  const harness = createHarness()
  const recoveries = await harness.bridge.list({ binding, runtime: harness.runtime })

  assert.deepEqual(
    recoveries.map(recovery => recovery.kind),
    ['applied-undurable', 'compensation-conflict'],
  )
  assert.deepEqual(recoveries[0], {
    kind: 'applied-undurable',
    recoveryId: appliedUndurable.recoveryId,
    taskId: 'task-1',
    callId: 'call-1',
    message: '该调用已应用，但耐久回执尚未确认。系统只会核对精确回执，不会重新执行调用。',
    occurredAt: 23,
  })
  assert.equal('arguments' in recoveries[0], false)
  assert.equal('callIndex' in recoveries[0], false)
  assert.deepEqual(recoveries[1], {
    kind: 'compensation-conflict',
    recoveryId: `compensation-conflict-v1:${encodeURIComponent(compensationRecord().run.compensationRunId)}`,
    taskId: 'task-target',
    message: '补偿已终止并保留 2 处后续修改；这里只能刷新耐久冲突报告，不会再次执行补偿。',
    occurredAt: 1_721_234_567_890,
    conflictPaths: ['node:a:position', 'node:z:title'],
  })
  assert.deepEqual(harness.calls, [['list', { schemaVersion: 1, ...binding }]])
})

test('fails closed when a scoped compensation envelope carries a forged run identity', async () => {
  const forged = compensationRecord({
    run: {
      compensationRunId: deriveCompensationRunId({
        projectId: binding.projectId,
        branchId: binding.branchId,
        outerCallId: 'different-call',
      }),
    },
  })
  const harness = createHarness({ recoveries: [], records: [forged] })
  await assert.rejects(
    harness.bridge.list({ binding, runtime: harness.runtime }),
    /identity does not match its durable envelope/,
  )
})

test('resumes only after exact committed durable receipt evidence and never invokes another authority', async () => {
  const receipt = {
    classification: 'committed',
    receiptIntent: { ...binding, callId: 'call-1' },
    receipt: { ...binding, callId: 'call-1', status: 'applied' },
  }
  const harness = createHarness({ records: [], receipt })
  await harness.bridge.retry({
    binding,
    recoveryId: appliedUndurable.recoveryId,
    kind: 'applied-undurable',
    action: 'retry-durability',
    runtime: harness.runtime,
  })

  assert.deepEqual(harness.calls, [
    ['list', { schemaVersion: 1, ...binding }],
    ['receipt', { projectId: 'project-1', branchId: 'main', callId: 'call-1' }],
    ['resume', 'task-1'],
  ])
})

for (const evidence of [
  { classification: 'missing' },
  { classification: 'indeterminate', reason: 'witness and receipt disagree' },
]) {
  test(`requires manual reconciliation for ${evidence.classification} receipt evidence without resuming`, async () => {
    const harness = createHarness({ records: [], receipt: evidence })
    await assert.rejects(
      harness.bridge.retry({
        binding,
        recoveryId: appliedUndurable.recoveryId,
        kind: 'applied-undurable',
        action: 'retry-durability',
        runtime: harness.runtime,
      }),
      error => {
        assert.ok(error instanceof AgentWorkspaceManualReconciliationRequiredError)
        assert.equal(error.code, 'agent-workspace-manual-reconciliation-required')
        assert.equal(error.classification, evidence.classification)
        assert.equal(error.callId, 'call-1')
        assert.match(error.message, /不会重新执行/)
        return true
      },
    )
    assert.equal(
      harness.calls.some(([operation]) => operation === 'resume'),
      false,
    )
  })
}

test('terminal compensation conflict refresh only re-reads the durable report and remains visible', async () => {
  const record = compensationRecord()
  const harness = createHarness({ recoveries: [], records: [record] })
  const recoveryId = `compensation-conflict-v1:${encodeURIComponent(record.run.compensationRunId)}`

  await harness.bridge.retry({
    binding,
    recoveryId,
    kind: 'compensation-conflict',
    action: 'refresh-conflict-report',
  })
  const refreshed = await harness.bridge.list({ binding })

  assert.equal(
    refreshed.some(recovery => recovery.recoveryId === recoveryId),
    true,
  )
  assert.deepEqual(
    harness.calls.map(([operation]) => operation),
    ['list', 'list'],
  )
  assert.equal(
    harness.calls.some(([operation]) => operation === 'receipt' || operation === 'resume'),
    false,
  )
  await assert.rejects(
    harness.bridge.retry({
      binding,
      recoveryId,
      kind: 'compensation-conflict',
      action: 'retry-compensation',
    }),
    /only support refreshing/,
  )
})
