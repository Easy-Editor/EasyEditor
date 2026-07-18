export {
  HumanActivityLease,
  HumanActivityLeaseDisposedError,
  createHumanActivityLease,
  type HumanActivityHold,
  type HumanActivityIdleResult,
  type HumanActivityKind,
  type HumanActivityLeaseOptions,
} from './human-activity-lease.mjs'
export { createDashboardInvocationActivity } from './invocation-activity.mjs'
export type {
  DashboardInvocationActivity,
  DashboardInvocationActivityCall,
  DashboardInvocationActivityInput,
  DashboardInvocationActivitySnapshot,
  DashboardInvocationActivityTarget,
} from './invocation-activity.mjs'
export {
  DashboardMutationQuiescenceGate,
  DashboardMutationQuiescenceGateDisposedError,
  createDashboardMutationQuiescenceGate,
  type DashboardMutationQuiescenceGateOptions,
  type DashboardMutationQuiescenceLease,
  type DashboardMutationQuiescenceSnapshotV1,
} from './mutation-quiescence-gate.mjs'

export interface HumanActivityTrackingOptions {
  readonly lease: import('./human-activity-lease.mjs').HumanActivityLease
  readonly target: EventTarget
}

export declare const installHumanActivityTracking: (options: HumanActivityTrackingOptions) => () => void
