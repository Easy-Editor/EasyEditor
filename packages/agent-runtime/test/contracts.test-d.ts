import type {
  AgentHost,
  AgentPersistenceBatch,
  AgentPersistencePort,
  AgentRuntime,
  AgentRuntimeOptions,
  AgentRuntimeSnapshot,
  AgentWorkerOptions,
  HostSnapshot,
  JsonObject,
  ModelAdapter,
  ModelTurnRequest,
  SemanticCall,
  TaskRef,
} from '../src/contracts.js'

declare const runtime: AgentRuntime
declare const host: AgentHost
declare const persistence: AgentPersistencePort
declare const model: ModelAdapter
declare const request: ModelTurnRequest
declare const call: SemanticCall

const snapshot: AgentRuntimeSnapshot = runtime.getSnapshot()
const task: Promise<TaskRef> = runtime.submit({ text: 'Build the dashboard' })
const observation: Promise<HostSnapshot | { readonly schemaVersion: 1 }> = host.observe({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'branch-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  mode: 'full',
})
const invocation = host.invoke(call)
const events = model.run(request, new AbortController().signal)

const batch: AgentPersistenceBatch = {
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'branch-1',
  sessionId: 'session-1',
  batchId: 'batch-1',
  expectedDraftGeneration: 0,
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
}

const json: JsonObject = { nested: { values: [true, 1, 'safe', null] } }

// @ts-expect-error functions are not JSON-safe DTO values
const invalidJson: JsonObject = { callback: () => undefined }

// @ts-expect-error a Worker-local model is not part of main-thread runtime composition
const invalidOptions: AgentRuntimeOptions = { ...options, model }

void snapshot
void task
void observation
void invocation
void events
void commit
void options
void workerOptions
void json
void invalidJson
void invalidOptions
