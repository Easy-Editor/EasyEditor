import type { createProductionAgentWorkerEndpoint } from './endpoint.mjs'

export type {
  ProductionAgentWorkerEndpoint,
  ProductionAgentWorkerEndpointOptions,
} from './endpoint.mjs'
export type { ProductionAgentGrantAuthority, ProductionAgentModelConfig } from './protocol.mjs'
export { createProductionAgentGrantAuthority, readProductionAgentModelConfig } from './protocol.mjs'

export declare const loadProductionAgentWorkerEndpointFactory: () => Promise<typeof createProductionAgentWorkerEndpoint>
