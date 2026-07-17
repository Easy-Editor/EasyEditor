import type { EngineInstance } from '@easy-editor/core/instance'
import type { OnlineArtifactCorePort } from './service.mjs'

export interface DashboardOnlineArtifactCoreAdapterOptions {
  readonly engine: EngineInstance
  readonly projectId: string
  readonly branchId: string
  readonly adapterGeneration?: number
  readonly runAgentMutation?: <T>(callId: string, operation: () => T) => T
  readonly isTransactionCommittedError?: (error: unknown) => boolean
  readonly isTransactionRollbackIncompleteError?: (error: unknown) => boolean
}

export declare const createDashboardOnlineArtifactCoreAdapter: (
  options: DashboardOnlineArtifactCoreAdapterOptions,
) => OnlineArtifactCorePort
