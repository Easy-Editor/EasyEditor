export declare class AgentPlanConfirmationSlot {
  get pendingProposalId(): string | undefined
  request(proposalId: string, signal: AbortSignal): Promise<boolean>
  approve(proposalId: string): boolean
  reject(proposalId: string): boolean
  cancel(code?: string): boolean
}
