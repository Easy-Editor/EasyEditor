import { createAgentRuntime } from '../src/index.js'
import type {
  AgentHost,
  AgentPersistencePort,
  AgentRuntime,
  AgentWorkerEndpoint,
  HostInvocationContextV1,
  HostSnapshotDeltaChange,
  HostSnapshotRemoveChange,
  HostSnapshotSetChange,
  RuntimeTaskCompensationTargetV1,
} from '../src/index.js'
import {
  DeterministicClock,
  DeterministicIdFactory,
  FakeAgentHost,
  MemoryAgentPersistence,
  ScriptedModelAdapter,
} from '../src/testing.js'
import { startAgentWorker } from '../src/worker.js'
import type { ModelAdapter, ModelEvent, ModelTurnRequest } from '../src/worker.js'

declare const endpoint: AgentWorkerEndpoint
declare const host: AgentHost
declare const persistence: AgentPersistencePort
declare const model: ModelAdapter
declare const request: ModelTurnRequest

const runtime: AgentRuntime = createAgentRuntime({
  binding: { projectId: 'project-1', branchId: 'branch-1' },
  worker: endpoint,
  host,
  persistence,
})
const events: AsyncIterable<ModelEvent> = model.run(request, new AbortController().signal)
const worker: Promise<void> = startAgentWorker({ port: new MessageChannel().port1, model })
const setChange: HostSnapshotSetChange = { op: 'set', path: ['nodes', 'node-1'], value: {} }
const removeChange: HostSnapshotRemoveChange = { op: 'remove', path: ['nodes', 'node-2'] }
const changes: readonly HostSnapshotDeltaChange[] = [setChange, removeChange]
const compensationTarget: RuntimeTaskCompensationTargetV1 = {
  schemaVersion: 1,
  taskId: 'task-0',
  sessionId: 'session-1',
  phase: 'CANCELLED',
  callIndexComplete: true,
  callIndex: [],
}
const invocationContext: HostInvocationContextV1 = { schemaVersion: 1, compensationTarget }

new ScriptedModelAdapter([{ expectedPhase: 'BLUEPRINT', events: [] }])
new MemoryAgentPersistence()
new FakeAgentHost()
new DeterministicClock()
new DeterministicIdFactory()

// @ts-expect-error ModelAdapter is intentionally Worker-only.
type RootModelAdapter = import('../src/index.js').ModelAdapter

// @ts-expect-error protocol parsers are package-private.
type RootProtocolEnvelope = import('../src/index.js').ProtocolEnvelope

void runtime
void events
void worker
void changes
void invocationContext
void compensationTarget
void (undefined as unknown as RootModelAdapter)
void (undefined as unknown as RootProtocolEnvelope)
