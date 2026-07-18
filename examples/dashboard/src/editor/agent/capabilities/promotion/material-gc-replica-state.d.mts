import type {
  MaterialGcPlanRequestV1,
  MaterialGcPlanV1,
  MaterialGcReleaseRequestV1,
  MaterialGcReleaseResultV1,
  MaterialGcSweepRequestV1,
  MaterialGcSweepResultV1,
  Sha256Digest,
} from '../../../../../shared/material-gc-contract.mjs'
import type { MaterialIdentityV1 } from '../../../../../shared/material-promotion-contract.mjs'
import type {
  DashboardMaterialGcCrossTabCoordinator,
  DashboardMaterialGcCrossTabRequestOptions,
} from './material-gc-cross-tab-coordinator.mjs'

export declare const DASHBOARD_MATERIAL_GC_REPLICA_STORAGE_KEY: 'easy-editor:material-gc:replica:v1'
export declare const DASHBOARD_MATERIAL_GC_PROJECT_STORAGE_PREFIX: 'easy-editor:material-gc:project:v1:'
export declare const DASHBOARD_MATERIAL_GC_PROJECT_STATE_VERSION: 2

export interface DashboardMaterialGcProjectStateV2 {
  readonly schemaVersion: 1
  readonly stateVersion: 2
  readonly projectId: string
  readonly replicaId: string
  readonly replicaGeneration: number
  readonly snapshotDigest: Sha256Digest | null
  readonly acceptedMaterialRefs: readonly Readonly<MaterialIdentityV1>[]
  readonly pendingPlanRequest: Readonly<MaterialGcPlanRequestV1> | null
  readonly pendingSweepRequest: Readonly<MaterialGcSweepRequestV1> | null
  readonly status: 'active' | 'released'
}

export interface DashboardMaterialGcProjectTransaction {
  getProjectState(): Readonly<DashboardMaterialGcProjectStateV2>
  stagePlanRequest(request: MaterialGcPlanRequestV1): Readonly<DashboardMaterialGcProjectStateV2>
  acknowledgePlan(
    request: MaterialGcPlanRequestV1,
    plan: MaterialGcPlanV1,
  ): Promise<Readonly<DashboardMaterialGcProjectStateV2>>
  clearPendingPlan(request: MaterialGcPlanRequestV1): Readonly<DashboardMaterialGcProjectStateV2>
  stageSweepRequest(request: MaterialGcSweepRequestV1): Readonly<DashboardMaterialGcProjectStateV2>
  acknowledgeSweep(
    request: MaterialGcSweepRequestV1,
    result: MaterialGcSweepResultV1,
  ): Readonly<DashboardMaterialGcProjectStateV2>
  clearPendingSweep(request: MaterialGcSweepRequestV1): Readonly<DashboardMaterialGcProjectStateV2>
  commitRelease(
    request: MaterialGcReleaseRequestV1,
    result: MaterialGcReleaseResultV1,
  ): Promise<Readonly<DashboardMaterialGcProjectStateV2>>
}

export interface DashboardMaterialGcReplicaState {
  getProjectIdentity(
    projectId: string,
    options?: DashboardMaterialGcCrossTabRequestOptions,
  ): Promise<Readonly<{ readonly schemaVersion: 1; readonly projectId: string; readonly replicaId: string }>>
  beginNewProjectLifecycle(
    projectId: string,
    options?: DashboardMaterialGcCrossTabRequestOptions,
  ): Promise<Readonly<DashboardMaterialGcProjectStateV2>>
  getProjectState(projectId: string): Promise<Readonly<DashboardMaterialGcProjectStateV2>>
  withProjectTransaction<Result>(
    projectId: string,
    operation: (transaction: DashboardMaterialGcProjectTransaction) => Result | PromiseLike<Result>,
    options?: DashboardMaterialGcCrossTabRequestOptions,
  ): Promise<Result>
  stagePlanRequest(request: MaterialGcPlanRequestV1): Promise<Readonly<DashboardMaterialGcProjectStateV2>>
  acknowledgePlan(
    request: MaterialGcPlanRequestV1,
    plan: MaterialGcPlanV1,
  ): Promise<Readonly<DashboardMaterialGcProjectStateV2>>
  clearPendingPlan(request: MaterialGcPlanRequestV1): Promise<Readonly<DashboardMaterialGcProjectStateV2>>
  stageSweepRequest(request: MaterialGcSweepRequestV1): Promise<Readonly<DashboardMaterialGcProjectStateV2>>
  acknowledgeSweep(
    request: MaterialGcSweepRequestV1,
    result: MaterialGcSweepResultV1,
  ): Promise<Readonly<DashboardMaterialGcProjectStateV2>>
  clearPendingSweep(request: MaterialGcSweepRequestV1): Promise<Readonly<DashboardMaterialGcProjectStateV2>>
  commitRelease(
    request: MaterialGcReleaseRequestV1,
    result: MaterialGcReleaseResultV1,
  ): Promise<Readonly<DashboardMaterialGcProjectStateV2>>
}

export declare class DashboardMaterialGcReplicaStateError extends Error {
  readonly code: string
}

export declare const resolveDashboardMaterialGcEnabled: (source?: Readonly<Record<string, unknown>>) => boolean

export declare const createDashboardMaterialGcReplicaState: (options: {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>
  readonly crypto: Pick<Crypto, 'randomUUID' | 'subtle'>
  readonly coordinator: Pick<
    DashboardMaterialGcCrossTabCoordinator,
    'withIdentityExclusive' | 'withProjectReplicaExclusive'
  >
}) => DashboardMaterialGcReplicaState
