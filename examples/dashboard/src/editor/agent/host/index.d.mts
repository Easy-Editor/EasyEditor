import type {
  AgentHost,
  CapabilitySchema,
  CapabilitySchemaRequest,
  HostInvocationContextV1,
  HostSnapshot,
  HostSnapshotDelta,
  InvocationResult,
  ObserveRequest,
  ReceiptQueryRequest,
  SemanticCall,
  ToolReceipt,
} from '@easy-editor/agent-runtime'
import type { EngineInstance } from '@easy-editor/core/instance'
import type { HumanActivityLease } from '../activity/index.mjs'
import type { DashboardInvocationActivity } from '../activity/invocation-activity.mjs'
import type { DashboardOnlineArtifactCapabilityService } from '../capabilities/artifact/index.mjs'
import type { DashboardDataCapabilityService, DashboardDataResolver } from '../capabilities/data/index.mjs'
import type { ScreenApplyPersistencePort } from '../capabilities/screen/index.mjs'
import type { TaskCompensationPersistence, TaskCompensationService } from '../compensation/index.mjs'
import type { ReceiptRecoveryResult } from '../persistence/receipt-ledger.mjs'

export type DashboardAgentHostErrorCode =
  | 'AUTHORITY_MISMATCH'
  | 'CAPABILITY_UNAVAILABLE'
  | 'HOST_DISPOSED'
  | 'INVALID_REQUEST'
  | 'MATERIAL_NOT_FOUND'
  | 'STALE_REVISION'
  | 'UNKNOWN_CAPABILITY'

export interface DashboardAgentHostAuthority {
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly taskId: string
}

export interface DashboardAgentHostOptions {
  readonly activityLease?: HumanActivityLease
  readonly invocationActivity?: Pick<DashboardInvocationActivity, 'begin'>
  readonly enabled?: boolean
  readonly engine?: EngineInstance
  readonly authority?: DashboardAgentHostAuthority
  readonly adapterGeneration?: number
  readonly artifactService?: DashboardOnlineArtifactCapabilityService
  readonly compensationService?: DashboardTaskCompensationService
  readonly dataResolver?: DashboardDataResolver
  readonly dataService?: DashboardDataCapabilityService
  readonly isTransactionCommittedError?: (error: unknown) => boolean
  readonly isTransactionRollbackIncompleteError?: (error: unknown) => boolean
  readonly now?: () => number
  readonly persistence?: DashboardAgentHostPersistence
}

export interface DashboardAgentHostPersistence extends ScreenApplyPersistencePort, TaskCompensationPersistence {
  recoverDurableAgentReceipt(
    request: Readonly<{ projectId: string; branchId: string; callId: string }>,
  ): Promise<ReceiptRecoveryResult>
}

export type DashboardTaskCompensationService = TaskCompensationService

export declare const DASHBOARD_AGENT_HOST_ERROR_CODE: Readonly<{
  authorityMismatch: 'AUTHORITY_MISMATCH'
  capabilityUnavailable: 'CAPABILITY_UNAVAILABLE'
  hostDisposed: 'HOST_DISPOSED'
  invalidRequest: 'INVALID_REQUEST'
  materialNotFound: 'MATERIAL_NOT_FOUND'
  staleRevision: 'STALE_REVISION'
  unknownCapability: 'UNKNOWN_CAPABILITY'
}>

export declare class DashboardAgentHostError extends Error {
  readonly code: DashboardAgentHostErrorCode
  readonly reason: string
  readonly details: Readonly<Record<string, string>>
  constructor(code: DashboardAgentHostErrorCode, reason: string, details?: Readonly<Record<string, string>>)
  toJSON(): Readonly<{
    schemaVersion: 1
    code: DashboardAgentHostErrorCode
    reason: string
    details: Readonly<Record<string, string>>
  }>
}

export declare class DashboardAgentHost implements AgentHost {
  constructor(options: {
    readonly activityLease: HumanActivityLease
    readonly invocationActivity?: Pick<DashboardInvocationActivity, 'begin'>
    readonly engine: EngineInstance
    readonly authority: DashboardAgentHostAuthority
    readonly adapterGeneration?: number
    readonly artifactService?: DashboardOnlineArtifactCapabilityService
    readonly compensationService?: DashboardTaskCompensationService
    readonly dataResolver?: DashboardDataResolver
    readonly dataService?: DashboardDataCapabilityService
    readonly isTransactionCommittedError: (error: unknown) => boolean
    readonly isTransactionRollbackIncompleteError: (error: unknown) => boolean
    readonly now?: () => number
    readonly persistence: DashboardAgentHostPersistence
  })
  readonly disposed: boolean
  observe(request: ObserveRequest): Promise<HostSnapshot | HostSnapshotDelta>
  describeCapability(request: CapabilitySchemaRequest): Promise<CapabilitySchema>
  invoke(call: SemanticCall, context: HostInvocationContextV1): Promise<InvocationResult>
  queryReceipt(request: ReceiptQueryRequest): Promise<ToolReceipt | null>
  dispose(): void
}

export declare const createDashboardAgentHost: (options?: DashboardAgentHostOptions) => DashboardAgentHost | null
