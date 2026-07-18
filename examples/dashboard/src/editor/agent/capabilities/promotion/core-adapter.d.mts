import type { EngineInstance } from '@easy-editor/core/instance'
import type { LocalMaterialPromotionCorePort } from './service.mjs'

export interface DashboardLocalMaterialPromotionCoreAdapterOptions {
  readonly engine: EngineInstance
  readonly projectId: string
  readonly branchId: string
  readonly adapterGeneration?: number
  readonly runAgentMutation?: <T>(callId: string, operation: () => T) => T
  readonly isTransactionCommittedError?: (error: unknown) => boolean
  readonly isTransactionRollbackIncompleteError?: (error: unknown) => boolean
}

export declare const createDashboardLocalMaterialPromotionCoreAdapter: (
  options: DashboardLocalMaterialPromotionCoreAdapterOptions,
) => LocalMaterialPromotionCorePort
