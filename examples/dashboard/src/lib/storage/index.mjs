export { canonicalJsonStringify, hashCanonicalJson } from './canonical-json.mjs'
export {
  assertStorageCompatibilityWritable,
  createStorageCompatibilityMarker,
  DASHBOARD_STORAGE_READER_VERSION,
  DASHBOARD_STORAGE_WRITER_VERSION,
  getStorageCompatibilityAccess,
  parseStorageCompatibilityMarker,
  readStorageCompatibilityMarker,
  writeStorageCompatibilityMarker,
} from './compatibility-marker.mjs'
export {
  DASHBOARD_DRAFT_COMMIT_KINDS,
  MEMORY_STORAGE_FAULT_PHASES,
  encodeStorageKey,
  extractStorageRecordKey,
  normalizeStorageKey,
  requireStorageStore,
  validateDurableProjectBatch,
} from './contracts.mjs'
export {
  DASHBOARD_STORAGE_ERROR_CODE,
  DashboardStorageError,
  isDashboardStorageError,
} from './errors.mjs'
export {
  DASHBOARD_STORAGE_DOWNGRADE_CRASH_POINTS,
  materializeLegacyFromCanonical,
  refreshIndexedDbCompatibilitySnapshot,
  selectForwardReentryDraft,
} from './downgrade.mjs'
export {
  IndexedDbDashboardStorageBackend,
  openDashboardStorageDatabase,
} from './indexeddb-backend.mjs'
export {
  createLegacyStorageAdapter,
  ensureLegacyStorageIdentity,
  LEGACY_PAGE_INFO_KEY,
  LEGACY_PAGE_SCHEMA_PREFIX,
  LEGACY_PROJECT_SCHEMA_KEY,
  LEGACY_SNAPSHOT_METADATA_PREFIX,
  legacySnapshotMetadataKey,
  parseLegacyStorageIdentity,
  readLegacyProjectCandidate,
} from './legacy-storage.mjs'
export { MemoryDashboardStorageBackend } from './memory-backend.mjs'
export { migrateLegacyStorage } from './migration.mjs'
export {
  createMigrationBatchId,
  ProjectPersistenceCoordinator,
} from './project-persistence-coordinator.mjs'
export {
  DASHBOARD_STORAGE_COMPATIBILITY_MARKER_KEY,
  DASHBOARD_STORAGE_DATABASE_NAME,
  DASHBOARD_STORAGE_DATABASE_VERSION,
  DASHBOARD_STORAGE_IDENTITY_POINTER_KEY,
  DASHBOARD_STORAGE_STORE_NAMES,
  DASHBOARD_STORAGE_STORES,
  ensureDashboardStorageSchema,
} from './schema.mjs'
