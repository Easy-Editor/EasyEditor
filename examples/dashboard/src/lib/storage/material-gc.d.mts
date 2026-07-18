import type { ArtifactMaterialIdentityV1, ArtifactRootFenceV1 } from './artifact-contracts.mjs'
import type { JsonObject } from './canonical-json.mjs'

export type DashboardMaterialGcStoreName =
  | 'workingDrafts'
  | 'projectVersions'
  | 'agentSessions'
  | 'taskJournals'
  | 'toolReceipts'
  | 'receiptIntents'
  | 'agentCheckpoints'
  | 'artifactRefs'

export type DashboardMaterialGcStoreRecordsV1 = Readonly<Record<DashboardMaterialGcStoreName, readonly JsonObject[]>>

export interface DashboardMaterialGcStoreSnapshotV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly stores: DashboardMaterialGcStoreRecordsV1
}

export interface DashboardMaterialGcGenerationFenceV1 {
  readonly branchId: string
  readonly draftGeneration: number
}

export interface DashboardMaterialGcSessionGenerationFenceV1 {
  readonly branchId: string
  readonly sessionId: string
  readonly persistenceGeneration: number
}

export interface DashboardMaterialGcStoreFenceV1 {
  readonly store: DashboardMaterialGcStoreName
  readonly recordCount: number
  readonly digest: `sha256:${string}`
}

export interface DashboardMaterialGcSnapshotV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly generationFence: readonly DashboardMaterialGcGenerationFenceV1[]
  readonly sessionGenerationFence: readonly DashboardMaterialGcSessionGenerationFenceV1[]
  readonly rootFence: readonly ArtifactRootFenceV1[]
  readonly storeFence: readonly DashboardMaterialGcStoreFenceV1[]
  readonly materialRefs: readonly ArtifactMaterialIdentityV1[]
  readonly unresolvedPromotionIds: readonly `sha256:${string}`[]
  readonly snapshotDigest: `sha256:${string}`
}

export declare const DASHBOARD_MATERIAL_GC_STORE_NAMES: readonly DashboardMaterialGcStoreName[]
export declare const createMaterialGcStoreSnapshot: (
  projectId: string,
  recordsByStore: DashboardMaterialGcStoreRecordsV1,
) => DashboardMaterialGcStoreSnapshotV1
export declare const validateMaterialGcStoreSnapshot: (
  value: unknown,
  expectedProjectId: string,
) => DashboardMaterialGcStoreSnapshotV1
