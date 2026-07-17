import type { StorageCompatibilityMarkerV1 } from './compatibility-marker.mjs'
import type { CanonicalWorkingDraftV1 } from './contracts.mjs'
import type { LegacyStorageAdapter, LegacyStorageIdentityV1 } from './legacy-storage.mjs'
import type { DashboardProjectVersionRestoreResultV1, DashboardProjectVersionRestoreV1 } from './lifecycle.mjs'

export type DashboardStorageBranchSwitchCrashPoint =
  | 'after-transition-intent'
  | 'after-project-schema'
  | 'after-page-schema'
  | 'after-page-info'
  | 'after-snapshot-metadata'
  | 'after-verification'
  | 'after-compatibility-marker'
  | 'after-active-pointer'
  | 'after-transition-complete'

export interface DashboardStorageBranchSwitchCrashEvent {
  readonly point: DashboardStorageBranchSwitchCrashPoint
  readonly index?: number
  readonly key?: string
}

export interface DashboardStorageBranchFenceV1 {
  readonly projectId: string
  readonly branchId: string
  readonly draftGeneration: number
  readonly projectHash: `sha256:${string}`
}

export interface DashboardStorageBranchSwitchTransitionV1 {
  readonly schemaVersion: 1
  readonly kind: 'version-restore'
  readonly status: 'pending' | 'complete' | 'aborted'
  readonly source: DashboardStorageBranchFenceV1
  readonly target: DashboardStorageBranchFenceV1
  readonly restoreRequest: DashboardProjectVersionRestoreV1
  readonly updatedAt: number
}

export declare const DASHBOARD_STORAGE_BRANCH_SWITCH_KEY: 'easy-editor:storage:branch-switch:v1'
export declare const DASHBOARD_STORAGE_BRANCH_SWITCH_CRASH_POINTS: readonly DashboardStorageBranchSwitchCrashPoint[]

interface BranchSwitchOptions {
  readonly legacy: LegacyStorageAdapter
  readonly now?: () => number
  readonly crashInjector?: (event: DashboardStorageBranchSwitchCrashEvent) => void
  readonly lockManager?: Pick<LockManager, 'request'>
}

export declare const prepareIndexedDbCompatibilityBranchSwitch: (
  options: Readonly<
    BranchSwitchOptions & {
      source: DashboardStorageBranchFenceV1
      target: DashboardStorageBranchFenceV1
      restoreRequest: DashboardProjectVersionRestoreV1
      readDraft(scope: Readonly<{ projectId: string; branchId: string }>): Promise<CanonicalWorkingDraftV1 | null>
    }
  >,
) => Promise<
  Readonly<{
    schemaVersion: 1
    status: 'prepared' | 'reconciled'
    transition: DashboardStorageBranchSwitchTransitionV1
  }>
>

export declare const abortPreparedIndexedDbCompatibilityBranchSwitch: (
  options: Readonly<
    BranchSwitchOptions & {
      restoreRequest: DashboardProjectVersionRestoreV1
      readDraft(scope: Readonly<{ projectId: string; branchId: string }>): Promise<CanonicalWorkingDraftV1 | null>
    }
  >,
) => Promise<
  Readonly<{
    schemaVersion: 1
    status: 'aborted' | 'reconciled'
    transition: DashboardStorageBranchSwitchTransitionV1
  }>
>

export declare const switchIndexedDbCompatibilityBranch: (
  options: Readonly<
    BranchSwitchOptions & {
      draft: CanonicalWorkingDraftV1
      restoreRequest: DashboardProjectVersionRestoreV1
    }
  >,
) => Promise<
  Readonly<{
    schemaVersion: 1
    status: 'reconciled' | 'switched'
    transition: DashboardStorageBranchSwitchTransitionV1
    draft: CanonicalWorkingDraftV1
    marker?: StorageCompatibilityMarkerV1
    identity?: LegacyStorageIdentityV1
  }>
>

export declare const recoverIndexedDbCompatibilityBranchSwitch: (
  options: Readonly<
    BranchSwitchOptions & {
      ensureRestoreTarget(request: DashboardProjectVersionRestoreV1): Promise<DashboardProjectVersionRestoreResultV1>
    }
  >,
) => Promise<
  Readonly<{
    schemaVersion: 1
    status: 'none' | 'aborted' | 'recovered' | 'stable'
    transition?: DashboardStorageBranchSwitchTransitionV1
    draft?: CanonicalWorkingDraftV1
    marker?: StorageCompatibilityMarkerV1
    identity?: LegacyStorageIdentityV1
  }>
>
