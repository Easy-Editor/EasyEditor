import { failContract } from './contract.mjs'

const requirePersistenceMethod = (persistence, method) => {
  if (!persistence || typeof persistence[method] !== 'function') {
    return failContract(`persistence-facade-${method}-is-required`, 'DashboardAgentPersistencePort')
  }
  return persistence[method].bind(persistence)
}

export const createDashboardAgentPersistencePort = persistence => {
  const readAgentPersistence = requirePersistenceMethod(persistence, 'readAgentPersistence')
  const commitAgentPersistence = requirePersistenceMethod(persistence, 'commitAgentPersistence')
  return Object.freeze({
    read: request => readAgentPersistence(request),
    commit: batch => commitAgentPersistence(batch),
  })
}
