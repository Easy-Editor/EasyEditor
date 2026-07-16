import type { StorageCompatibilityMarkerV1 } from './compatibility-marker.mjs'
import type { CanonicalWorkingDraftV1 } from './contracts.mjs'
import type { LegacyStorageAdapter } from './legacy-storage.mjs'

export type DashboardStorageDowngradeCrashPoint =
  | 'after-active-pointer'
  | 'after-project-schema'
  | 'after-page-schema'
  | 'after-page-info'
  | 'after-snapshot-metadata'
  | 'after-verification'

export interface DashboardStorageDowngradeCrashEvent {
  readonly point: DashboardStorageDowngradeCrashPoint
  readonly index?: number
  readonly key?: string
}

export interface LegacySnapshotMetadataV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly draftGeneration: number
  readonly projectHash: `sha256:${string}`
  readonly updatedAt: number
}

export interface DashboardStorageDowngradeResultV1 {
  readonly status: 'materialized'
  readonly marker: StorageCompatibilityMarkerV1
  readonly metadata: LegacySnapshotMetadataV1
}

export declare const DASHBOARD_STORAGE_DOWNGRADE_CRASH_POINTS: readonly DashboardStorageDowngradeCrashPoint[]

export declare const materializeLegacyFromCanonical: (
  options: Readonly<{
    legacy: LegacyStorageAdapter
    draft: CanonicalWorkingDraftV1
    now?: () => number
    crashInjector?: (event: DashboardStorageDowngradeCrashEvent) => void
    lockManager?: Pick<LockManager, 'request'>
  }>,
) => Promise<Readonly<DashboardStorageDowngradeResultV1>>

export declare const refreshIndexedDbCompatibilitySnapshot: (
  options: Readonly<{
    legacy: LegacyStorageAdapter
    draft: CanonicalWorkingDraftV1
    now?: () => number
    crashInjector?: (event: DashboardStorageDowngradeCrashEvent) => void
    lockManager?: Pick<LockManager, 'request'>
  }>,
) => Promise<
  Readonly<{
    status: 'refreshed'
    marker: StorageCompatibilityMarkerV1
    metadata: LegacySnapshotMetadataV1
  }>
>

export declare const selectForwardReentryDraft: (
  options: Readonly<{
    indexedDbDraft: CanonicalWorkingDraftV1 | null
    legacyDraft: CanonicalWorkingDraftV1 | null
    marker?: StorageCompatibilityMarkerV1 | null
  }>,
) => Readonly<{
  source: 'indexeddb' | 'legacy-local-storage' | null
  draft: CanonicalWorkingDraftV1 | null
}>
