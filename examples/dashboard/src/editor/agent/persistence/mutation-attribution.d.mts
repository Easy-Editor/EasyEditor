export type DashboardObservedMutationSource = 'external' | 'human' | 'unknown'

export interface DashboardObservedMutationAttribution {
  readonly source: DashboardObservedMutationSource
  readonly slotKeys: readonly string[]
  readonly ambiguous?: true
}

export interface DashboardMutationAttributionOptions {
  readonly authority: Readonly<{ projectId: string; branchId: string }>
  readonly isHumanActivityActive: () => boolean
}

export interface DashboardMutationAttribution {
  runAgentMutation<T>(callId: string, operation: () => T): T
  captureFieldMutation(value: unknown): DashboardObservedMutationAttribution | null
  captureBuiltinFieldMutation(node: unknown, key: 'hidden' | 'locked'): DashboardObservedMutationAttribution | null
  captureStructuralMutation(value: unknown, mode?: 'children' | 'node'): DashboardObservedMutationAttribution | null
  captureUnknownMutation(): DashboardObservedMutationAttribution | null
  readonly activeAgentCallId: string | null
}

export declare const DASHBOARD_NODE_ADD_EVENT: 'node:add'
export declare const DASHBOARD_NODE_REMOVE_EVENT: 'node:remove'
export declare const createDashboardMutationAttribution: (
  options: DashboardMutationAttributionOptions,
) => DashboardMutationAttribution
