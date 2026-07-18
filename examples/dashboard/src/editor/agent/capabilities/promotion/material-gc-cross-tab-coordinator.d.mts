export declare const DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE: Readonly<{
  readonly disabled: 'disabled'
  readonly invalidInput: 'invalid-input'
  readonly lockNotGranted: 'lock-not-granted'
  readonly locksUnavailable: 'web-locks-unavailable'
  readonly disposed: 'coordinator-disposed'
}>

/**
 * Required nesting order. The long-lived shared presence lease is lifecycle state, not a lock
 * acquired inside normal operations. Terminal release permanently closes local mutation first,
 * drops its own shared presence lease, then owns presence-exclusive as the outermost transaction
 * authority before entering the remaining locks.
 */
export declare const DASHBOARD_MATERIAL_GC_LOCK_ORDER: Readonly<{
  readonly identity: readonly ['identity-exclusive']
  readonly normalGcOrAdmission: readonly [
    'local-mutation-quiescence',
    'project-material-fence',
    'project-replica-exclusive',
    'server-authority',
  ]
  readonly terminalRelease: readonly [
    'local-mutation-terminal-close',
    'drop-own-shared-presence',
    'project-presence-exclusive',
    'project-material-fence',
    'project-replica-exclusive',
    'server-authority',
  ]
}>

export declare class DashboardMaterialGcCrossTabCoordinatorError extends Error {
  readonly code: (typeof DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE)[keyof typeof DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE]
  readonly reason: string
  constructor(
    code: (typeof DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE)[keyof typeof DASHBOARD_MATERIAL_GC_CROSS_TAB_ERROR_CODE],
    reason: string,
    options?: ErrorOptions,
  )
}

export interface DashboardMaterialGcCrossTabScope {
  readonly projectId: string
  readonly replicaId: string
}

export interface DashboardMaterialGcProjectPresenceScope {
  readonly projectId: string
  readonly replicaId: string
}

export interface DashboardMaterialGcCrossTabLockContext {
  readonly name: string
  readonly mode: 'exclusive'
}

export interface DashboardMaterialGcCrossTabRequestOptions {
  readonly signal?: AbortSignal
}

export interface DashboardMaterialGcProjectPresenceLeaseClosed {
  readonly status: 'released' | 'failed'
  readonly error?: unknown
}

/**
 * `release()` is idempotent. An abrupt browsing-context crash is intentionally not emulated with
 * heartbeats or BroadcastChannel: the browser's Web Locks implementation releases the shared lock
 * when that execution context terminates. `closed` only reports settlement observable by a live
 * context.
 */
export interface DashboardMaterialGcProjectPresenceLease {
  readonly kind: 'dashboard-material-gc-project-presence-lease'
  readonly projectId: string
  readonly replicaId: string
  readonly lockName: string
  readonly released: boolean
  readonly closed: Promise<DashboardMaterialGcProjectPresenceLeaseClosed>
  release(): boolean
}

export type DashboardMaterialGcProjectPresenceExclusiveResult<Result> =
  | Readonly<{
      status: 'acquired'
      projectId: string
      replicaId: string
      lockName: string
      value: Result
    }>
  | Readonly<{
      status: 'in-use'
      projectId: string
      replicaId: string
      lockName: string
    }>
  | Readonly<{
      status: 'unavailable'
      reason: 'disabled' | 'web-locks-unavailable' | 'coordinator-disposed'
    }>

export interface DashboardMaterialGcCrossTabCoordinator {
  readonly enabled: boolean
  withIdentityExclusive<Result>(
    operation: (lock: DashboardMaterialGcCrossTabLockContext) => Result | Promise<Result>,
    options?: DashboardMaterialGcCrossTabRequestOptions,
  ): Promise<Result>
  /** Acquire only after local mutation quiescence and the project material fence. */
  withProjectReplicaExclusive<Result>(
    scope: DashboardMaterialGcCrossTabScope,
    operation: (lock: DashboardMaterialGcCrossTabLockContext) => Result | Promise<Result>,
    options?: DashboardMaterialGcCrossTabRequestOptions,
  ): Promise<Result>
  /** Hold for the full lifetime of one open project tab. */
  acquireProjectPresenceLease(
    scope: DashboardMaterialGcProjectPresenceScope,
    options?: DashboardMaterialGcCrossTabRequestOptions,
  ): Promise<DashboardMaterialGcProjectPresenceLease>
  /**
   * Non-queuing terminal-release authority. Drop this tab's shared presence lease first. The
   * callback is never invoked for `in-use` or `unavailable` outcomes.
   */
  tryWithProjectPresenceExclusive<Result>(
    scope: DashboardMaterialGcProjectPresenceScope,
    operation: (lock: DashboardMaterialGcCrossTabLockContext) => Result | Promise<Result>,
    options?: DashboardMaterialGcCrossTabRequestOptions,
  ): Promise<DashboardMaterialGcProjectPresenceExclusiveResult<Result>>
  /** Orderly teardown releases all leases; browser crash release remains Web Locks authority. */
  dispose(): Promise<boolean>
}

export interface DashboardMaterialGcCrossTabCoordinatorOptions {
  readonly enabled: boolean
  readonly lockManager?: Pick<LockManager, 'request'>
}

export declare const createDashboardMaterialGcCrossTabLockNames: (scope: DashboardMaterialGcCrossTabScope) => Readonly<{
  identity: string
  projectPresence: string
  projectReplica: string
}>

export declare const createDashboardMaterialGcCrossTabCoordinator: (
  options: DashboardMaterialGcCrossTabCoordinatorOptions,
) => DashboardMaterialGcCrossTabCoordinator
