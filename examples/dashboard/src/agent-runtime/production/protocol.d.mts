import type { WorkerTelemetryEvent } from '@easy-editor/agent-runtime/worker'

export interface ProductionAgentModelConfig {
  readonly providerId: string
  readonly model: string
  readonly path: string
}

export interface ProductionAgentGrantAuthority {
  readonly userId: 'dashboard-browser-session'
  readonly policyVersion: 'dashboard-agent-gateway/1'
  readonly providerId: string
  readonly providerFingerprint: string
  readonly providerLabel: string
}

export type ProductionAgentWorkerControlMessage =
  | Readonly<{ schemaVersion: 1; kind: 'ready'; generation: number }>
  | Readonly<{ schemaVersion: 1; kind: 'fault'; generation: number; message: string }>
  | Readonly<{ schemaVersion: 1; kind: 'telemetry'; generation: number; event: WorkerTelemetryEvent }>

export interface ProductionAgentWorkerStartMessage {
  readonly schemaVersion: 1
  readonly kind: 'start'
  readonly generation: number
  readonly port: MessagePort
  readonly config: ProductionAgentModelConfig
}

export declare const PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION: 1
export declare const DEFAULT_PRODUCTION_AGENT_PROVIDER_ID: 'default'
export declare const DEFAULT_PRODUCTION_AGENT_MODEL_PATH: '/api/agent/model/stream'
export declare const PRODUCTION_AGENT_MODEL_ENV: Readonly<{
  providerId: 'VITE_DASHBOARD_AGENT_MODEL_PROVIDER_ID'
  model: 'VITE_DASHBOARD_AGENT_MODEL'
  path: 'VITE_DASHBOARD_AGENT_MODEL_PATH'
}>

export declare class ProductionAgentWorkerError extends Error {
  readonly code: string
}

export declare const cloneProductionAgentModelConfig: (value: unknown) => Readonly<ProductionAgentModelConfig>
export declare const readProductionAgentModelConfig: (
  source?: Readonly<Record<string, unknown>>,
) => Readonly<ProductionAgentModelConfig>
export declare const createProductionAgentGrantAuthority: (
  config: ProductionAgentModelConfig,
) => Readonly<ProductionAgentGrantAuthority>
export declare const parseProductionAgentWorkerControlMessage: (value: unknown) => ProductionAgentWorkerControlMessage
export declare const parseProductionAgentWorkerStartMessage: (
  value: unknown,
) => Readonly<Pick<ProductionAgentWorkerStartMessage, 'generation' | 'port' | 'config'>>
