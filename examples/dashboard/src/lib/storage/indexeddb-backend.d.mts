import type { DashboardStorageBackend } from './contracts.mjs'

export declare const openDashboardStorageDatabase: (indexedDB: IDBFactory | undefined) => Promise<IDBDatabase>

export declare class IndexedDbDashboardStorageBackend implements DashboardStorageBackend {
  constructor(options?: Readonly<{ indexedDB?: IDBFactory; crypto?: Pick<Crypto, 'subtle'> }>)
  get: DashboardStorageBackend['get']
  getAll: DashboardStorageBackend['getAll']
  readMaterialGcStoreSnapshot: DashboardStorageBackend['readMaterialGcStoreSnapshot']
  commit: DashboardStorageBackend['commit']
  putMigrationState: DashboardStorageBackend['putMigrationState']
  readAgentPersistence: DashboardStorageBackend['readAgentPersistence']
  commitAgentPersistence: DashboardStorageBackend['commitAgentPersistence']
  putReceiptIntent: DashboardStorageBackend['putReceiptIntent']
  readReceiptLineage: DashboardStorageBackend['readReceiptLineage']
  createArtifact: DashboardStorageBackend['createArtifact']
  readArtifact: DashboardStorageBackend['readArtifact']
  createArtifactRoot: DashboardStorageBackend['createArtifactRoot']
  readArtifactRoot: DashboardStorageBackend['readArtifactRoot']
  deleteArtifactRoot: DashboardStorageBackend['deleteArtifactRoot']
  sweepArtifacts: DashboardStorageBackend['sweepArtifacts']
  flush: DashboardStorageBackend['flush']
  dispose: DashboardStorageBackend['dispose']
}
