import type {
  ArtifactCreateResultV1,
  ArtifactReadRequestV1,
  ArtifactRecordV1,
  ArtifactRootCreateResultV1,
  ArtifactRootDeleteResultV1,
  ArtifactRootRecordV1,
  ArtifactSweepBackendResultV1,
  ArtifactSweepRequestV1,
} from './artifact-contracts.mjs'
import type { JsonObject, JsonValue } from './canonical-json.mjs'
import type { DashboardStorageStoreName } from './schema.mjs'

export type DashboardDraftCommitKind =
  | 'migration'
  | 'autosave'
  | 'manual-save'
  | 'agent-batch'
  | 'named-version'
  | 'session-lifecycle'
  | 'local-grant'
  | 'version-restore'

export type MemoryStorageFaultPhase = 'before-cas' | 'after-cas' | 'after-operation' | 'before-commit'
export type DashboardMigrationSource =
  | 'projectSchema'
  | 'page-fragments'
  | 'legacy-local-storage'
  | 'indexeddb'
  | 'unknown'

export interface CanonicalActiveDocumentV1 {
  readonly documentId: string
  readonly fileName: string
  readonly index: number
}

export interface CanonicalWorkingDraftV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly draftGeneration: number
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly projectSchema: JsonObject
  readonly projectHash: `sha256:${string}`
  readonly commitKind: DashboardDraftCommitKind
  readonly updatedAt: number
}

export type DashboardStorageRecordKey = string | number | readonly (string | number)[]
export type DashboardAdditionalStore = Exclude<DashboardStorageStoreName, 'workingDrafts'>

export interface DashboardStoragePutOperation {
  readonly type: 'put'
  readonly store: DashboardAdditionalStore
  readonly value: JsonObject
  readonly mode?: 'put' | 'add'
}

export interface DashboardStorageDeleteOperation {
  readonly type: 'delete'
  readonly store: DashboardAdditionalStore
  readonly key: DashboardStorageRecordKey
}

export interface DashboardInvalidateAgentProvenanceOperation {
  readonly type: 'invalidate-agent-provenance'
  readonly store: 'mutationProvenance'
  /** Bypass the same-project-hash optimization when trusted mutation evidence proves an ABA-capable edit. */
  readonly force?: true
}

export type DashboardStorageOperation = DashboardStoragePutOperation | DashboardStorageDeleteOperation
export type DashboardDurableStorageOperation = DashboardStorageOperation | DashboardInvalidateAgentProvenanceOperation

export interface DurableProjectBatchV1 {
  readonly schemaVersion: 1
  readonly batchId: string
  readonly projectId: string
  readonly branchId: string
  readonly expectedDraftGeneration: number
  readonly draft: CanonicalWorkingDraftV1
  readonly operations: readonly DashboardDurableStorageOperation[]
}

export interface DurableProjectCommitResultV1 {
  readonly schemaVersion: 1
  readonly batchId: string
  readonly status: 'committed'
  readonly draftGeneration: number
}

export interface MigrationStateRecordV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly status: 'draft-committed' | 'failed'
  readonly source: DashboardMigrationSource
  readonly sourceDraftGeneration: number
  readonly targetGeneration: number | null
  readonly diagnostics: readonly JsonObject[]
  readonly updatedAt: number
}

export interface DashboardAgentPersistenceReadRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly expectedPersistenceGeneration: number
}

export interface DashboardAgentPersistenceRecordV1 {
  readonly recordId: string
  readonly kind: string
  readonly value: JsonValue
}

export interface DashboardAgentPersistenceBatchV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly batchId: string
  readonly expectedPersistenceGeneration: number
  readonly records: readonly DashboardAgentPersistenceRecordV1[]
}

export interface DashboardAgentPersistenceReadResultV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly persistenceGeneration: number
  readonly records: readonly DashboardAgentPersistenceRecordV1[]
}

export interface DashboardAgentPersistenceFailureV1 {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly details: JsonObject
}

export interface DashboardAgentPersistenceCommitResultV1 {
  readonly schemaVersion: 1
  readonly batchId: string
  readonly status: 'committed' | 'generation-conflict' | 'rejected'
  readonly persistenceGeneration: number
  readonly failure?: DashboardAgentPersistenceFailureV1
}

export interface DashboardReceiptIntentV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly preparedHash: `sha256:${string}`
  readonly baseRevision: string
  readonly preImages: JsonValue
  readonly expectedPostImages: JsonValue
  readonly status: 'pending'
}

export interface DashboardReceiptLineageReadRequest {
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
}

export interface DashboardReceiptLineageResult extends DashboardReceiptLineageReadRequest {
  readonly receiptIntent: JsonObject | null
  readonly receipt: JsonObject | null
  readonly applyWitness: JsonObject | null
  readonly failureWitness: JsonObject | null
  readonly provenance: readonly JsonObject[]
}

export interface DashboardCompensationRunReadRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly outerCallId: string
}

export interface DashboardCompensationRunListRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
}

export interface DashboardCompensationRunListRecordV1 extends DashboardCompensationRunListRequestV1 {
  readonly outerCallId: string
  /** Call that wrote the current run head; run ownership remains outerCallId. */
  readonly writerCallId: string
  readonly draftGeneration: number
  readonly updatedAt: number
  readonly run: JsonObject
}

export interface DashboardCompensationTargetClaimReadRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly targetTaskId: string
}

export interface DashboardMutationProvenanceReadRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly slotKeys: readonly string[]
}

export interface DashboardCompensationRunStateCommitV1 {
  readonly schemaVersion: 1
  readonly action: 'acquire' | 'retain' | 'release'
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly outerCallId: string
  readonly targetTaskId: string
  readonly expectedDraftGeneration: number
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly projectSchema: JsonObject
  readonly updatedAt: number
  readonly run: JsonObject
}

export interface DashboardStorageBackend {
  get(store: DashboardStorageStoreName, key: DashboardStorageRecordKey): Promise<JsonObject | undefined>
  getAll(store: DashboardStorageStoreName): Promise<readonly JsonObject[]>
  commit(batch: DurableProjectBatchV1): Promise<DurableProjectCommitResultV1>
  putMigrationState(record: MigrationStateRecordV1): Promise<MigrationStateRecordV1>
  readAgentPersistence(request: DashboardAgentPersistenceReadRequestV1): Promise<DashboardAgentPersistenceReadResultV1>
  commitAgentPersistence(batch: DashboardAgentPersistenceBatchV1): Promise<DashboardAgentPersistenceCommitResultV1>
  putReceiptIntent(intent: DashboardReceiptIntentV1): Promise<DashboardReceiptIntentV1>
  readReceiptLineage(request: DashboardReceiptLineageReadRequest): Promise<DashboardReceiptLineageResult>
  createArtifact(artifact: ArtifactRecordV1): Promise<ArtifactCreateResultV1>
  readArtifact(request: ArtifactReadRequestV1): Promise<ArtifactRecordV1 | null>
  createArtifactRoot(root: ArtifactRootRecordV1): Promise<ArtifactRootCreateResultV1>
  readArtifactRoot(root: ArtifactRootRecordV1): Promise<ArtifactRootRecordV1 | null>
  deleteArtifactRoot(root: ArtifactRootRecordV1): Promise<ArtifactRootDeleteResultV1>
  sweepArtifacts(request: ArtifactSweepRequestV1): Promise<ArtifactSweepBackendResultV1>
  flush(): Promise<void>
  dispose(): Promise<void>
}

export declare const DASHBOARD_DRAFT_COMMIT_KINDS: readonly DashboardDraftCommitKind[]
export declare const DASHBOARD_MIGRATION_SOURCES: readonly DashboardMigrationSource[]
export declare const MEMORY_STORAGE_FAULT_PHASES: readonly MemoryStorageFaultPhase[]
export declare const requireStorageStore: (store: unknown) => DashboardStorageStoreName
export declare const normalizeStorageKey: (store: unknown, key: unknown) => DashboardStorageRecordKey
export declare const extractStorageRecordKey: (store: unknown, value: unknown) => DashboardStorageRecordKey
export declare const encodeStorageKey: (key: JsonValue) => string
export declare const validateDurableProjectBatch: (value: unknown) => DurableProjectBatchV1
export declare const validateMigrationStateRecord: (value: unknown) => MigrationStateRecordV1
export declare const validateAgentPersistenceReadRequest: (value: unknown) => DashboardAgentPersistenceReadRequestV1
export declare const validateAgentPersistenceBatch: (value: unknown) => DashboardAgentPersistenceBatchV1
export declare const createAgentPersistenceCheckpointId: (
  value: Pick<DashboardAgentPersistenceBatchV1, 'sessionId' | 'batchId'>,
) => string
export declare const validateReceiptIntentRecord: (value: unknown) => DashboardReceiptIntentV1
export declare const validateReceiptLineageReadRequest: (value: unknown) => DashboardReceiptLineageReadRequest
export declare const validateCompensationRunReadRequest: (value: unknown) => DashboardCompensationRunReadRequestV1
export declare const validateCompensationRunListRequest: (value: unknown) => DashboardCompensationRunListRequestV1
export declare const validateCompensationTargetClaimReadRequest: (
  value: unknown,
) => DashboardCompensationTargetClaimReadRequestV1
export declare const validateMutationProvenanceReadRequest: (value: unknown) => DashboardMutationProvenanceReadRequestV1
export declare const validateCompensationRunStateCommit: (value: unknown) => DashboardCompensationRunStateCommitV1
