import type { JsonObject } from './canonical-json.mjs'
import type { StorageCompatibilityMarkerV1 } from './compatibility-marker.mjs'
import type { CanonicalWorkingDraftV1, MigrationStateRecordV1 } from './contracts.mjs'
import type {
  LegacyProjectCandidate,
  LegacyStorageAdapter,
  LegacyStorageDiagnostic,
  LegacyStorageIdentityV1,
} from './legacy-storage.mjs'

export interface LegacyMigrationCommitInput {
  readonly projectId: string
  readonly branchId: string
  readonly expectedDraftGeneration: number
  readonly sourceDraftGeneration: number
  readonly source: 'page-fragments' | 'projectSchema'
  readonly diagnostics: readonly JsonObject[]
  readonly projectSchema: JsonObject
  readonly projectHash: `sha256:${string}`
  readonly activeDocument: LegacyProjectCandidate['activeDocument']
  readonly updatedAt: number
}

export interface LegacyMigrationCoordinator {
  ensureLegacyIdentity(
    input: Readonly<{ legacy: LegacyStorageAdapter; marker: StorageCompatibilityMarkerV1 | null }>,
  ): Promise<
    Readonly<{
      identity: LegacyStorageIdentityV1
      created: boolean
      diagnostic: LegacyStorageDiagnostic | null
    }>
  >
  readWorkingDraft(identity: Readonly<{ projectId: string; branchId: string }>): Promise<CanonicalWorkingDraftV1 | null>
  transitionLegacyMigration(
    input: Readonly<{
      projectId: string
      branchId: string
      legacy: LegacyStorageAdapter
      expectedMarker: StorageCompatibilityMarkerV1 | null
      migration: LegacyMigrationCommitInput | null
      updatedAt: number
    }>,
  ): Promise<
    Readonly<{
      status: 'committed' | 'reconciled'
      draft: CanonicalWorkingDraftV1
    }>
  >
  recordMigrationFailure(
    input: Readonly<{
      projectId: string
      branchId: string
      source: 'legacy-local-storage' | 'page-fragments' | 'projectSchema' | 'unknown'
      sourceDraftGeneration: number
      diagnostics: readonly JsonObject[]
      updatedAt: number
    }>,
  ): Promise<MigrationStateRecordV1>
}

export interface LegacyMigrationResult {
  readonly status: 'already-migrated' | 'migrated' | 'recovered'
  readonly source: 'indexeddb' | 'page-fragments' | 'projectSchema'
  readonly draft: CanonicalWorkingDraftV1
  readonly diagnostics: readonly LegacyStorageDiagnostic[]
}

export declare const migrateLegacyStorage: (
  options: Readonly<{
    legacy: LegacyStorageAdapter
    coordinator: LegacyMigrationCoordinator
    now?: () => number
    readerVersion?: number
  }>,
) => Promise<LegacyMigrationResult>
