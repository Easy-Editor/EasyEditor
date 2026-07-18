import type {
  MaterialGcPlanRequestV1,
  MaterialGcPlanV1,
  MaterialGcReleaseResultV1,
  Sha256Digest,
} from '../../../../../shared/material-gc-contract.mjs'
import type { MaterialIdentityV1 } from '../../../../../shared/material-promotion-contract.mjs'
import type { DashboardMaterialGcSnapshotV1 } from '../../../../lib/storage/material-gc.mjs'
import type { DashboardMutationQuiescenceGate } from '../../activity/mutation-quiescence-gate.mjs'
import type { DashboardMaterialGcClient } from './material-gc-client.mjs'
import type { DashboardMaterialGcCrossTabCoordinator } from './material-gc-cross-tab-coordinator.mjs'
import type {
  DashboardMaterialGcProjectStateV2,
  DashboardMaterialGcReplicaState,
} from './material-gc-replica-state.mjs'

export type DashboardMaterialGcTrigger =
  | 'startup'
  | 'promotion-applied'
  | 'manual-save'
  | 'preview-flush'
  | 'retry-once'

export type DashboardMaterialGcRuntimeStatus =
  | 'disabled'
  | 'idle'
  | 'scheduled'
  | 'running'
  | 'replayed-plan'
  | 'retry'
  | 'swept'
  | 'released'
  | 'already-released'
  | 'not-registered'
  | 'unavailable'
  | 'in-use'
  | 'fail-closed'
  | 'disposed'

export interface DashboardMaterialGcRuntimeSnapshotV1 {
  readonly schemaVersion: 1
  readonly status: DashboardMaterialGcRuntimeStatus
  readonly projectId: string | null
  readonly triggers: readonly string[]
  readonly failure: Readonly<{ readonly code: string; readonly message: string; readonly retryable: boolean }> | null
}

export interface DashboardMaterialGcRuntime {
  readonly enabled: boolean
  getSnapshot(): DashboardMaterialGcRuntimeSnapshotV1
  subscribe(listener: () => void): () => void
  trigger(trigger: Exclude<DashboardMaterialGcTrigger, 'retry-once'>): void
  waitForIdle(): Promise<DashboardMaterialGcRuntimeSnapshotV1>
  /** Caller already owns the Host/local shared mutation authority. Never acquires local exclusive. */
  admitMaterialRefsUnderSharedMutation(
    input: DashboardMaterialGcAdmissionInput,
  ): Promise<Readonly<DashboardMaterialGcAdmissionReceiptV1 | { readonly status: 'disabled' }>>
  /** Non-Host surfaces acquire one shared lease, admit durably, then run the Core/render callback. */
  withMaterialAdmission<Result>(
    input: DashboardMaterialGcAdmissionInput,
    operation: (
      receipt: Readonly<DashboardMaterialGcAdmissionReceiptV1 | { readonly status: 'disabled' }>,
    ) => Result | PromiseLike<Result>,
  ): Promise<Result>
  releaseCurrentReplica(): Promise<Readonly<{ readonly status: string; readonly result?: MaterialGcReleaseResultV1 }>>
  beginNewProjectLifecycle(): Promise<
    Readonly<{
      readonly status: string
      readonly state?: Readonly<DashboardMaterialGcProjectStateV2>
    }>
  >
  dispose(): void
}

export interface DashboardMaterialGcAdmissionInput {
  readonly schemaVersion?: 1
  readonly projectId?: string
  readonly materialRefs: readonly Readonly<MaterialIdentityV1>[]
  readonly unresolvedPromotionIds?: readonly Sha256Digest[]
  readonly reason: string
}

export interface DashboardMaterialGcAdmissionReceiptV1 {
  readonly schemaVersion: 1
  readonly status: 'admitted'
  readonly reason: string
  readonly projectId: string
  readonly replicaId: string
  readonly replicaGeneration: number
  readonly snapshotDigest: Sha256Digest
  readonly materialRefs: readonly Readonly<MaterialIdentityV1>[]
}

export declare class DashboardMaterialGcAdmissionError extends Error {
  readonly code: string
}

export interface DashboardMaterialGcPersistencePort {
  getSnapshot(): Readonly<{
    readonly state: string
    readonly projectId: string | null
    readonly branchId: string | null
    readonly draftGeneration: number
    readonly pendingAutosave: boolean
  }>
  flush(): Promise<void>
  withMaterialGcFence<Result>(
    projectId: string,
    operation: (
      context: Readonly<{ readSnapshot(): Promise<DashboardMaterialGcSnapshotV1> }>,
    ) => Result | PromiseLike<Result>,
  ): Promise<Result>
}

export declare const createDashboardMaterialGcRuntime: {
  (options: { readonly enabled: false }): DashboardMaterialGcRuntime
  (options: {
    readonly enabled: boolean
    readonly crypto: Pick<Crypto, 'subtle'>
    readonly client: DashboardMaterialGcClient
    readonly replicaState: DashboardMaterialGcReplicaState
    readonly coordinator: Pick<
      DashboardMaterialGcCrossTabCoordinator,
      'acquireProjectPresenceLease' | 'tryWithProjectPresenceExclusive' | 'dispose'
    >
    readonly persistence: DashboardMaterialGcPersistencePort
    readonly humanActivity: Readonly<{
      readonly generation: number
      waitUntilIdle(): Promise<Readonly<{ readonly generation: number }>>
      isActive(): boolean
    }>
    readonly invocationActivity: Readonly<{
      getSnapshot(): Readonly<{ readonly revision: number; readonly activeCalls: readonly unknown[] }>
      subscribe(listener: () => void): () => void
    }>
    readonly mutationGate: Pick<DashboardMutationQuiescenceGate, 'acquireShared' | 'tryAcquireExclusive' | 'dispose'>
    readonly scheduleIdle?: (callback: () => void) => () => void
    readonly onError?: (error: unknown) => void
  }): DashboardMaterialGcRuntime
}

export type { MaterialGcPlanRequestV1, MaterialGcPlanV1 }
