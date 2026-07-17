import type {
  ArtifactCreateResultV1,
  ArtifactReadRequestV1,
  ArtifactRecordV1,
  ArtifactRootCreateResultV1,
  ArtifactRootDeleteResultV1,
  ArtifactRootRecordV1,
} from './artifact-contracts.mjs'
import type { JsonObject } from './canonical-json.mjs'
import type { StorageCompatibilityMarkerV1, StringStorageReader } from './compatibility-marker.mjs'
import type {
  CanonicalActiveDocumentV1,
  CanonicalWorkingDraftV1,
  DashboardAgentPersistenceBatchV1,
  DashboardAgentPersistenceCommitResultV1,
  DashboardAgentPersistenceReadRequestV1,
  DashboardAgentPersistenceReadResultV1,
  DashboardCompensationRunListRecordV1,
  DashboardCompensationRunListRequestV1,
  DashboardCompensationRunReadRequestV1,
  DashboardCompensationRunStateCommitV1,
  DashboardCompensationTargetClaimReadRequestV1,
  DashboardDraftCommitKind,
  DashboardMigrationSource,
  DashboardMutationProvenanceReadRequestV1,
  DashboardReceiptIntentV1,
  DashboardReceiptLineageReadRequest,
  DashboardReceiptLineageResult,
  DashboardStorageBackend,
  DashboardStorageOperation,
  DurableProjectCommitResultV1,
  MigrationStateRecordV1,
} from './contracts.mjs'
import type { DashboardStorageDowngradeCrashEvent, DashboardStorageDowngradeResultV1 } from './downgrade.mjs'
import type { LegacyStorageAdapter, LegacyStorageDiagnostic, LegacyStorageIdentityV1 } from './legacy-storage.mjs'
import type {
  DashboardAgentSessionMutationResultV1,
  DashboardAgentSessionRecordV1,
  DashboardAgentSessionSaveV1,
  DashboardAgentSessionScopeV1,
  DashboardArtifactGcDryRunV1,
  DashboardArtifactGcSweepResultV1,
  DashboardArtifactRootEnumerationV1,
  DashboardLocalGrantAuthorizeV1,
  DashboardLocalGrantCheckV1,
  DashboardLocalGrantDecisionV1,
  DashboardLocalGrantListV1,
  DashboardLocalGrantMutationResultV1,
  DashboardLocalGrantRecordV1,
  DashboardLocalGrantRevokeV1,
  DashboardProjectListV1,
  DashboardProjectVersionCreateV1,
  DashboardProjectVersionMutationResultV1,
  DashboardProjectVersionReadV1,
  DashboardProjectVersionRecordV1,
  DashboardProjectVersionRestoreResultV1,
  DashboardProjectVersionRestoreV1,
} from './lifecycle.mjs'

export interface ProjectPersistenceScope {
  readonly projectId: string
  readonly branchId: string
}

export interface ProjectPersistenceCommitV1 extends ProjectPersistenceScope {
  readonly schemaVersion: 1
  readonly batchId: string
  readonly expectedDraftGeneration: number
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly projectSchema: JsonObject
  readonly commitKind: DashboardDraftCommitKind
  readonly updatedAt: number
  readonly operations: readonly DashboardStorageOperation[]
  /** Trusted ABA evidence requests atomic invalidation even when the final project hash is unchanged. */
  readonly forceProvenanceInvalidation?: true
}

export interface ProjectPersistenceCommitResultV1 extends DurableProjectCommitResultV1 {
  readonly draft: CanonicalWorkingDraftV1
}

export interface ProjectPersistenceCompensationRunStateResultV1 {
  readonly schemaVersion: 1
  readonly status: 'committed' | 'resumed'
  readonly run: JsonObject
  readonly draft: CanonicalWorkingDraftV1
}

export interface ProjectPersistenceMutationProvenanceReadResultV1 extends DashboardMutationProvenanceReadRequestV1 {
  readonly records: readonly (JsonObject | null)[]
}

export interface ProjectPersistenceMigrationCommit extends ProjectPersistenceScope {
  readonly expectedDraftGeneration: number
  readonly sourceDraftGeneration: number
  readonly source: DashboardMigrationSource
  readonly diagnostics: readonly JsonObject[]
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly projectSchema: JsonObject
  readonly projectHash: `sha256:${string}`
  readonly updatedAt: number
}

export interface ProjectPersistenceMigrationFailure extends ProjectPersistenceScope {
  readonly source: DashboardMigrationSource
  readonly sourceDraftGeneration: number
  readonly diagnostics: readonly JsonObject[]
  readonly updatedAt: number
}

export interface ProjectPersistenceDowngradeRequest extends ProjectPersistenceScope {
  readonly legacy: LegacyStorageAdapter
  readonly now?: () => number
  readonly crashInjector?: (event: DashboardStorageDowngradeCrashEvent) => void
}

export interface ProjectPersistenceLegacyMigrationTransition extends ProjectPersistenceScope {
  readonly legacy: LegacyStorageAdapter
  readonly expectedMarker: StorageCompatibilityMarkerV1 | null
  readonly migration: ProjectPersistenceMigrationCommit | null
  readonly updatedAt: number
}

export interface ProjectPersistenceLegacyMigrationTransitionResult {
  readonly status: 'committed' | 'reconciled'
  readonly draft: CanonicalWorkingDraftV1
}

export interface ProjectPersistenceIndexedDbBootstrap extends ProjectPersistenceScope {
  readonly legacy: LegacyStorageAdapter
  readonly migration: ProjectPersistenceMigrationCommit | null
  readonly updatedAt: number
}

export declare const createMigrationBatchId: (
  value: Pick<
    ProjectPersistenceMigrationCommit,
    'projectId' | 'branchId' | 'expectedDraftGeneration' | 'sourceDraftGeneration' | 'projectHash'
  >,
) => string

export declare class ProjectPersistenceCoordinator {
  constructor(
    options: Readonly<{
      backend: DashboardStorageBackend
      crypto?: Pick<Crypto, 'subtle'>
      compatibilityStorage?: StringStorageReader
      lockManager?: Pick<LockManager, 'request'>
    }>,
  )
  commit(value: ProjectPersistenceCommitV1): Promise<ProjectPersistenceCommitResultV1>
  commitMigration(value: ProjectPersistenceMigrationCommit): Promise<CanonicalWorkingDraftV1>
  ensureLegacyIdentity(
    value: Readonly<{ legacy: LegacyStorageAdapter; marker: StorageCompatibilityMarkerV1 | null }>,
  ): Promise<
    Readonly<{
      identity: LegacyStorageIdentityV1
      created: boolean
      diagnostic: LegacyStorageDiagnostic | null
    }>
  >
  transitionLegacyMigration(
    value: ProjectPersistenceLegacyMigrationTransition,
  ): Promise<Readonly<ProjectPersistenceLegacyMigrationTransitionResult>>
  bootstrapIndexedDbAuthority(
    value: ProjectPersistenceIndexedDbBootstrap,
  ): Promise<Readonly<ProjectPersistenceLegacyMigrationTransitionResult>>
  recordMigrationState(value: MigrationStateRecordV1): Promise<MigrationStateRecordV1>
  recordMigrationFailure(value: ProjectPersistenceMigrationFailure): Promise<MigrationStateRecordV1>
  readAgentPersistence(value: DashboardAgentPersistenceReadRequestV1): Promise<DashboardAgentPersistenceReadResultV1>
  commitAgentPersistence(value: DashboardAgentPersistenceBatchV1): Promise<DashboardAgentPersistenceCommitResultV1>
  createProjectVersion(value: DashboardProjectVersionCreateV1): Promise<DashboardProjectVersionMutationResultV1>
  getProjectVersion(value: DashboardProjectVersionReadV1): Promise<DashboardProjectVersionRecordV1 | null>
  listProjectVersions(value: DashboardProjectListV1): Promise<readonly DashboardProjectVersionRecordV1[]>
  saveAgentSession(value: DashboardAgentSessionSaveV1): Promise<DashboardAgentSessionMutationResultV1>
  listAgentSessions(value: DashboardAgentSessionScopeV1): Promise<readonly DashboardAgentSessionRecordV1[]>
  resolveAgentSession(value: DashboardAgentSessionScopeV1): Promise<DashboardAgentSessionRecordV1 | null>
  restoreProjectVersion(value: DashboardProjectVersionRestoreV1): Promise<DashboardProjectVersionRestoreResultV1>
  authorizeLocalGrant(value: DashboardLocalGrantAuthorizeV1): Promise<DashboardLocalGrantMutationResultV1>
  checkLocalGrant(value: DashboardLocalGrantCheckV1): Promise<DashboardLocalGrantDecisionV1>
  revokeLocalGrant(value: DashboardLocalGrantRevokeV1): Promise<DashboardLocalGrantMutationResultV1>
  listLocalGrants(value: DashboardLocalGrantListV1): Promise<readonly DashboardLocalGrantRecordV1[]>
  createArtifact(value: ArtifactRecordV1): Promise<ArtifactCreateResultV1>
  readArtifact(value: ArtifactReadRequestV1): Promise<ArtifactRecordV1 | null>
  createArtifactRoot(value: ArtifactRootRecordV1): Promise<ArtifactRootCreateResultV1>
  readArtifactRoot(value: ArtifactRootRecordV1): Promise<ArtifactRootRecordV1 | null>
  deleteArtifactRoot(value: ArtifactRootRecordV1): Promise<ArtifactRootDeleteResultV1>
  enumerateArtifactRoots(value: DashboardProjectListV1): Promise<DashboardArtifactRootEnumerationV1>
  planArtifactGcDryRun(value: DashboardProjectListV1): Promise<DashboardArtifactGcDryRunV1>
  sweepArtifactGc(value: DashboardArtifactGcDryRunV1): Promise<DashboardArtifactGcSweepResultV1>
  recordReceiptIntent(value: DashboardReceiptIntentV1): Promise<DashboardReceiptIntentV1>
  readReceiptLineage(value: DashboardReceiptLineageReadRequest): Promise<DashboardReceiptLineageResult>
  readCompensationRun(value: DashboardCompensationRunReadRequestV1): Promise<JsonObject | null>
  listCompensationRuns(
    value: DashboardCompensationRunListRequestV1,
  ): Promise<readonly DashboardCompensationRunListRecordV1[]>
  readCompensationTargetClaim(value: DashboardCompensationTargetClaimReadRequestV1): Promise<JsonObject | null>
  readMutationProvenance(
    value: DashboardMutationProvenanceReadRequestV1,
  ): Promise<ProjectPersistenceMutationProvenanceReadResultV1>
  commitCompensationRunState(
    value: DashboardCompensationRunStateCommitV1,
  ): Promise<ProjectPersistenceCompensationRunStateResultV1>
  readWorkingDraft(scope: ProjectPersistenceScope): Promise<CanonicalWorkingDraftV1 | null>
  downgradeToLegacy(value: ProjectPersistenceDowngradeRequest): Promise<Readonly<DashboardStorageDowngradeResultV1>>
  flush(scope?: ProjectPersistenceScope): Promise<void>
  dispose(): Promise<void>
}
