export type HumanActivityKind = 'pointer' | 'keyboard'

export interface HumanActivityIdleResult {
  readonly generation: number
}

export interface HumanActivityHold {
  renew(): number
  release(): boolean
}

export interface HumanActivityLeaseOptions {
  readonly idleMs?: number
  readonly now?: () => number
  readonly setTimer?: (callback: () => void, delay: number) => unknown
  readonly clearTimer?: (timer: unknown) => void
}

export declare class HumanActivityLeaseDisposedError extends Error {
  readonly name: 'HumanActivityLeaseDisposedError'
}

export declare class HumanActivityLease {
  constructor(options?: HumanActivityLeaseOptions)
  recordActivity(kind: HumanActivityKind): number
  acquire(kind: HumanActivityKind): HumanActivityHold
  isActive(): boolean
  waitUntilIdle(): Promise<HumanActivityIdleResult>
  dispose(): void
  readonly generation: number
  readonly disposed: boolean
}

export declare const createHumanActivityLease: (options?: HumanActivityLeaseOptions) => HumanActivityLease
