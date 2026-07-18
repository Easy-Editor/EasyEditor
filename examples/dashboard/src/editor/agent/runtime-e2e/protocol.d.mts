import type { ScriptedModelFault } from '@easy-editor/agent-runtime/testing'
import type { ModelEvent, ModelTurnPhase, WorkerTelemetryEvent } from '@easy-editor/agent-runtime/worker'

export declare const AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION: 1

export type AgentRuntimeE2EWorkerErrorCode =
  | 'disabled'
  | 'invalid-handshake'
  | 'invalid-steps'
  | 'terminated-before-ready'
  | 'worker-fault'

export declare class AgentRuntimeE2EWorkerError extends Error {
  readonly code: AgentRuntimeE2EWorkerErrorCode
  constructor(code: AgentRuntimeE2EWorkerErrorCode, message: string, options?: ErrorOptions)
}

/** ScriptedModelStep without the non-transferable matchRequest callback. */
export interface AgentRuntimeE2EScriptedModelStep {
  readonly expectedPhase: ModelTurnPhase
  readonly events: readonly ModelEvent[]
  readonly delayMs?: number
  readonly fault?: ScriptedModelFault
}

export type AgentRuntimeE2EWorkerControlMessage =
  | Readonly<{
      schemaVersion: 1
      kind: 'ready'
      generation: number
    }>
  | Readonly<{
      schemaVersion: 1
      kind: 'fault'
      generation: number
      message: string
    }>
  | Readonly<{
      schemaVersion: 1
      kind: 'telemetry'
      generation: number
      event: WorkerTelemetryEvent
    }>

export declare const cloneAgentRuntimeE2ESteps: (
  steps: readonly AgentRuntimeE2EScriptedModelStep[],
) => readonly AgentRuntimeE2EScriptedModelStep[]

export declare const parseAgentRuntimeE2EWorkerControlMessage: (value: unknown) => AgentRuntimeE2EWorkerControlMessage
