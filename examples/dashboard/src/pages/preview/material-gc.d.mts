import type {
  DashboardMaterialGcAdmissionInput,
  DashboardMaterialGcAdmissionReceiptV1,
} from '../../editor/agent/capabilities/promotion/material-gc-runtime.mjs'
import type { DashboardPersistenceRuntime } from '../../editor/persistence-runtime'

export { resolveDashboardMaterialGcEnabled } from '../../editor/agent/capabilities/promotion/material-gc-replica-state.mjs'

export interface DashboardPreviewMaterialGcComposition {
  readonly enabled: true
  withMaterialAdmission<Result>(
    input: DashboardMaterialGcAdmissionInput,
    operation: (receipt: Readonly<DashboardMaterialGcAdmissionReceiptV1>) => Result | PromiseLike<Result>,
  ): Promise<Result>
  dispose(): boolean
}

export interface DashboardPreviewMaterialGcEnvironment {
  readonly inputTarget: EventTarget
  readonly lockManager?: Pick<LockManager, 'request'>
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>
  readonly crypto: Pick<Crypto, 'randomUUID' | 'subtle'>
  readonly fetchImpl: typeof fetch
}

export declare const createDashboardPreviewMaterialGcComposition: {
  (options: { readonly enabled: false }): null
  (options: {
    readonly enabled: true
    readonly environment: DashboardPreviewMaterialGcEnvironment
    readonly persistence: DashboardPersistenceRuntime
    readonly onError?: (error: unknown) => void
  }): DashboardPreviewMaterialGcComposition
}
