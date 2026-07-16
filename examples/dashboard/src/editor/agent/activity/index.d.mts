export {
  HumanActivityLease,
  HumanActivityLeaseDisposedError,
  createHumanActivityLease,
  type HumanActivityHold,
  type HumanActivityIdleResult,
  type HumanActivityKind,
  type HumanActivityLeaseOptions,
} from './human-activity-lease.mjs'

export interface HumanActivityTrackingOptions {
  readonly lease: import('./human-activity-lease.mjs').HumanActivityLease
  readonly target: EventTarget
}

export declare const installHumanActivityTracking: (options: HumanActivityTrackingOptions) => () => void
