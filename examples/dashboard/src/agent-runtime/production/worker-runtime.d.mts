import type { AgentWorkerOptions, ModelAdapter, WorkerTelemetryEvent } from '@easy-editor/agent-runtime/worker'

export interface ProductionAgentWorkerRuntimeOptions {
  readonly start: (options: AgentWorkerOptions) => Promise<void>
  readonly port: MessagePort
  readonly model: ModelAdapter
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

export declare const startProductionAgentWorkerRuntime: (options: ProductionAgentWorkerRuntimeOptions) => Promise<void>
