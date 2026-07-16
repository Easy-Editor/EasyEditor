export type DashboardStorageStoreName =
  | 'projects'
  | 'workingDrafts'
  | 'projectVersions'
  | 'agentSessions'
  | 'taskJournals'
  | 'toolReceipts'
  | 'receiptIntents'
  | 'applyWitnesses'
  | 'failureWitnesses'
  | 'mutationProvenance'
  | 'agentCheckpoints'
  | 'artifacts'
  | 'artifactRefs'
  | 'grants'
  | 'migrationState'

export interface DashboardStorageStoreDescriptor {
  readonly keyPath: string | readonly string[]
}

export declare const DASHBOARD_STORAGE_DATABASE_NAME: 'easy-editor-dashboard-storage'
export declare const DASHBOARD_STORAGE_DATABASE_VERSION: 1
export declare const DASHBOARD_STORAGE_IDENTITY_POINTER_KEY: 'easy-editor:storage:active:v1'
export declare const DASHBOARD_STORAGE_COMPATIBILITY_MARKER_KEY: 'easy-editor:storage:compatibility:v1'
export declare const DASHBOARD_STORAGE_STORES: Readonly<
  Record<DashboardStorageStoreName, DashboardStorageStoreDescriptor>
>
export declare const DASHBOARD_STORAGE_STORE_NAMES: readonly DashboardStorageStoreName[]

export declare const ensureDashboardStorageSchema: (
  database: Pick<IDBDatabase, 'createObjectStore' | 'objectStoreNames'>,
) => void
