export { createProductionAgentGrantAuthority, readProductionAgentModelConfig } from './protocol.mjs'

export const loadProductionAgentWorkerEndpointFactory = async () => {
  const { createProductionAgentWorkerEndpoint } = await import('./endpoint.mjs')
  return createProductionAgentWorkerEndpoint
}
