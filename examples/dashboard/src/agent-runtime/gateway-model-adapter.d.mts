import type { ModelAdapter, ModelEvent, ModelTurnRequest } from '@easy-editor/agent-runtime/worker'

export declare const DEFAULT_GATEWAY_MODEL_PATH: '/api/agent/model/stream'
export declare const GATEWAY_MODEL_TOKEN_BUDGET: 4096

export interface GatewayModelAdapterOptions {
  readonly providerId: string
  readonly model: string
  readonly path?: string
  readonly fetch?: typeof globalThis.fetch
  readonly deadlineMs?: number
  readonly maxResponseBytes?: number
  readonly maxResponseLines?: number
  readonly maxEvents?: number
  readonly maxOutputBytes?: number
}

export type GatewayModelAdapterErrorCode =
  | 'gateway-aborted'
  | 'gateway-deadline'
  | 'gateway-http'
  | 'gateway-rate-limited'
  | 'gateway-unavailable'
  | 'invalid-config'
  | 'invalid-correlation'
  | 'invalid-gateway-stream'
  | 'invalid-model-output'
  | 'request-budget-exceeded'
  | 'response-budget-exceeded'

export declare class GatewayModelAdapterError extends Error {
  readonly code: GatewayModelAdapterErrorCode

  constructor(code: GatewayModelAdapterErrorCode)
}

export declare class GatewayModelAdapter implements ModelAdapter {
  #private

  constructor(options: GatewayModelAdapterOptions)

  run(request: ModelTurnRequest, signal: AbortSignal): AsyncIterable<ModelEvent>
}
