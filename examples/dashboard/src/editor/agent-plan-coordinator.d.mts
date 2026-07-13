import type { AgentExecutionReceipt, AgentPlanPreview } from '@easy-editor/core'
import type { DashboardAgentPlanSummary } from '../components/ai-chat/agent-plan-summary.mjs'

export interface AgentPlanCoordinatorClock {
  now(): number
  setTimeout(callback: () => void, delay: number): unknown
  clearTimeout(handle: unknown): void
}

export interface AgentPlanAuthority {
  getPreparedPlanPreview(planId: string): AgentPlanPreview
  approveAndExecute(planId: string): AgentExecutionReceipt
}

export interface PreparedAgentPlanProposal {
  readonly proposalId: string
  readonly expiresAt: number
  readonly message: {
    readonly content: string
    readonly role: 'assistant'
  }
  readonly summary: DashboardAgentPlanSummary
}

export interface PreparedAgentPlanCoordinatorInput {
  readonly authority: AgentPlanAuthority
  readonly planId: string
  readonly documentId: string
  readonly proposalId: string
  readonly message: PreparedAgentPlanProposal['message']
  readonly confirmProposal: (
    proposal: PreparedAgentPlanProposal,
    options: { readonly signal: AbortSignal },
  ) => Promise<boolean> | boolean
  readonly signal: AbortSignal
  readonly confirmationTimeoutMs: number
  readonly clock?: AgentPlanCoordinatorClock
}

export declare class AgentPlanCoordinatorError extends Error {
  readonly name: 'AgentPlanCoordinatorError'
  readonly code: string
  constructor(code: string, message: string)
}

export declare const coordinatePreparedAgentPlan: (
  input: PreparedAgentPlanCoordinatorInput,
) => Promise<AgentExecutionReceipt>
