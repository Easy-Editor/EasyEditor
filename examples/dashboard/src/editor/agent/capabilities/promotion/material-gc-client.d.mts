import type {
  MaterialGcPlanRequestV1,
  MaterialGcPlanV1,
  MaterialGcReleaseRequestV1,
  MaterialGcReleaseResultV1,
  MaterialGcSweepRequestV1,
  MaterialGcSweepResultV1,
} from '../../../../../shared/material-gc-contract.mjs'

export declare const DASHBOARD_MATERIAL_GC_PLAN_ROUTE: '/api/materials/gc/plan'
export declare const DASHBOARD_MATERIAL_GC_SWEEP_ROUTE: '/api/materials/gc/sweep'
export declare const DASHBOARD_MATERIAL_GC_RELEASE_ROUTE: '/api/materials/gc/release'

export declare class DashboardMaterialGcClientError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  /** Preserve and replay the exact durable request whenever this is true. */
  readonly ambiguous: boolean
}

export interface DashboardMaterialGcClient {
  planGc(
    request: MaterialGcPlanRequestV1,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<Readonly<MaterialGcPlanV1>>
  sweepGc(
    request: MaterialGcSweepRequestV1,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<Readonly<MaterialGcSweepResultV1>>
  releaseGc(
    request: MaterialGcReleaseRequestV1,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<Readonly<MaterialGcReleaseResultV1>>
}

export declare const createDashboardSameOriginMaterialGcClient: (options: {
  readonly fetchImpl: typeof fetch
  readonly routes?: Readonly<{
    plan?: string
    sweep?: string
    release?: string
  }>
}) => DashboardMaterialGcClient
