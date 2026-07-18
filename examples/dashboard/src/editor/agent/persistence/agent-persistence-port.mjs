import { createDashboardTelemetryChannel } from '../../../runtime/telemetry-channel.mjs'
import { failContract } from './contract.mjs'

const requirePersistenceMethod = (persistence, method) => {
  if (!persistence || typeof persistence[method] !== 'function') {
    return failContract(`persistence-facade-${method}-is-required`, 'DashboardAgentPersistencePort')
  }
  return persistence[method].bind(persistence)
}

export const createDashboardAgentPersistencePort = (persistence, options = {}) => {
  const readAgentPersistence = requirePersistenceMethod(persistence, 'readAgentPersistence')
  const commitAgentPersistence = requirePersistenceMethod(persistence, 'commitAgentPersistence')
  const now = typeof options.now === 'function' ? options.now : Date.now
  const telemetry = createDashboardTelemetryChannel(options.telemetry, now)
  const timed = async (eventType, input, operation) => {
    const startedAt = telemetry.start()
    try {
      const result = await operation()
      const commitStatus =
        eventType !== 'dashboard.persistence.commit' || result.status === 'committed' ? result.status : 'rejected'
      telemetry.emit(
        {
          eventType,
          status: eventType === 'dashboard.persistence.commit' ? commitStatus : 'completed',
          sessionId: input.sessionId,
          persistenceGeneration: result.persistenceGeneration,
          recordCount: eventType === 'dashboard.persistence.commit' ? input.records.length : result.records.length,
          ...(eventType === 'dashboard.persistence.commit' && result.status !== 'committed'
            ? { diagnosticCode: result.status === 'generation-conflict' ? 'generation-conflict' : 'commit-rejected' }
            : {}),
        },
        startedAt,
      )
      return result
    } catch (error) {
      telemetry.emit(
        {
          eventType,
          status: 'failed',
          errorCode: 'persistence-operation-failed',
          sessionId: input.sessionId,
          persistenceGeneration: input.expectedPersistenceGeneration,
          ...(eventType === 'dashboard.persistence.commit' ? { recordCount: input.records.length } : {}),
        },
        startedAt,
      )
      throw error
    }
  }
  return Object.freeze({
    read: request => timed('dashboard.persistence.read', request, () => readAgentPersistence(request)),
    commit: batch => timed('dashboard.persistence.commit', batch, () => commitAgentPersistence(batch)),
  })
}
