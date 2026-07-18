import type { LocalMaterialPromotionClientPort } from './service.mjs'

export declare const LOCAL_MATERIAL_PROMOTION_ROUTE: '/api/materials/promote'
export declare const LOCAL_MATERIAL_PROMOTION_QUERY_ROUTE: '/api/materials/promotion/query'
export declare const LOCAL_MATERIAL_PROMOTION_AVAILABILITY_ROUTE: '/api/materials/promotion/availability'

export type LocalMaterialPromotionAvailabilityReason = 'promotion-requires-node-20' | 'promotion-server-unavailable'

export interface LocalMaterialPromotionAvailabilityV1 {
  readonly schemaVersion: 1
  readonly available: boolean
  readonly reason: LocalMaterialPromotionAvailabilityReason | null
}

export interface DashboardSameOriginLocalMaterialPromotionClient extends LocalMaterialPromotionClientPort {
  checkAvailability(): Promise<LocalMaterialPromotionAvailabilityV1>
}

export declare class DashboardLocalMaterialPromotionClientError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
}

export declare const createDashboardSameOriginLocalMaterialPromotionClient: (options: {
  readonly projectId: string
  readonly fetchImpl: typeof fetch
  readonly routes?: Readonly<{
    promote?: string
    query?: string
    availability?: string
  }>
}) => DashboardSameOriginLocalMaterialPromotionClient
