import assert from 'node:assert/strict'
import test from 'node:test'
import { projectAgentWorkspaceCompensationControl, projectAgentWorkspaceTaskActionControl } from './task-lineage.ts'
import type { AgentWorkspaceTaskProjection } from './types.ts'

const task = (overrides: Partial<AgentWorkspaceTaskProjection> = {}): AgentWorkspaceTaskProjection => ({
  taskId: 'task-1',
  intent: '搭建大屏',
  phase: 'COMPLETED',
  compensationEligible: true,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
})

test('durable Runtime eligibility alone controls compensation visibility without a checkpoint', () => {
  assert.deepEqual(projectAgentWorkspaceCompensationControl(task(), undefined), {
    visible: true,
    disabled: false,
  })
  assert.deepEqual(projectAgentWorkspaceCompensationControl(task({ compensationEligible: false }), undefined), {
    visible: false,
    disabled: false,
  })
  assert.deepEqual(
    projectAgentWorkspaceCompensationControl(task({ phase: 'FAILED', compensationEligible: true }), undefined),
    { visible: false, disabled: false },
  )
})

test('an active non-terminal task disables otherwise eligible compensation', () => {
  assert.deepEqual(projectAgentWorkspaceCompensationControl(task(), 'EXECUTE'), {
    visible: true,
    disabled: true,
  })
  assert.deepEqual(projectAgentWorkspaceCompensationControl(task(), 'COMPLETED'), {
    visible: true,
    disabled: false,
  })
})

test('APPLIED_UNDURABLE pauses expose only recovery reconciliation, not generic task actions', () => {
  const recoveryLocked = task({
    phase: 'PAUSED',
    failure: {
      code: 'APPLIED_UNDURABLE',
      message: '工具调用已应用，但精确回执尚未持久化。',
      retryable: false,
    },
  })

  assert.deepEqual(projectAgentWorkspaceTaskActionControl(recoveryLocked, true), {
    pauseVisible: false,
    resumeVisible: false,
    cancelVisible: false,
  })
  assert.deepEqual(projectAgentWorkspaceTaskActionControl(task({ phase: 'PAUSED' }), true), {
    pauseVisible: false,
    resumeVisible: true,
    cancelVisible: true,
  })
})
