import { createAgentRuntime, createAgentTelemetryChangeSetId } from '../src/index.js'
import type {
  AgentAcceptedBlueprint,
  AgentHost,
  AgentPersistencePort,
  AgentRuntime,
  AgentRuntimeRecovery,
  AgentSessionContextDigest,
  AgentTaskSnapshot,
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
import { createWorkerTelemetryLedger, startAgentWorker } from '../src/worker.js'
import type {
  AgentSessionContextBudget,
  ModelAdapter,
  ModelEvent,
  ModelTurnRequest,
  WorkerTelemetryEvent,
  WorkerTelemetrySink,
} from '../src/worker.js'

declare const endpoint: AgentWorkerEndpoint
declare const host: AgentHost
declare const persistence: AgentPersistencePort
declare const model: ModelAdapter
declare const request: ModelTurnRequest

type PublicModelTurnCorrelationIsRequired = ModelTurnRequest extends {
  readonly stepId: string
  readonly modelRequestId: string
}
  ? true
  : false
const publicModelTurnCorrelationIsRequired: PublicModelTurnCorrelationIsRequired = true
const publicModelStepId: string = request.stepId
const publicModelRequestId: string = request.modelRequestId

const runtime: AgentRuntime = createAgentRuntime({
  binding: { projectId: 'project-1', branchId: 'branch-1' },
  worker: endpoint,
  host,
  persistence,
})
const telemetryChangeSetId: string = createAgentTelemetryChangeSetId('call-1')
type PublicCompensationEligibilityIsRequired = AgentTaskSnapshot extends {
  readonly compensationEligible: boolean
}
  ? true
  : false
const publicCompensationEligibilityIsRequired: PublicCompensationEligibilityIsRequired = true
const compensation: Promise<void> = runtime.compensate('task-0')
const recovery: AgentRuntimeRecovery | undefined = runtime.getSnapshot().recoveries[0]
const events: AsyncIterable<ModelEvent> = model.run(request, new AbortController().signal)
const workerBudget: AgentSessionContextBudget = {
  maxTurns: 4,
  maxTextBytes: 4_096,
  maxUnresolvedConstraints: 8,
}
const worker: Promise<void> = startAgentWorker({
  port: new MessageChannel().port1,
  model,
  modelTokenBudget: 4_096,
  sessionContextBudget: workerBudget,
  telemetry: { emit: () => undefined },
})
const telemetrySink: WorkerTelemetrySink = { emit: event => void event.eventType }
const telemetryLedger = createWorkerTelemetryLedger({ capacity: 32 })
const telemetryEvent: WorkerTelemetryEvent = {
  schemaVersion: 1,
  eventType: 'model-request.started',
  timestampMs: 1,
  status: 'started',
  sessionId: 'session-1',
  taskId: 'task-1',
  stepId: 'step-1',
  modelRequestId: 'request-1',
  phase: 'PLAN_STEP',
  tokenBudget: 4_096,
}
const completedTelemetryEvent: WorkerTelemetryEvent = {
  ...telemetryEvent,
  eventType: 'model-request.completed',
  timestampMs: 2,
  durationMs: 1,
  status: 'completed',
}
// @ts-expect-error telemetry has no raw prompt or arbitrary metadata fields
const invalidTelemetryEvent: WorkerTelemetryEvent = { ...telemetryEvent, prompt: 'raw prompt' }
// @ts-expect-error model request completion telemetry requires a measured duration
const invalidUntimedTelemetryEvent: WorkerTelemetryEvent = {
  ...telemetryEvent,
  eventType: 'model-request.completed',
}
const context: AgentSessionContextDigest = request.sessionContext
const acceptedBlueprint: AgentAcceptedBlueprint = {
  schemaVersion: 1,
  summary: 'Build a dashboard',
  unresolvedConstraints: [],
}
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

// @ts-expect-error telemetry is intentionally Worker-only.
type RootTelemetrySink = import('../src/index.js').WorkerTelemetrySink

void runtime
void telemetryChangeSetId
void publicModelTurnCorrelationIsRequired
void publicModelStepId
void publicModelRequestId
void publicCompensationEligibilityIsRequired
void compensation
void recovery
void events
void worker
void workerBudget
void telemetrySink
void telemetryLedger
void telemetryEvent
void completedTelemetryEvent
void invalidTelemetryEvent
void invalidUntimedTelemetryEvent
void context
void acceptedBlueprint
void changes
void invocationContext
void compensationTarget
void (undefined as unknown as RootModelAdapter)
void (undefined as unknown as RootProtocolEnvelope)
void (undefined as unknown as RootTelemetrySink)
