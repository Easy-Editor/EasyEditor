import type { EditorCommand } from '../commands'
import type { RootSchema } from '../types'

export type AgentCommandType = EditorCommand['type']

export type AgentEditorCommand = EditorCommand extends infer Command
  ? Command extends EditorCommand
    ? Omit<Command, 'documentId'>
    : never
  : never

export interface AgentCapabilityLimits {
  readonly maxCommands: number
  readonly maxPayloadBytes: number
  readonly maxInsertedNodes: number
  readonly maxTreeDepth: number
  readonly maxSnapshotBytes: number
}

export interface AgentStringValuePolicy {
  readonly type: 'string'
  readonly maxBytes: number
}

export interface AgentNumberValuePolicy {
  readonly type: 'number'
  readonly minimum: number
  readonly maximum: number
  readonly exclusiveMinimum?: boolean
  readonly exclusiveMaximum?: boolean
}

export interface AgentObjectValuePolicy {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, AgentValuePolicy>>
  readonly required: readonly string[]
  readonly additionalProperties: false
}

export type AgentValuePolicy = AgentStringValuePolicy | AgentNumberValuePolicy | AgentObjectValuePolicy

export type AgentPropValuePolicy = AgentValuePolicy

export type AgentComponentPropPolicies = Readonly<Record<string, Readonly<Record<string, AgentPropValuePolicy>>>>

export interface AgentExtraValuePolicy {
  readonly requiredOnInsert: boolean
  readonly policy: AgentValuePolicy
}

export type AgentExtraValuePolicies = Readonly<Record<string, AgentExtraValuePolicy>>

export interface AgentCapabilityGrantInput {
  readonly subjectId: string
  readonly documentIds: readonly string[]
  readonly commandTypes: readonly AgentCommandType[]
  /** Component types the capability may insert; this does not authorize any props. */
  readonly componentNames?: readonly string[]
  /** Per-component prop value policies; this does not authorize component insertion. */
  readonly componentProps?: AgentComponentPropPolicies
  readonly extraKeys?: readonly string[]
  /** Every granted extra key requires an explicit value policy. */
  readonly extraValues?: AgentExtraValuePolicies
  readonly limits?: Partial<AgentCapabilityLimits>
}

export interface AgentCapabilityGrant {
  readonly documentIds: readonly string[]
  readonly commandTypes: readonly AgentCommandType[]
  /** Component types the capability may insert; independent from componentProps. */
  readonly componentNames: readonly string[]
  /** Per-component prop value policies; independent from componentNames and fail-closed when absent. */
  readonly componentProps: AgentComponentPropPolicies
  readonly extraKeys: readonly string[]
  readonly extraValues: AgentExtraValuePolicies
  readonly limits: AgentCapabilityLimits
}

/**
 * Capability methods execute in the caller's JavaScript realm. The restricted
 * variant describes engine policy, not a Worker/iframe/Realm security boundary.
 */
export type AgentCapabilityAssurance = 'policy-restricted-co-realm' | 'legacy-co-realm'

export interface AgentCapabilityDescriptor {
  readonly capabilityId: string
  readonly subjectId: string
  readonly assurance: AgentCapabilityAssurance
  readonly grant: AgentCapabilityGrant
}

export interface AgentDocumentSnapshot {
  readonly documentId: string
  readonly revision: string
  readonly schema: RootSchema
}

export interface AgentPlanRequest {
  readonly documentId: string
  readonly baseRevision: string
  readonly commands: readonly AgentEditorCommand[]
}

export interface AgentCommandEffect {
  readonly commandIndex: number
  readonly type: AgentCommandType
  readonly nodeIds: readonly string[]
  readonly parentId?: string
}

export interface AgentPlanPreview {
  readonly planId: string
  readonly state: 'prepared'
  readonly documentId: string
  readonly baseRevision: string
  readonly commandCount: number
  readonly effects: readonly AgentCommandEffect[]
}

export type AgentExecutionStatus = 'committed' | 'committed_with_observer_errors'

export interface AgentExecutionReceipt {
  readonly planId: string
  readonly documentId: string
  readonly status: AgentExecutionStatus
  readonly committed: true
  readonly revision?: string
  readonly commandCount: number
  readonly affectedNodeIds: readonly string[]
  readonly observerErrorCount: number
}

export type AgentAuditAction = 'issue' | 'snapshot' | 'preview' | 'execute' | 'revoke'

export type AgentAuditOutcome =
  | 'issued'
  | 'snapshot'
  | 'prepared'
  | 'rejected'
  | 'stale'
  | 'committed'
  | 'committed_with_observer_errors'
  | 'rolled_back'
  | 'rollback_incomplete'
  | 'revoked'

export interface AgentCommandAuditSummary {
  readonly count: number
  readonly types: readonly string[]
  readonly nodeIds: readonly string[]
  readonly componentNames: readonly string[]
  readonly propKeys: readonly string[]
  readonly extraKeys: readonly string[]
}

export interface AgentAuditRecord {
  readonly version: 1
  readonly auditId: string
  readonly timestamp: number
  readonly capabilityId: string
  readonly subjectId: string
  readonly assurance: AgentCapabilityAssurance
  readonly action: AgentAuditAction
  readonly decision: 'allowed' | 'denied'
  readonly outcome: AgentAuditOutcome
  readonly engineState: string
  readonly hostTrust: string
  readonly documentId?: string
  readonly planId?: string
  readonly baseRevision?: string
  readonly currentRevision?: string
  readonly commands?: AgentCommandAuditSummary
  readonly error?: {
    readonly name: string
    readonly code: string
    readonly committed: boolean
    readonly rollbackComplete?: boolean
    readonly terminal: boolean
  }
}

export type AgentAuditListener = (record: AgentAuditRecord) => void

export interface AgentTransactionCommittedEvent {
  readonly version: 1
  readonly type: 'agent.transaction.committed'
  readonly eventId: string
  readonly sequence: number
  readonly timestamp: number
  readonly capabilityId: string
  readonly subjectId: string
  readonly documentId: string
  readonly planId: string
  readonly baseRevision: string
  readonly revision?: string
  readonly status: AgentExecutionStatus
  readonly commandCount: number
  readonly commandTypes: readonly AgentCommandType[]
  readonly affectedNodeIds: readonly string[]
  readonly observerErrorCount: number
}

export type AgentDomainEvent = AgentTransactionCommittedEvent

export type AgentDomainEventListener = (event: AgentDomainEvent) => void

export interface AgentMessagePort {
  postMessage(value: unknown): void
  start?(): void
  close(): void
}

export type AgentPortExecutionAuthority = 'peer' | 'host'

export interface AgentPortSessionDescriptor {
  readonly protocol: 1
  readonly transport: 'message-port'
  readonly isolation: 'structured-clone-object-capability'
  readonly executionAuthority: AgentPortExecutionAuthority
  readonly capability: AgentCapabilityDescriptor
}

export interface AgentPortSessionOptions {
  readonly signal: AbortSignal
  /** Defaults to peer. Host authority keeps execution behind approveAndExecute(). */
  readonly executionAuthority?: AgentPortExecutionAuthority
}

export interface AgentPortClientOptions {
  /** Cancels the client connection and all pending requests. */
  readonly signal?: AbortSignal
  /** Maximum time to wait for the host handshake. Defaults to 10 seconds. */
  readonly connectTimeoutMs?: number
  /** Maximum time to wait for each host response. Defaults to 30 seconds. */
  readonly requestTimeoutMs?: number
}

export interface AgentPortSession {
  readonly descriptor: AgentPortSessionDescriptor
  readonly state: 'open' | 'closing' | 'closed'
  /** Executes a prepared plan from the trusted host realm. */
  approveAndExecute(planId: string): AgentExecutionReceipt
  /** Returns the immutable Core preview currently prepared for this host session. */
  getPreparedPlanPreview(planId: string): AgentPlanPreview
  close(): void
}

export interface AgentPortCapability {
  readonly descriptor: AgentPortSessionDescriptor
  snapshot(documentId: string): Promise<AgentDocumentSnapshot>
  preview(request: AgentPlanRequest): Promise<AgentPlanPreview>
  execute(planId: string): Promise<AgentExecutionReceipt>
  subscribe(listener: AgentDomainEventListener): () => void
  close(): void
}

export interface AgentCapability {
  readonly descriptor: AgentCapabilityDescriptor
  snapshot(documentId: string): AgentDocumentSnapshot
  /** Accept only data created by a trusted JSON/message parser, never live untrusted objects. */
  preview(request: AgentPlanRequest): AgentPlanPreview
  execute(planId: string): AgentExecutionReceipt
  close(): void
}
