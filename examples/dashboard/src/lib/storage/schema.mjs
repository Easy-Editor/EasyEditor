export const DASHBOARD_STORAGE_DATABASE_NAME = 'easy-editor-dashboard-storage'
export const DASHBOARD_STORAGE_DATABASE_VERSION = 1
export const DASHBOARD_STORAGE_IDENTITY_POINTER_KEY = 'easy-editor:storage:active:v1'
export const DASHBOARD_STORAGE_COMPATIBILITY_MARKER_KEY = 'easy-editor:storage:compatibility:v1'

const descriptor = keyPath =>
  Object.freeze({
    keyPath: Array.isArray(keyPath) ? Object.freeze([...keyPath]) : keyPath,
  })

export const DASHBOARD_STORAGE_STORES = Object.freeze({
  projects: descriptor('projectId'),
  workingDrafts: descriptor(['projectId', 'branchId']),
  projectVersions: descriptor(['projectId', 'branchId', 'versionId']),
  agentSessions: descriptor(['projectId', 'branchId', 'sessionId']),
  taskJournals: descriptor(['projectId', 'branchId', 'sessionId', 'recordId']),
  toolReceipts: descriptor(['projectId', 'branchId', 'callId']),
  receiptIntents: descriptor(['projectId', 'branchId', 'callId']),
  applyWitnesses: descriptor(['projectId', 'branchId', 'callId']),
  failureWitnesses: descriptor(['projectId', 'branchId', 'callId']),
  mutationProvenance: descriptor(['projectId', 'branchId', 'slotKey']),
  agentCheckpoints: descriptor(['projectId', 'branchId', 'checkpointId']),
  artifacts: descriptor(['projectId', 'artifactId', 'sourceRevision']),
  artifactRefs: descriptor(['projectId', 'branchId', 'ownerType', 'ownerId', 'artifactId', 'sourceRevision']),
  grants: descriptor(['userId', 'projectId', 'scope', 'policyVersion']),
  migrationState: descriptor(['projectId', 'branchId']),
})

export const DASHBOARD_STORAGE_STORE_NAMES = Object.freeze(Object.keys(DASHBOARD_STORAGE_STORES))

export const ensureDashboardStorageSchema = database => {
  for (const [name, storeDescriptor] of Object.entries(DASHBOARD_STORAGE_STORES)) {
    if (!database.objectStoreNames.contains(name)) {
      database.createObjectStore(name, { keyPath: storeDescriptor.keyPath })
    }
  }
}
