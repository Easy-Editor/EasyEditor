import type {
  AgentWorkerOptions,
  Clock,
  IdFactory,
  ModelAdapter,
  WorkerTelemetryEvent,
} from '@easy-editor/agent-runtime/worker'

export interface AgentRuntimeE2EWorkerRuntimeOptions {
  readonly start: (options: AgentWorkerOptions) => Promise<void>
  readonly port: MessagePort
  readonly model: ModelAdapter
  readonly clock: Clock
  readonly idFactory: IdFactory
  readonly generation: number
  readonly postControl: (
    message: Readonly<{
      schemaVersion: 1
      kind: 'telemetry'
      generation: number
      event: WorkerTelemetryEvent
    }>,
  ) => void
}

export declare const startAgentRuntimeE2EWorkerRuntime: (options: AgentRuntimeE2EWorkerRuntimeOptions) => Promise<void>
