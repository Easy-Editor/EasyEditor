const requireMethod = (value, method) => {
  if (!value || typeof value[method] !== 'function') throw new TypeError(`persistence.${method} must be a function`)
  return value[method].bind(value)
}

const requireString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return value
}

const clone = value => structuredClone(value)

const normalizeAuthority = authority =>
  Object.freeze({
    projectId: requireString(authority?.projectId, 'authority.projectId'),
    branchId: requireString(authority?.branchId, 'authority.branchId'),
    sessionId: requireString(authority?.sessionId, 'authority.sessionId'),
    taskId: requireString(authority?.taskId, 'authority.taskId'),
  })

const assertScope = (authority, value, fields) => {
  for (const field of fields) {
    if (value?.[field] !== authority[field]) throw new TypeError(`promotion persistence ${field} authority mismatch`)
  }
}

const projectJournal = (authority, record, callId) => ({
  schemaVersion: 1,
  projectId: authority.projectId,
  branchId: authority.branchId,
  sessionId: authority.sessionId,
  taskId: authority.taskId,
  callId,
  recordId: record.recordId,
  kind: record.kind,
  value: clone(record.value),
})

export const createDashboardLocalMaterialPromotionPersistenceAdapter = options => {
  if (!options || typeof options !== 'object') throw new TypeError('promotion persistence adapter options are required')
  const authority = normalizeAuthority(options.authority)
  const persistence = options.persistence
  const readAgentPersistence = requireMethod(persistence, 'readAgentPersistence')
  const commitAgentPersistence = requireMethod(persistence, 'commitAgentPersistence')
  const readArtifact = requireMethod(persistence, 'readArtifact')
  const recoverDurableAgentReceipt = requireMethod(persistence, 'recoverDurableAgentReceipt')
  const runDurableAgentWrite = requireMethod(persistence, 'runDurableAgentWrite')
  const checkLocalGrant = requireMethod(persistence, 'checkLocalGrant')

  let observedGeneration = 0
  const readRecords = async () => {
    const result = await readAgentPersistence({
      schemaVersion: 1,
      projectId: authority.projectId,
      branchId: authority.branchId,
      sessionId: authority.sessionId,
      expectedPersistenceGeneration: observedGeneration,
    })
    if (!Number.isSafeInteger(result?.persistenceGeneration) || result.persistenceGeneration < 0) {
      throw new Error('promotion persistence returned an invalid generation')
    }
    observedGeneration = result.persistenceGeneration
    if (!Array.isArray(result.records)) throw new Error('promotion persistence returned invalid records')
    return result.records
  }

  const writePromotionJournal = async journal => {
    assertScope(authority, journal, ['projectId', 'branchId', 'sessionId', 'taskId'])
    const callId = requireString(journal.callId, 'journal.callId')
    const recordId = requireString(journal.recordId, 'journal.recordId')
    if (recordId !== `promotion:${callId}` || journal.kind !== 'local-material-promotion') {
      throw new TypeError('promotion journal identity is invalid')
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await readRecords()
      const expectedPersistenceGeneration = observedGeneration
      const result = await commitAgentPersistence({
        schemaVersion: 1,
        projectId: authority.projectId,
        branchId: authority.branchId,
        sessionId: authority.sessionId,
        batchId: `promotion-journal:${encodeURIComponent(callId)}:${encodeURIComponent(
          journal.value?.stage ?? 'unknown',
        )}:${expectedPersistenceGeneration}:${attempt}`,
        expectedPersistenceGeneration,
        records: [{ recordId, kind: journal.kind, value: clone(journal.value) }],
      })
      if (result?.status === 'committed') {
        observedGeneration = result.persistenceGeneration
        return Object.freeze(clone(journal))
      }
      if (result?.status !== 'generation-conflict') {
        throw new Error(result?.failure?.message ?? 'promotion journal persistence was rejected')
      }
      observedGeneration = result.persistenceGeneration
    }
    throw new Error('promotion journal persistence generation did not converge')
  }

  return Object.freeze({
    checkLocalGrant,
    readArtifact,
    recoverDurableAgentReceipt,
    runDurableAgentWrite,
    async readPromotionJournal(request) {
      assertScope(authority, request, ['projectId', 'branchId', 'sessionId'])
      const callId = requireString(request.callId, 'readPromotionJournal.callId')
      const record = (await readRecords()).find(
        candidate => candidate.recordId === `promotion:${callId}` && candidate.kind === 'local-material-promotion',
      )
      return record ? projectJournal(authority, record, callId) : null
    },
    async listPromotionJournals(request) {
      assertScope(authority, request, ['projectId', 'branchId', 'sessionId'])
      return Object.freeze(
        (await readRecords())
          .filter(
            record =>
              record.kind === 'local-material-promotion' &&
              typeof record.recordId === 'string' &&
              record.recordId.startsWith('promotion:'),
          )
          .map(record => projectJournal(authority, record, record.recordId.slice('promotion:'.length))),
      )
    },
    writePromotionJournal,
  })
}
