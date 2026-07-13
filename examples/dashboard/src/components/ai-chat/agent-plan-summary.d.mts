import type { AgentCommandType, AgentPlanPreview } from '@easy-editor/core'

export interface DashboardAgentOperationSummary {
  readonly type: AgentCommandType
  readonly commandCount: number
  readonly affectedNodeCount: number
}

export interface DashboardAgentPlanSummary {
  readonly commandCount: number
  readonly affectedNodeCount: number
  readonly destructiveCommandCount: number
  readonly operations: readonly DashboardAgentOperationSummary[]
}

export declare const createAgentPlanSummary: (preview: AgentPlanPreview) => DashboardAgentPlanSummary
