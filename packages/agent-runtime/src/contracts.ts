/** Values that are safe to validate and send across a structured-clone boundary. */
export type JsonPrimitive = boolean | number | string | null

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]

export interface JsonObject {
  readonly [key: string]: JsonValue
}

export interface AgentRuntimeBinding {
  readonly projectId: string
  readonly branchId: string
  readonly sessionId?: string
}

export interface BoundAgentRuntimeBinding extends AgentRuntimeBinding {
  readonly sessionId: string
}

export interface UserIntent {
  readonly text: string
  readonly metadata?: JsonObject
}

export interface UserResponse {
  readonly questionId: string
  readonly value: JsonValue
}

export interface TaskRef {
  readonly taskId: string
  readonly sessionId: string
  readonly parentTaskId?: string
  readonly supersedesTaskId?: string
}

export type AgentPhase =
  | 'IDLE'
  | 'OBSERVE'
  | 'BLUEPRINT'
  | 'WAITING_USER'
  | 'PLAN_STEP'
  | 'EXECUTE'
  | 'YIELDED'
  | 'QUERY_RECEIPT'
  | 'VERIFY'
  | 'REPAIR'
  | 'CHECKPOINT'
  | 'PAUSED'
  | 'RECOVERING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'

export type AgentRuntimeStatus = 'initializing' | 'ready' | 'recovering' | 'disposed' | 'failed'

export interface AgentRuntimeFailure {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly details?: JsonObject
}

export interface AgentQuestion {
  readonly questionId: string
  readonly prompt: string
  readonly responseSchema?: JsonObject
}

export interface AgentTaskSnapshot extends TaskRef {
  readonly phase: AgentPhase
  readonly createdAt: number
  readonly updatedAt: number
  readonly repairAttempts: number
  readonly question?: AgentQuestion
  readonly failure?: AgentRuntimeFailure
}

export interface AgentRuntimeSnapshot {
  readonly schemaVersion: 1
  readonly binding: BoundAgentRuntimeBinding
  readonly status: AgentRuntimeStatus
  readonly phase: AgentPhase
  readonly revision: number
  readonly activeTask?: AgentTaskSnapshot
  readonly tasks: readonly AgentTaskSnapshot[]
  readonly failure?: AgentRuntimeFailure
}

export interface AgentRuntime {
  submit(input: UserIntent): Promise<TaskRef>
  pause(taskId: string): Promise<void>
  resume(taskId: string): Promise<void>
  cancel(taskId: string): Promise<void>
  respond(taskId: string, response: UserResponse): Promise<void>
  getSnapshot(): AgentRuntimeSnapshot
  subscribe(listener: (snapshot: AgentRuntimeSnapshot) => void): () => void
  dispose(): Promise<void>
}

export interface AgentWorkerEndpoint {
  readonly port: MessagePort
  onFault(listener: (error: unknown) => void): () => void
  terminate(): void
}

export interface AgentRuntimeOptions {
  readonly binding: AgentRuntimeBinding
  readonly worker: AgentWorkerEndpoint | (() => AgentWorkerEndpoint)
  readonly host: AgentHost
  readonly persistence: AgentPersistencePort
}

export interface ObserveRequest {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly taskId: string
  readonly mode: 'full' | 'delta'
  readonly cursor?: string
}

export interface HostSnapshot {
  readonly schemaVersion: 1
  readonly revision: string
  readonly cursor?: string
  readonly projection: JsonObject
}

export interface HostSnapshotDelta {
  readonly schemaVersion: 1
  readonly baseRevision: string
  readonly newRevision: string
  readonly providerId: string
  readonly providerGeneration: number
  readonly baseCursor: string
  readonly newCursor: string
  readonly changes: readonly JsonObject[]
}

export interface CapabilitySchemaRequest {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly capability: string
}

export interface CapabilitySchema {
  readonly schemaVersion: 1
  readonly capability: string
  readonly revision: string
  readonly input: JsonObject
  readonly output?: JsonObject
}

export interface SemanticCall {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly taskId: string
  readonly stepId: string
  readonly callId: string
  readonly capability: string
  readonly arguments: JsonObject
  readonly expectedRevision: string
}

export type InvocationStatus = 'applied' | 'not-applied' | 'indeterminate' | 'rejected'

export interface InvocationResult {
  readonly schemaVersion: 1
  readonly callId: string
  readonly status: InvocationStatus
  readonly revision?: string
  readonly output?: JsonValue
  readonly failure?: AgentRuntimeFailure
}

export interface ToolReceipt {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly status: InvocationStatus
  readonly revision?: string
  readonly witness?: JsonObject
}

export interface ReceiptQueryRequest {
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
}

export interface AgentHost {
  observe(request: ObserveRequest): Promise<HostSnapshot | HostSnapshotDelta>
  describeCapability(request: CapabilitySchemaRequest): Promise<CapabilitySchema>
  invoke(call: SemanticCall): Promise<InvocationResult>
  queryReceipt(request: ReceiptQueryRequest): Promise<ToolReceipt | null>
}

export interface PersistenceReadRequest {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly expectedDraftGeneration: number
}

export interface PersistenceRecord {
  readonly recordId: string
  readonly kind: string
  readonly value: JsonValue
}

export interface PersistenceReadResult {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly draftGeneration: number
  readonly records: readonly PersistenceRecord[]
}

export interface AgentPersistenceBatch {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly batchId: string
  readonly expectedDraftGeneration: number
  readonly records: readonly PersistenceRecord[]
}

export type PersistenceCommitStatus = 'committed' | 'generation-conflict' | 'rejected'

export interface PersistenceCommitResult {
  readonly schemaVersion: 1
  readonly batchId: string
  readonly status: PersistenceCommitStatus
  readonly draftGeneration: number
  readonly failure?: AgentRuntimeFailure
}

export interface AgentPersistencePort {
  read(request: PersistenceReadRequest): Promise<PersistenceReadResult>
  commit(batch: AgentPersistenceBatch): Promise<PersistenceCommitResult>
}

export interface Clock {
  now(): number
}

export interface IdFactory {
  next(kind: 'session' | 'task' | 'step' | 'message' | 'request' | 'batch'): string
}

export type ModelTurnPhase = 'BLUEPRINT' | 'PLAN_STEP' | 'REPAIR'

export interface ModelTurnRequest {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly taskId: string
  readonly phase: ModelTurnPhase
  readonly intent: UserIntent
  readonly snapshot: HostSnapshot
  readonly response?: UserResponse
  readonly repairAttempts: number
}

export type ModelEvent =
  | {
      readonly schemaVersion: 1
      readonly kind: 'blueprint'
      readonly summary: string
    }
  | {
      readonly schemaVersion: 1
      readonly kind: 'question'
      readonly question: AgentQuestion
    }
  | {
      readonly schemaVersion: 1
      readonly kind: 'tool-call'
      readonly call: SemanticCall
    }
  | {
      readonly schemaVersion: 1
      readonly kind: 'complete'
      readonly summary?: string
    }
  | {
      readonly schemaVersion: 1
      readonly kind: 'pause'
      readonly reason: string
    }

export interface ModelAdapter {
  run(request: ModelTurnRequest, signal: AbortSignal): AsyncIterable<ModelEvent>
}

export interface AgentWorkerOptions {
  readonly port: MessagePort
  readonly model: ModelAdapter
  readonly clock?: Clock
  readonly idFactory?: IdFactory
}
