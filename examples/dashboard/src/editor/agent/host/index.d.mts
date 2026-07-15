import type {
  AgentHost,
  CapabilitySchema,
  CapabilitySchemaRequest,
  HostSnapshot,
  HostSnapshotDelta,
  InvocationResult,
  ObserveRequest,
  ReceiptQueryRequest,
  SemanticCall,
  ToolReceipt,
} from '@easy-editor/agent-runtime'
import type { EngineInstance } from '@easy-editor/core/instance'

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
  readonly enabled?: boolean
  readonly engine?: EngineInstance
  readonly authority?: DashboardAgentHostAuthority
  readonly adapterGeneration?: number
}

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
    readonly engine: EngineInstance
    readonly authority: DashboardAgentHostAuthority
    readonly adapterGeneration?: number
  })
  readonly disposed: boolean
  observe(request: ObserveRequest): Promise<HostSnapshot | HostSnapshotDelta>
  describeCapability(request: CapabilitySchemaRequest): Promise<CapabilitySchema>
  invoke(call: SemanticCall): Promise<InvocationResult>
  queryReceipt(request: ReceiptQueryRequest): Promise<ToolReceipt | null>
  dispose(): void
}

export declare const createDashboardAgentHost: (options?: DashboardAgentHostOptions) => DashboardAgentHost | null
