export type StorageCanonicalBackend = 'legacy-local-storage' | 'indexeddb'
export type StorageCompatibilityAccess = 'read-only' | 'read-write'

export interface StorageCompatibilityMarkerV1 {
  readonly schemaVersion: 1
  readonly writerVersion: number
  readonly canonicalBackend: StorageCanonicalBackend
  readonly minReaderVersion: number
  readonly projectId: string
  readonly branchId: string
  readonly draftGeneration: number
  readonly projectHash: `sha256:${string}`
  readonly updatedAt: number
}

export interface StorageCompatibilityMarkerInput {
  readonly writerVersion?: number
  readonly canonicalBackend: StorageCanonicalBackend
  readonly minReaderVersion?: number
  readonly projectId: string
  readonly branchId: string
  readonly draftGeneration: number
  readonly projectHash: `sha256:${string}`
  readonly updatedAt: number
}

export interface StorageCompatibilityDiagnostic {
  readonly code: 'malformed-compatibility-marker'
  readonly key: string
}

export interface StringStorageReader {
  getItem(key: string): string | null
}

export interface StringStorageWriter extends StringStorageReader {
  setItem(key: string, value: string): void
}

export declare const DASHBOARD_STORAGE_READER_VERSION: 1
export declare const DASHBOARD_STORAGE_WRITER_VERSION: 1
export declare const createStorageCompatibilityMarker: (
  value: StorageCompatibilityMarkerInput,
) => StorageCompatibilityMarkerV1
export declare const parseStorageCompatibilityMarker: (raw: unknown) => StorageCompatibilityMarkerV1 | null
export declare const readStorageCompatibilityMarker: (storage: StringStorageReader) => Readonly<{
  marker: StorageCompatibilityMarkerV1 | null
  diagnostic: StorageCompatibilityDiagnostic | null
}>
export declare const getStorageCompatibilityAccess: (
  marker: StorageCompatibilityMarkerV1 | null,
  options?: Readonly<{ readerVersion?: number; writerVersion?: number }>,
) => StorageCompatibilityAccess
export declare const assertStorageCompatibilityWritable: (
  marker: StorageCompatibilityMarkerV1 | null,
  options?: Readonly<{ readerVersion?: number; writerVersion?: number }>,
) => void
export declare const writeStorageCompatibilityMarker: (
  storage: StringStorageWriter,
  value: StorageCompatibilityMarkerInput,
) => StorageCompatibilityMarkerV1
