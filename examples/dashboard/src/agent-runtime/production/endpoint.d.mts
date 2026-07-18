import type { AgentWorkerEndpoint } from '@easy-editor/agent-runtime'
import type { WorkerTelemetrySink } from '@easy-editor/agent-runtime/worker'
import type { ProductionAgentModelConfig } from './protocol.mjs'

export interface ProductionAgentWorkerEndpoint extends AgentWorkerEndpoint {
  ready(): Promise<void>
}

export interface ProductionAgentWorkerEndpointOptions {
  readonly config: ProductionAgentModelConfig
  readonly telemetry?: WorkerTelemetrySink
}

export interface ProductionAgentWorkerLike {
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  addEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  postMessage(message: unknown, transfer: readonly Transferable[]): void
  terminate(): void
}

export interface ProductionAgentWorkerPlatform {
  createMessageChannel(): MessageChannel
  createWorker(generation: number): ProductionAgentWorkerLike
  queueMicrotask(callback: () => void): void
}

export declare const createProductionAgentWorkerEndpoint: (
  options: ProductionAgentWorkerEndpointOptions,
) => ProductionAgentWorkerEndpoint

/** @internal Pure factory seam for endpoint lifecycle tests. */
export declare const createProductionAgentWorkerEndpointForPlatform: (
  options: ProductionAgentWorkerEndpointOptions,
  platform: ProductionAgentWorkerPlatform,
) => ProductionAgentWorkerEndpoint
