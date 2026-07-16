import type { AgentHost, AgentPersistencePort } from '../../contracts.js'
import type { agentBoundaryRpcContracts } from './contracts.js'
import { type RpcHandlers, RpcRemoteError } from './peer.js'

const safePersistenceErrorCodes = new Set([
  'generation-conflict',
  'validation-failed',
  'read-only-compatibility',
  'storage-unavailable',
  'database-blocked',
  'quota-exceeded',
  'transaction-aborted',
  'integrity-mismatch',
  'migration-failed',
  'disposed',
])

const persistenceOperation = async <Value>(operation: () => Promise<Value>): Promise<Value> => {
  try {
    return await operation()
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : null
    if (code && safePersistenceErrorCodes.has(code)) {
      throw new RpcRemoteError(code, `persistence operation failed: ${code}`)
    }
    throw error
  }
}

export const createAgentBoundaryRpcHandlers = (
  host: AgentHost,
  persistence: AgentPersistencePort,
): RpcHandlers<typeof agentBoundaryRpcContracts> => ({
  'host.observe': request => host.observe(request),
  'host.describeCapability': request => host.describeCapability(request),
  'host.invoke': request => host.invoke(request.call, request.context),
  'host.queryReceipt': request => host.queryReceipt(request),
  'persistence.read': request => persistenceOperation(() => persistence.read(request)),
  'persistence.commit': request => persistenceOperation(() => persistence.commit(request)),
})
