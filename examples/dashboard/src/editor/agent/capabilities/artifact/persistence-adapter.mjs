const requireMethod = (persistence, method) => {
  if (!persistence || typeof persistence[method] !== 'function') {
    throw new TypeError(`persistence.${method} must be a function`)
  }
  return persistence[method].bind(persistence)
}

export const createDashboardOnlineArtifactPersistenceAdapter = persistence =>
  Object.freeze({
    createArtifact: requireMethod(persistence, 'createArtifact'),
    readArtifact: requireMethod(persistence, 'readArtifact'),
    recoverDurableAgentReceipt: requireMethod(persistence, 'recoverDurableAgentReceipt'),
    runDurableAgentWrite: requireMethod(persistence, 'runDurableAgentWrite'),
  })
