import type { JsonObject } from './canonical-json.mjs'
import type {
  StorageCompatibilityDiagnostic,
  StorageCompatibilityMarkerInput,
  StorageCompatibilityMarkerV1,
  StringStorageWriter,
} from './compatibility-marker.mjs'
import type { CanonicalActiveDocumentV1 } from './contracts.mjs'

export declare const LEGACY_PROJECT_SCHEMA_KEY: 'projectSchema'
export declare const LEGACY_PAGE_INFO_KEY: 'pageInfo'
export declare const LEGACY_PAGE_SCHEMA_PREFIX: 'pageSchema:'
export declare const LEGACY_SNAPSHOT_METADATA_PREFIX: 'easy-editor:storage:legacy-snapshot:v1:'

export interface LegacyStorageIdentityV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
}

export interface LegacyStorageDiagnostic extends JsonObject {
  readonly code: string
  readonly key: string
  readonly [key: string]: string | number
}

export interface LegacyProjectCandidate {
  readonly status: 'invalid' | 'missing' | 'ready'
  readonly source: 'page-fragments' | 'projectSchema' | null
  readonly projectSchema: JsonObject | null
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly diagnostics: readonly LegacyStorageDiagnostic[]
}

export interface LegacyStorageAdapter {
  ensureIdentity(marker?: StorageCompatibilityMarkerV1 | null): Readonly<{
    identity: LegacyStorageIdentityV1
    created: boolean
    diagnostic: LegacyStorageDiagnostic | null
  }>
  inspectCompatibilityMarker(): Readonly<{
    marker: StorageCompatibilityMarkerV1 | null
    diagnostic: StorageCompatibilityDiagnostic | null
  }>
  writeCompatibilityMarker(marker: StorageCompatibilityMarkerInput): StorageCompatibilityMarkerV1
  readProjectCandidate(): LegacyProjectCandidate
  readValue(key: string): string | null
  writeValue(key: string, value: string): void
}

export declare const parseLegacyStorageIdentity: (raw: unknown) => LegacyStorageIdentityV1 | null
export declare const ensureLegacyStorageIdentity: (
  storage: StringStorageWriter,
  options?: Readonly<{
    compatibilityMarker?: StorageCompatibilityMarkerV1 | null
    createProjectId?: () => string
  }>,
) => Readonly<{
  identity: LegacyStorageIdentityV1
  created: boolean
  diagnostic: LegacyStorageDiagnostic | null
}>
export declare const readLegacyProjectCandidate: (storage: StringStorageWriter) => LegacyProjectCandidate
export declare const legacySnapshotMetadataKey: (identity: Readonly<{ projectId: string; branchId: string }>) => string
export declare const createLegacyStorageAdapter: (
  storage: StringStorageWriter,
  options?: Readonly<{ createProjectId?: () => string }>,
) => LegacyStorageAdapter
