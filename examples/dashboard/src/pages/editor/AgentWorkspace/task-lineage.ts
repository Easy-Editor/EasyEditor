import type { AgentWorkspaceTaskPhase, AgentWorkspaceTaskProjection } from './types.ts'

const COMPENSATABLE_PHASES = new Set<AgentWorkspaceTaskPhase>(['COMPLETED', 'CANCELLED'])
const TERMINAL_PHASES = new Set<AgentWorkspaceTaskPhase>(['COMPLETED', 'CANCELLED', 'FAILED'])

export interface AgentWorkspaceCompensationControl {
  readonly visible: boolean
  readonly disabled: boolean
}

export interface AgentWorkspaceTaskActionControl {
  readonly pauseVisible: boolean
  readonly resumeVisible: boolean
  readonly cancelVisible: boolean
}

export const isAgentWorkspaceTaskRecoveryLocked = (task: AgentWorkspaceTaskProjection): boolean =>
  task.phase === 'PAUSED' && task.failure?.code === 'APPLIED_UNDURABLE'

export const projectAgentWorkspaceTaskActionControl = (
  task: AgentWorkspaceTaskProjection,
  active: boolean,
): AgentWorkspaceTaskActionControl => {
  const actionVisible = active && !TERMINAL_PHASES.has(task.phase) && !isAgentWorkspaceTaskRecoveryLocked(task)
  return Object.freeze({
    pauseVisible: actionVisible && task.phase !== 'PAUSED',
    resumeVisible: actionVisible && task.phase === 'PAUSED',
    cancelVisible: actionVisible,
  })
}

export const projectAgentWorkspaceCompensationControl = (
  task: AgentWorkspaceTaskProjection,
  activeTaskPhase: AgentWorkspaceTaskPhase | undefined,
): AgentWorkspaceCompensationControl =>
  Object.freeze({
    visible: COMPENSATABLE_PHASES.has(task.phase) && task.compensationEligible,
    disabled: activeTaskPhase !== undefined && !TERMINAL_PHASES.has(activeTaskPhase),
  })
