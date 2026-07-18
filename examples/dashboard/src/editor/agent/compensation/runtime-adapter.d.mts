import type { EngineInstance } from '@easy-editor/core/instance'
import type { ArtifactMaterialIdentityV1 } from '../../../lib/storage/artifact-contracts.mjs'
import type {
  DashboardMaterialGcAdmissionInput,
  DashboardMaterialGcRuntime,
} from '../capabilities/promotion/material-gc-runtime.mjs'
import type { ScreenJsonValue } from '../capabilities/screen/index.mjs'
import type { SafeMaterialManifestCache } from '../manifest/index.mjs'
import type { TaskCompensationPersistence, TaskCompensationService } from './index.mjs'

export interface DashboardCompensationMaterialAdmissionInputV1 extends DashboardMaterialGcAdmissionInput {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly materialRefs: readonly Readonly<ArtifactMaterialIdentityV1>[]
  readonly reason: 'screen-compensation'
}

export interface DashboardTaskCompensationRuntimeAdapterOptions {
  readonly authority: Readonly<{
    readonly projectId: string
    readonly branchId: string
    readonly sessionId: string
  }>
  readonly activityLease: Readonly<{
    readonly generation: number
    isActive(): boolean
    waitUntilIdle(): Promise<Readonly<{ generation: number }>>
  }>
  readonly engine: EngineInstance
  readonly persistence: TaskCompensationPersistence
  readonly captureFullSnapshot: () => Promise<
    Readonly<{
      readonly revision: string
      readonly providerGenerations: Readonly<Record<string, number>>
      readonly [key: string]: ScreenJsonValue
    }>
  >
  readonly manifestCache: SafeMaterialManifestCache
  readonly hashCanonicalJson: (value: ScreenJsonValue) => Promise<`sha256:${string}`>
  readonly now: () => number
  readonly isTransactionCommittedError: (error: unknown) => boolean
  readonly isTransactionRollbackIncompleteError: (error: unknown) => boolean
  readonly admitMaterialRefsUnderSharedMutation?: (
    input: Readonly<DashboardCompensationMaterialAdmissionInputV1>,
  ) => unknown | PromiseLike<unknown>
}

type AssertTrue<Value extends true> = Value
type _DashboardCompensationAdmissionPortCompatibility = AssertTrue<
  DashboardMaterialGcRuntime['admitMaterialRefsUnderSharedMutation'] extends NonNullable<
    DashboardTaskCompensationRuntimeAdapterOptions['admitMaterialRefsUnderSharedMutation']
  >
    ? true
    : false
>

export declare const createDashboardTaskCompensationService: (
  options: DashboardTaskCompensationRuntimeAdapterOptions,
) => TaskCompensationService
