import type {
  AgentHost,
  AgentPersistenceBatch,
  AgentPersistencePort,
  AgentRuntime,
  AgentRuntimeOptions,
  AgentRuntimeRecovery,
  AgentRuntimeSnapshot,
  AgentSessionContextDigest,
  AgentTaskSnapshot,
  AgentWorkerOptions,
  HostInvocationContextV1,
  HostSnapshot,
  HostSnapshotDelta,
  HostSnapshotDeltaChange,
  JsonObject,
  ModelAdapter,
  ModelTurnRequest,
  RuntimeTaskCompensationTargetV1,
  SemanticCall,
  TaskRef,
  ToolReceipt,
} from '../src/contracts.js'

declare const runtime: AgentRuntime
declare const host: AgentHost
declare const persistence: AgentPersistencePort
declare const model: ModelAdapter
declare const request: ModelTurnRequest
declare const call: SemanticCall

const snapshot: AgentRuntimeSnapshot = runtime.getSnapshot()
type CompensationEligibilityIsRequired = AgentTaskSnapshot extends { readonly compensationEligible: boolean }
  ? true
  : false
const compensationEligibilityIsRequired: CompensationEligibilityIsRequired = true
const compensationEligible: boolean | undefined = snapshot.activeTask?.compensationEligible
const recovery: AgentRuntimeRecovery | undefined = snapshot.recoveries[0]
const compensatedTaskId: string | undefined = snapshot.activeTask?.compensatesTaskId
const task: Promise<TaskRef> = runtime.submit({ text: 'Build the dashboard' })
const compensation: Promise<void> = runtime.compensate('target-task')
const observation: Promise<HostSnapshot | { readonly schemaVersion: 1 }> = host.observe({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'branch-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  mode: 'full',
})
const fullSnapshot: HostSnapshot = {
  schemaVersion: 1,
  revision: 'revision-1',
  providerGenerations: { 'dashboard.core': 1 },
  projection: { 'dashboard.core': {} },
}
// @ts-expect-error full snapshots require a provider generation vector
const invalidFullSnapshot: HostSnapshot = { schemaVersion: 1, revision: 'revision-1', projection: {} }
const deltaChange: HostSnapshotDeltaChange = { op: 'set', path: ['nodes', 'node-1', 'props'], value: {} }
const delta: HostSnapshotDelta = {
  schemaVersion: 1,
  baseRevision: 'revision-1',
  newRevision: 'revision-2',
  providerId: 'dashboard.core',
  providerGeneration: 1,
  baseCursor: 'cursor-1',
  newCursor: 'cursor-2',
  changes: [deltaChange, { op: 'remove', path: ['nodes', 'node-2'] }],
}

// @ts-expect-error delta paths must be non-empty
const invalidDeltaChange: HostSnapshotDeltaChange = { op: 'remove', path: [] }
const compensationTarget: RuntimeTaskCompensationTargetV1 = {
  schemaVersion: 1,
  taskId: 'target-task',
  sessionId: 'session-1',
  phase: 'COMPLETED',
  callIndexComplete: true,
  callIndex: [{ callId: 'call-0', capability: 'screen.applyChangeSet' }],
}
const invocationContext: HostInvocationContextV1 = { schemaVersion: 1, compensationTarget }
const invocation = host.invoke(call, invocationContext)
// @ts-expect-error Runtime-owned invocation context is a required, separate Host argument
host.invoke(call)
const receipt: ToolReceipt = {
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'branch-1',
  callId: 'call-1',
  status: 'not-applied',
  failure: { code: 'NO_CHANGE', message: 'already satisfied', retryable: false },
}
// @ts-expect-error applied receipts cannot carry failure metadata
const invalidAppliedReceipt: ToolReceipt = { ...receipt, status: 'applied' }
// @ts-expect-error non-applied receipts require typed failure metadata
const invalidFailedReceipt: ToolReceipt = {
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'branch-1',
  callId: 'call-2',
  status: 'not-applied',
}
const events = model.run(request, new AbortController().signal)
const sessionContext: AgentSessionContextDigest = request.sessionContext

const batch: AgentPersistenceBatch = {
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'branch-1',
  sessionId: 'session-1',
  batchId: 'batch-1',
  expectedPersistenceGeneration: 0,
  records: [{ recordId: 'record-1', kind: 'journal', value: { phase: 'OBSERVE' } }],
}
const commit = persistence.commit(batch)

const options: AgentRuntimeOptions = {
  binding: { projectId: 'project-1', branchId: 'branch-1' },
  worker: { port: new MessageChannel().port1, onFault: () => () => {}, terminate() {} },
  host,
  persistence,
}

const workerOptions: AgentWorkerOptions = {
  port: new MessageChannel().port2,
  model,
  sessionContextBudget: { maxTurns: 4, maxTextBytes: 4_096, maxUnresolvedConstraints: 8 },
}

const json: JsonObject = { nested: { values: [true, 1, 'safe', null] } }

// @ts-expect-error functions are not JSON-safe DTO values
const invalidJson: JsonObject = { callback: () => undefined }

// @ts-expect-error a Worker-local model is not part of main-thread runtime composition
const invalidOptions: AgentRuntimeOptions = { ...options, model }

void snapshot
void compensationEligibilityIsRequired
void compensationEligible
void recovery
void compensatedTaskId
void task
void compensation
void observation
void fullSnapshot
void invalidFullSnapshot
void delta
void invalidDeltaChange
void invocation
void invocationContext
void compensationTarget
void receipt
void events
void sessionContext
void commit
void options
void workerOptions
void json
void invalidJson
void invalidOptions
