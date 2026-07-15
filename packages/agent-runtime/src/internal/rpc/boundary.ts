import type { AgentHost, AgentPersistencePort } from '../../contracts.js'
import { agentBoundaryRpcContracts, type RpcHandlers } from './contracts.js'

export const createAgentBoundaryRpcHandlers = (
  host: AgentHost,
  persistence: AgentPersistencePort,
): RpcHandlers<typeof agentBoundaryRpcContracts> => ({
  'host.observe': request => host.observe(request),
  'host.describeCapability': request => host.describeCapability(request),
  'host.invoke': request => host.invoke(request),
  'host.queryReceipt': request => host.queryReceipt(request),
  'persistence.read': request => persistence.read(request),
  'persistence.commit': request => persistence.commit(request),
})
