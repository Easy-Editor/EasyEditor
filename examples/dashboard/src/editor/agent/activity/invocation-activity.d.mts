export interface DashboardInvocationActivityTarget {
  readonly nodeId: string
  readonly label: string
  readonly rect: Readonly<{
    x: number
    y: number
    width: number
    height: number
  }>
}

export interface DashboardInvocationActivityInput {
  readonly callId: string
  readonly capability: string
  readonly taskId: string
  readonly targetNodeIds: readonly string[]
  readonly targets?: readonly DashboardInvocationActivityTarget[]
}

export interface DashboardInvocationActivityCall extends DashboardInvocationActivityInput {
  readonly startedAt: number
  readonly targets: readonly DashboardInvocationActivityTarget[]
}

export interface DashboardInvocationActivitySnapshot {
  readonly revision: number
  readonly activeCalls: readonly DashboardInvocationActivityCall[]
}

export interface DashboardInvocationActivity {
  begin(input: DashboardInvocationActivityInput): () => void
  getSnapshot(): DashboardInvocationActivitySnapshot
  subscribe(listener: () => void): () => void
  dispose(): void
}

export declare const createDashboardInvocationActivity: (options?: {
  readonly now?: () => number
}) => DashboardInvocationActivity
