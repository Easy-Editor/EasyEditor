import type { InvocationResult, SemanticCall } from '@easy-editor/agent-runtime'
import type { EngineInstance } from '@easy-editor/core/instance'
import type { SafeMaterialManifestCache } from '../../manifest/index.mjs'
import type { DashboardMaterialGcRuntime } from '../promotion/material-gc-runtime.mjs'
import type {
  ScreenApplyChangeSetAuthority,
  ScreenApplyChangeSetDependencies,
  ScreenApplyPersistencePort,
} from './apply.mjs'
import type { ScreenJsonValue } from './index.mjs'

export interface DashboardScreenApplyRuntimeAdapterOptions {
  readonly authority: ScreenApplyChangeSetAuthority
  readonly activityLease: Readonly<{
    readonly generation: number
    isActive(): boolean
    waitUntilIdle(): Promise<Readonly<{ generation: number }>>
  }>
  readonly engine: EngineInstance
  readonly persistence: ScreenApplyPersistencePort
  readonly captureFullSnapshot: () => Promise<
    Readonly<{
      readonly revision: string
      readonly providerGenerations: Readonly<Record<string, number>>
      readonly [key: string]: ScreenJsonValue
    }>
  >
  readonly createTelemetryChangeSetId?: ScreenApplyChangeSetDependencies['createTelemetryChangeSetId']
  readonly manifestCache: SafeMaterialManifestCache
  readonly hashCanonicalJson: (value: ScreenJsonValue) => Promise<`sha256:${string}`>
  readonly now: () => number
  readonly telemetry?: ScreenApplyChangeSetDependencies['telemetry']
  readonly telemetryNow?: ScreenApplyChangeSetDependencies['telemetryNow']
  readonly isTransactionCommittedError: (error: unknown) => boolean
  readonly isTransactionRollbackIncompleteError: (error: unknown) => boolean
  readonly admitMaterialRefsUnderSharedMutation?: ScreenApplyChangeSetDependencies['admitMaterialRefsUnderSharedMutation']
}

type AssertTrue<Value extends true> = Value
type _DashboardScreenRuntimeAdmissionPortCompatibility = AssertTrue<
  DashboardMaterialGcRuntime['admitMaterialRefsUnderSharedMutation'] extends NonNullable<
    DashboardScreenApplyRuntimeAdapterOptions['admitMaterialRefsUnderSharedMutation']
  >
    ? true
    : false
>

export declare const createDashboardScreenApplyChangeSetHandler: (
  options: DashboardScreenApplyRuntimeAdapterOptions,
) => (call: SemanticCall) => Promise<InvocationResult>
