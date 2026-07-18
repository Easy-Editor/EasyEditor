import type { AgentWorkerEndpoint } from '@easy-editor/agent-runtime'
import type { WorkerTelemetrySink } from '@easy-editor/agent-runtime/worker'
import type { AgentRuntimeE2EScriptedModelStep } from './protocol.mjs'

export interface AgentRuntimeE2EWorkerEndpoint extends AgentWorkerEndpoint {
  /** Resolves after the module Worker has installed its Agent Runtime RPC peer. */
  ready(): Promise<void>
}

export interface AgentRuntimeE2EWorkerEndpointOptions {
  readonly steps: readonly AgentRuntimeE2EScriptedModelStep[]
  readonly telemetry?: WorkerTelemetrySink
}

export interface AgentRuntimeE2EWorkerLike {
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  addEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  postMessage(message: unknown, transfer: readonly Transferable[]): void
  terminate(): void
}

export interface AgentRuntimeE2EWorkerPlatform {
  createMessageChannel(): MessageChannel
  createWorker(generation: number): AgentRuntimeE2EWorkerLike
  queueMicrotask(callback: () => void): void
}

export declare const createAgentRuntimeE2EWorkerEndpoint: (
  options: AgentRuntimeE2EWorkerEndpointOptions,
) => AgentRuntimeE2EWorkerEndpoint

/** @internal Pure factory seam for endpoint contract tests. */
export declare const createAgentRuntimeE2EWorkerEndpointForPlatform: (
  options: AgentRuntimeE2EWorkerEndpointOptions,
  platform: AgentRuntimeE2EWorkerPlatform,
) => AgentRuntimeE2EWorkerEndpoint
