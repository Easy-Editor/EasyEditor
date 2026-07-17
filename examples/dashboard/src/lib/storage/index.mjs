export { canonicalJsonStringify, hashCanonicalJson } from './canonical-json.mjs'
export {
  ARTIFACT_CSS_MAX_BYTES,
  ARTIFACT_DIAGNOSTIC_MAX_COUNT,
  ARTIFACT_DIAGNOSTICS_MAX_BYTES,
  ARTIFACT_LOCKED_DEPENDENCY_MAX_COUNT,
  ARTIFACT_PROVENANCE_MAX_BYTES,
  ARTIFACT_RECORD_MAX_BYTES,
  ARTIFACT_SAFE_MANIFEST_MAX_BYTES,
  ARTIFACT_SOURCE_MAX_BYTES,
  cloneFrozenJson,
  createArtifactRevisionKey,
  migrateLegacyNodeArtifactRef,
  normalizeArtifactGenerationFence,
  normalizeArtifactIdentityFence,
  normalizeArtifactRootFence,
  readCanonicalNodeArtifactRef,
  validateArtifactReadRequest,
  validateArtifactRecord,
  validateArtifactRef,
  validateArtifactRootReadRequest,
  validateArtifactRootRecord,
  validateArtifactSourceRevision,
  validateArtifactSweepRequest,
  writeCanonicalNodeArtifactRef,
} from './artifact-contracts.mjs'
export {
  abortPreparedIndexedDbCompatibilityBranchSwitch,
  DASHBOARD_STORAGE_BRANCH_SWITCH_CRASH_POINTS,
  DASHBOARD_STORAGE_BRANCH_SWITCH_KEY,
  prepareIndexedDbCompatibilityBranchSwitch,
  recoverIndexedDbCompatibilityBranchSwitch,
  switchIndexedDbCompatibilityBranch,
} from './branch-switch.mjs'
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
  advanceAgentSessionPersistenceRecord,
  DASHBOARD_AGENT_SESSION_STATUSES,
  DASHBOARD_ARTIFACT_ROOT_OWNER_TYPES,
  DASHBOARD_LOCAL_GRANT_SCOPES,
  normalizeArtifactIdentities,
  normalizeArtifactRootRecord,
  normalizeStoredAgentSessionRecord,
  normalizeStoredArtifactIdentity,
  validateAgentSessionRecord,
  validateLocalGrantRecord,
  validateProjectVersionRecord,
} from './lifecycle.mjs'
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
