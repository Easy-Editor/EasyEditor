const freezeStore = (name, keyPath) =>
  Object.freeze({
    name,
    keyPath: Array.isArray(keyPath) ? Object.freeze([...keyPath]) : keyPath,
  })

export const DASHBOARD_STORAGE_VERSION_ZERO_FIXTURE = Object.freeze({
  name: 'version-zero-empty-database',
  oldVersion: 0,
  existingStores: Object.freeze([]),
})

export const DASHBOARD_STORAGE_PARTIAL_V1_RESUME_FIXTURE = Object.freeze({
  name: 'partial-version-one-resume',
  oldVersion: 0,
  existingStores: Object.freeze([
    freezeStore('projects', 'projectId'),
    freezeStore('workingDrafts', ['projectId', 'branchId']),
    freezeStore('projectVersions', ['projectId', 'branchId', 'versionId']),
    freezeStore('agentSessions', ['projectId', 'branchId', 'sessionId']),
    freezeStore('taskJournals', ['projectId', 'branchId', 'sessionId', 'recordId']),
  ]),
})
