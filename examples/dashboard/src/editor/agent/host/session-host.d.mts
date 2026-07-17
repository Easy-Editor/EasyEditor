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
import type { DashboardAgentHost, DashboardAgentHostAuthority } from './index.mjs'

export interface DashboardAgentSessionHostAuthority {
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
}

export interface DashboardAgentSessionHostOptions {
  readonly authority: DashboardAgentSessionHostAuthority
  readonly createHost: (authority: DashboardAgentHostAuthority) => DashboardAgentHost
  readonly enabled?: boolean
  readonly maxTaskHosts?: number
}

export declare class DashboardAgentSessionHost implements AgentHost {
  constructor(options: Omit<DashboardAgentSessionHostOptions, 'enabled'>)
  readonly disposed: boolean
  observe(request: ObserveRequest): Promise<HostSnapshot | HostSnapshotDelta>
  describeCapability(request: CapabilitySchemaRequest): Promise<CapabilitySchema>
  invoke(call: SemanticCall, context: HostInvocationContextV1): Promise<InvocationResult>
  queryReceipt(request: ReceiptQueryRequest): Promise<ToolReceipt | null>
  dispose(): void
}

export declare const createDashboardAgentSessionHost: (
  options?: Partial<DashboardAgentSessionHostOptions>,
) => DashboardAgentSessionHost | null
