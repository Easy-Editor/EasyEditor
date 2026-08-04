import assert from 'node:assert/strict'
import test from 'node:test'
import { projectAgentConversationTurns } from './conversation.ts'
import type { AgentWorkspaceTaskProjection } from './types.ts'

const task = (overrides: Partial<AgentWorkspaceTaskProjection> = {}): AgentWorkspaceTaskProjection => ({
  taskId: 'task-1',
  intent: '搭建低空经济运营大屏',
  phase: 'COMPLETED',
  compensationEligible: true,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
})

test('projects completed Runtime tasks into a single plain assistant response', () => {
  const turns = projectAgentConversationTurns(
    [
      task({
        blueprint: {
          title: '搭建方案',
          summary: '补充飞行架次、告警趋势和资源分布。',
          steps: [{ stepId: 'step-1', label: '增加今日飞行架次', status: 'verified' }],
        },
        completionSummary: '低空经济运营大屏已经完成。',
      }),
    ],
    undefined,
  )

  assert.deepEqual(turns, [
    {
      id: 'task-1',
      userText: '搭建低空经济运营大屏',
      state: 'completed',
      stateLabel: '已完成',
      active: false,
      completionText: '低空经济运营大屏已经完成。',
      canStop: false,
      canResume: false,
      canUndo: true,
    },
  ])
})

test('keeps only ordinary Agent actions in the conversation projection', () => {
  const turns = projectAgentConversationTurns(
    [
      task({
        taskId: 'working',
        phase: 'EXECUTE',
        compensationEligible: false,
        question: { questionId: 'question-1', prompt: '是否保留当前配色？' },
      }),
    ],
    'working',
  )

  assert.deepEqual(turns[0], {
    id: 'working',
    userText: '搭建低空经济运营大屏',
    state: 'working',
    stateLabel: '正在搭建',
    active: true,
    question: { questionId: 'question-1', prompt: '是否保留当前配色？' },
    canStop: true,
    canResume: false,
    canUndo: false,
  })
  assert.equal('taskId' in (turns[0] ?? {}), false)
  assert.equal('compensationEligible' in (turns[0] ?? {}), false)
  assert.equal('contextDigest' in (turns[0] ?? {}), false)
})

test('uses plain states for waiting, paused, stopped and failed tasks', () => {
  const turns = projectAgentConversationTurns(
    [
      task({ taskId: 'waiting', phase: 'WAITING_USER', compensationEligible: false }),
      task({ taskId: 'paused', phase: 'PAUSED', compensationEligible: false }),
      task({ taskId: 'stopped', phase: 'CANCELLED', compensationEligible: false }),
      task({
        taskId: 'failed',
        phase: 'FAILED',
        compensationEligible: false,
        failure: { code: 'MODEL_FAILED', message: '模型暂时不可用。', retryable: true },
      }),
    ],
    'paused',
  )

  assert.deepEqual(
    turns.map(turn => [turn.id, turn.state, turn.stateLabel, turn.canResume, turn.failureText]),
    [
      ['waiting', 'waiting', '等待回复', false, undefined],
      ['paused', 'paused', '已暂停', true, undefined],
      ['stopped', 'stopped', '已停止', false, undefined],
      ['failed', 'error', '执行失败', false, '模型暂时不可用。'],
    ],
  )
})
