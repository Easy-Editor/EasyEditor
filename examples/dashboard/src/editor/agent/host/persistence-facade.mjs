const requireMethod = (value, key) => {
  const method = value?.[key]
  if (typeof method !== 'function') throw new TypeError(`Dashboard Host persistence requires ${key}`)
  return (...args) => method.call(value, ...args)
}

export const createDashboardHostPersistenceFacade = (persistence, options = {}) => {
  const runAgentMutation =
    typeof persistence?.runAgentMutation === 'function' ? (...args) => persistence.runAgentMutation(...args) : undefined
  const readCompensationRun = requireMethod(persistence, 'readCompensationRun')
  const readCompensationTargetClaim = requireMethod(persistence, 'readCompensationTargetClaim')
  const commitCompensationRunState = requireMethod(persistence, 'commitCompensationRunState')
  const recoverDurableAgentReceipt = requireMethod(persistence, 'recoverDurableAgentReceipt')
  const runDurableAgentWrite = requireMethod(persistence, 'runDurableAgentWrite')
  const afterRecordIntent = options.afterRecordIntent
  const afterCommitBatch = options.afterCommitBatch
  if (afterRecordIntent !== undefined && typeof afterRecordIntent !== 'function') {
    throw new TypeError('Dashboard Host persistence afterRecordIntent must be a function')
  }
  if (afterCommitBatch !== undefined && typeof afterCommitBatch !== 'function') {
    throw new TypeError('Dashboard Host persistence afterCommitBatch must be a function')
  }

  return Object.freeze({
    ...(runAgentMutation ? { runAgentMutation } : {}),
    readCompensationRun,
    readCompensationTargetClaim,
    commitCompensationRunState,
    recoverDurableAgentReceipt,
    runDurableAgentWrite(operation) {
      if (typeof operation !== 'function') {
        return Promise.reject(new TypeError('Dashboard Host durable write operation must be a function'))
      }
      return runDurableAgentWrite(session =>
        operation(
          Object.freeze({
            draft: session.draft,
            async recordIntent(intent) {
              const recorded = await session.recordIntent(intent)
              await afterRecordIntent?.(recorded)
              return recorded
            },
            readReceiptLineage: request => session.readReceiptLineage(request),
            readMutationProvenance: request => session.readMutationProvenance(request),
            async commitBatch(batch) {
              const committed = await session.commitBatch(batch)
              await afterCommitBatch?.(committed)
              return committed
            },
          }),
        ),
      )
    },
  })
}
