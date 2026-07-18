import type { ArtifactMaterialIdentityV1 } from '../../../lib/storage/artifact-contracts.mjs'
import type {
  CanonicalActiveDocumentV1,
  CanonicalWorkingDraftV1,
  DashboardReceiptIntentV1,
  DashboardReceiptLineageReadRequest,
  DashboardReceiptLineageResult,
} from '../../../lib/storage/contracts.mjs'
import type {
  ProjectPersistenceCommitResultV1,
  ProjectPersistenceCommitV1,
} from '../../../lib/storage/project-persistence-coordinator.mjs'
import type { JsonObject, JsonValue } from './contract.mjs'
import type { MutationProvenanceV1 } from './provenance.mjs'
import type {
  ApplyWitnessV1,
  FailureWitnessV1,
  ReceiptIntentV1,
  ReceiptRecoveryResult,
  ToolReceiptV1,
} from './receipt-ledger.mjs'

export interface DurableAgentCommitCoordinator {
  recordReceiptIntent(intent: DashboardReceiptIntentV1): Promise<DashboardReceiptIntentV1>
  readReceiptLineage(request: DashboardReceiptLineageReadRequest): Promise<DashboardReceiptLineageResult>
  commit(value: ProjectPersistenceCommitV1): Promise<ProjectPersistenceCommitResultV1>
}

export interface DurableAgentJournalInputV1 {
  readonly recordId: string
  readonly kind: string
  readonly value: JsonValue
}

export interface DurableAgentCheckpointInputV1 {
  readonly checkpointId: string
  readonly value: JsonValue
}

export interface DurableAgentArtifactRefInputV1 {
  readonly ownerType: string
  readonly ownerId: string
  readonly artifactId: string
  readonly sourceRevision: string
  readonly materialRefs?: readonly ArtifactMaterialIdentityV1[]
}

export interface DurableAgentBatchV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly expectedDraftGeneration: number
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly projectSchema: JsonObject
  readonly updatedAt: number
  readonly receiptIntent: ReceiptIntentV1
  readonly receipt: ToolReceiptV1
  readonly witness: ApplyWitnessV1 | FailureWitnessV1
  readonly provenance: readonly MutationProvenanceV1[]
  readonly sessionId: string
  readonly journal: DurableAgentJournalInputV1
  /** Exact task-journal record IDs deleted in the same transaction. */
  readonly journalDeletes?: readonly string[]
  readonly checkpoint: DurableAgentCheckpointInputV1
  readonly artifactRefs?: readonly DurableAgentArtifactRefInputV1[]
  /** Exact artifact-root keys deleted atomically with the replacement draft and receipt. */
  readonly artifactRefDeletes?: readonly DurableAgentArtifactRefInputV1[]
}

export interface DurableAgentCommitResultV1 {
  readonly schemaVersion: 1
  readonly status: 'committed'
  readonly receipt: ToolReceiptV1
  readonly draft: CanonicalWorkingDraftV1
}

export declare const recordDurableAgentIntent: (input: {
  readonly coordinator: DurableAgentCommitCoordinator
  readonly intent: ReceiptIntentV1
}) => Promise<ReceiptIntentV1>

export declare const commitDurableAgentBatch: (input: {
  readonly coordinator: DurableAgentCommitCoordinator
  readonly batch: DurableAgentBatchV1
}) => Promise<DurableAgentCommitResultV1>

export declare const recoverDurableAgentReceipt: (
  input: Readonly<{ coordinator: DurableAgentCommitCoordinator }> & DashboardReceiptLineageReadRequest,
) => Promise<ReceiptRecoveryResult>
