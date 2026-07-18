import type { ArtifactMaterialIdentityV1 } from './artifact-contracts.mjs'
import type { JsonObject } from './canonical-json.mjs'
import type { CanonicalActiveDocumentV1, CanonicalWorkingDraftV1 } from './contracts.mjs'

export type DashboardAgentSessionStatus = 'active' | 'idle' | 'closed'
export type DashboardLocalGrantScope =
  | 'project.write'
  | 'data.read'
  | 'online-code.author'
  | 'dependency.resolve'
  | 'material.promote.local'
export type DashboardArtifactRootOwnerType =
  | 'working-draft'
  | 'project-version'
  | 'checkpoint'
  | 'task-journal'
  | 'tool-receipt'
  | 'receipt-intent'
  | 'compensation'
  | 'promotion-rollback'
  | 'durable-registry'

export interface DashboardAgentSessionForkV1 {
  readonly sessionId: string | null
  readonly taskId: string | null
  readonly versionId: string
}

export interface DashboardAgentSessionRecordV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly status: DashboardAgentSessionStatus
  readonly persistenceGeneration: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly closedAt: number | null
  readonly forkedFrom: DashboardAgentSessionForkV1 | null
}

export interface DashboardArtifactIdentityV1 {
  readonly artifactId: string
  readonly sourceRevision: string
}

export interface DashboardProjectVersionRecordV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly versionId: string
  readonly name: string
  readonly createdAt: number
  readonly creationBatchId: string
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly projectSchema: JsonObject
  readonly projectHash: `sha256:${string}`
  readonly artifactRefs: readonly DashboardArtifactIdentityV1[]
  readonly sourceSessionId: string | null
  readonly sourceTaskId: string | null
  readonly sourceCheckpointId: string | null
}

export type DashboardLocalGrantPolicyVersion = string | number

export interface DashboardLocalGrantRecordV1 {
  readonly schemaVersion: 1
  readonly userId: string
  readonly projectId: string
  readonly scope: DashboardLocalGrantScope
  readonly policyVersion: DashboardLocalGrantPolicyVersion
  readonly providerId: string
  readonly providerFingerprint: string
  readonly status: 'granted' | 'revoked'
  readonly grantedAt: number
  readonly updatedAt: number
  readonly revokedAt: number | null
}

export interface DashboardArtifactRootV1 extends DashboardArtifactIdentityV1 {
  readonly branchId: string
  readonly ownerType: string
  readonly ownerId: string
  readonly materialRefs: readonly ArtifactMaterialIdentityV1[]
}

export interface DashboardProjectVersionCreateV1 {
  readonly schemaVersion: 1
  readonly batchId: string
  readonly projectId: string
  readonly branchId: string
  readonly expectedDraftGeneration: number
  readonly versionId: string
  readonly name: string
  readonly createdAt: number
  readonly artifactRefs: readonly DashboardArtifactIdentityV1[]
  readonly sourceSessionId: string | null
  readonly sourceTaskId: string | null
  readonly sourceCheckpointId: string | null
}

export interface DashboardProjectVersionReadV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly versionId: string
}

export interface DashboardProjectListV1 {
  readonly schemaVersion: 1
  readonly projectId: string
}

export interface DashboardProjectVersionMutationResultV1 {
  readonly schemaVersion: 1
  readonly status: 'committed' | 'reconciled'
  readonly version: DashboardProjectVersionRecordV1
  readonly draft: CanonicalWorkingDraftV1
}

export interface DashboardAgentSessionSaveV1 {
  readonly schemaVersion: 1
  readonly batchId: string
  readonly projectId: string
  readonly branchId: string
  readonly expectedDraftGeneration: number
  readonly sessionId: string
  readonly status: DashboardAgentSessionStatus
  readonly createdAt: number
  readonly updatedAt: number
  readonly forkedFrom: DashboardAgentSessionForkV1 | null
}

export interface DashboardAgentSessionScopeV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
}

export interface DashboardAgentSessionMutationResultV1 {
  readonly schemaVersion: 1
  readonly status: 'committed' | 'reconciled'
  readonly session: DashboardAgentSessionRecordV1
  readonly draft: CanonicalWorkingDraftV1
}

export interface DashboardProjectVersionRestoreV1 {
  readonly schemaVersion: 1
  readonly batchId: string
  readonly projectId: string
  readonly sourceBranchId: string
  readonly versionId: string
  readonly targetBranchId: string
  readonly targetSessionId: string
  readonly forkedFromSessionId: string | null
  readonly forkedFromTaskId: string | null
  readonly restoredAt: number
}

export interface DashboardProjectVersionRestoreResultV1 extends DashboardProjectVersionMutationResultV1 {
  readonly session: DashboardAgentSessionRecordV1
}

export interface DashboardLocalGrantAuthorizeV1 {
  readonly schemaVersion: 1
  readonly batchId: string
  readonly projectId: string
  readonly branchId: string
  readonly expectedDraftGeneration: number
  readonly userId: string
  readonly scope: DashboardLocalGrantScope
  readonly policyVersion: DashboardLocalGrantPolicyVersion
  readonly providerId: string
  readonly providerFingerprint: string
  readonly updatedAt: number
}

export interface DashboardLocalGrantCheckV1 {
  readonly schemaVersion: 1
  readonly userId: string
  readonly projectId: string
  readonly scope: DashboardLocalGrantScope
  readonly policyVersion: DashboardLocalGrantPolicyVersion
  readonly providerId: string
  readonly providerFingerprint: string
}

export interface DashboardLocalGrantRevokeV1 {
  readonly schemaVersion: 1
  readonly batchId: string
  readonly projectId: string
  readonly branchId: string
  readonly expectedDraftGeneration: number
  readonly userId: string
  readonly scope: DashboardLocalGrantScope
  readonly policyVersion: DashboardLocalGrantPolicyVersion
  readonly revokedAt: number
}

export interface DashboardLocalGrantListV1 {
  readonly schemaVersion: 1
  readonly userId: string
  readonly projectId: string
}

export interface DashboardLocalGrantMutationResultV1 {
  readonly schemaVersion: 1
  readonly status: 'committed' | 'reconciled'
  readonly grant: DashboardLocalGrantRecordV1 | null
  readonly draft: CanonicalWorkingDraftV1
}

export type DashboardLocalGrantDecisionReason =
  | 'granted'
  | 'missing'
  | 'revoked'
  | 'provider-changed'
  | 'provider-fingerprint-changed'
  | 'policy-version-changed'

export interface DashboardLocalGrantDecisionV1 {
  readonly schemaVersion: 1
  readonly granted: boolean
  readonly reason: DashboardLocalGrantDecisionReason
  readonly grant: DashboardLocalGrantRecordV1 | null
}

export interface DashboardArtifactGenerationFenceV1 {
  readonly branchId: string
  readonly draftGeneration: number
}

export interface DashboardArtifactRootEnumerationV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly generationFence: readonly DashboardArtifactGenerationFenceV1[]
  readonly roots: readonly DashboardArtifactRootV1[]
}

export interface DashboardRetainedArtifactV1 extends DashboardArtifactIdentityV1 {
  readonly referenceCount: number
}

export interface DashboardArtifactGcDryRunV1 extends DashboardArtifactRootEnumerationV1 {
  readonly dryRun: true
  readonly artifactIdentityFence: readonly DashboardArtifactIdentityV1[]
  readonly rootFence: readonly DashboardArtifactRootV1[]
  readonly retainedArtifacts: readonly DashboardRetainedArtifactV1[]
  readonly missingArtifacts: readonly DashboardRetainedArtifactV1[]
  readonly deletionCandidates: readonly DashboardArtifactIdentityV1[]
}

export interface DashboardArtifactGcSweepResultV1 extends Omit<DashboardArtifactGcDryRunV1, 'dryRun'> {
  readonly dryRun: false
  readonly deletedArtifacts: readonly DashboardArtifactIdentityV1[]
}

export declare const DASHBOARD_AGENT_SESSION_STATUSES: readonly DashboardAgentSessionStatus[]
export declare const DASHBOARD_LOCAL_GRANT_SCOPES: readonly DashboardLocalGrantScope[]
export declare const DASHBOARD_ARTIFACT_ROOT_OWNER_TYPES: readonly DashboardArtifactRootOwnerType[]

export declare const normalizeArtifactIdentities: (value: unknown, label?: string) => DashboardArtifactIdentityV1[]
export declare const validateAgentSessionRecord: (value: unknown) => DashboardAgentSessionRecordV1
export declare const normalizeStoredAgentSessionRecord: (
  value: unknown,
  authority?: Readonly<{ projectId?: string; branchId?: string; sessionId?: string }>,
) => DashboardAgentSessionRecordV1
export declare const advanceAgentSessionPersistenceRecord: (
  current: unknown | undefined,
  authority: Readonly<{ projectId: string; branchId: string; sessionId: string }>,
  persistenceGeneration: number,
) => DashboardAgentSessionRecordV1
export declare const validateProjectVersionRecord: (value: unknown) => DashboardProjectVersionRecordV1
export declare const validateLocalGrantRecord: (value: unknown) => DashboardLocalGrantRecordV1
export declare const normalizeArtifactRootRecord: (value: unknown) => DashboardArtifactRootV1
export declare const normalizeStoredArtifactIdentity: (value: unknown) => DashboardArtifactIdentityV1
