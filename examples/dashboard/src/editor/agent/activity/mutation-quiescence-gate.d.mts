export interface DashboardMutationQuiescenceLease {
  release(): boolean
}

export interface DashboardMutationQuiescenceSnapshotV1 {
  readonly schemaVersion: 1
  readonly disposed: boolean
  readonly exclusiveActive: boolean
  readonly inputBlocked: boolean
  readonly sharedCount: number
  readonly waitingSharedCount: number
}

export interface DashboardMutationQuiescenceGateOptions {
  readonly inputTarget?: EventTarget
}

export declare class DashboardMutationQuiescenceGateDisposedError extends Error {}

export declare class DashboardMutationQuiescenceGate {
  constructor(options?: DashboardMutationQuiescenceGateOptions)
  acquireShared(): Promise<DashboardMutationQuiescenceLease>
  tryAcquireExclusive(): DashboardMutationQuiescenceLease | null
  isExclusive(): boolean
  getSnapshot(): DashboardMutationQuiescenceSnapshotV1
  dispose(): void
}

export declare const createDashboardMutationQuiescenceGate: (
  options?: DashboardMutationQuiescenceGateOptions,
) => DashboardMutationQuiescenceGate
