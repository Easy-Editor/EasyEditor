import { projectAgentWorkspaceCompensationControl } from './task-lineage.ts'
import type {
  AgentWorkspaceBlueprintProjection,
  AgentWorkspaceQuestionProjection,
  AgentWorkspaceTaskPhase,
  AgentWorkspaceTaskProjection,
} from './types.ts'

export type AgentConversationTurnState = 'working' | 'waiting' | 'paused' | 'completed' | 'stopped' | 'error'

export interface AgentConversationTurn {
  readonly id: string
  readonly userText: string
  readonly state: AgentConversationTurnState
  readonly stateLabel: string
  readonly active: boolean
  readonly blueprint?: AgentWorkspaceBlueprintProjection
  readonly completionText?: string
  readonly failureText?: string
  readonly question?: AgentWorkspaceQuestionProjection
  readonly canStop: boolean
  readonly canResume: boolean
  readonly canUndo: boolean
}

const projectState = (phase: AgentWorkspaceTaskPhase): Pick<AgentConversationTurn, 'state' | 'stateLabel'> => {
  if (phase === 'WAITING_USER') return { state: 'waiting', stateLabel: '等待回复' }
  if (phase === 'PAUSED') return { state: 'paused', stateLabel: '已暂停' }
  if (phase === 'COMPLETED') return { state: 'completed', stateLabel: '已完成' }
  if (phase === 'CANCELLED') return { state: 'stopped', stateLabel: '已停止' }
  if (phase === 'FAILED') return { state: 'error', stateLabel: '执行失败' }
  return { state: 'working', stateLabel: '正在搭建' }
}

export const projectAgentConversationTurns = (
  tasks: readonly AgentWorkspaceTaskProjection[],
  activeTaskId?: string,
): readonly AgentConversationTurn[] => {
  const activeTaskPhase = tasks.find(task => task.taskId === activeTaskId)?.phase
  return tasks.map(task => {
    const active = task.taskId === activeTaskId
    const state = projectState(task.phase)
    const compensation = projectAgentWorkspaceCompensationControl(task, activeTaskPhase)
    const canStop = active && (state.state === 'working' || state.state === 'waiting' || state.state === 'paused')
    return Object.freeze({
      id: task.taskId,
      userText: task.intent,
      ...state,
      active,
      ...(task.blueprint && !task.completionSummary ? { blueprint: task.blueprint } : {}),
      ...(task.completionSummary ? { completionText: task.completionSummary } : {}),
      ...(task.failure?.message ? { failureText: task.failure.message } : {}),
      ...(task.question ? { question: task.question } : {}),
      canStop,
      canResume: active && state.state === 'paused',
      canUndo: compensation.visible && !compensation.disabled,
    })
  })
}
