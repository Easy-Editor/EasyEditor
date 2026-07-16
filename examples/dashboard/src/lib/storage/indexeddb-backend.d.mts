import type { DashboardStorageBackend } from './contracts.mjs'

export declare const openDashboardStorageDatabase: (indexedDB: IDBFactory | undefined) => Promise<IDBDatabase>

export declare class IndexedDbDashboardStorageBackend implements DashboardStorageBackend {
  constructor(options?: Readonly<{ indexedDB?: IDBFactory; crypto?: Pick<Crypto, 'subtle'> }>)
  get: DashboardStorageBackend['get']
  getAll: DashboardStorageBackend['getAll']
  commit: DashboardStorageBackend['commit']
  putMigrationState: DashboardStorageBackend['putMigrationState']
  readAgentPersistence: DashboardStorageBackend['readAgentPersistence']
  commitAgentPersistence: DashboardStorageBackend['commitAgentPersistence']
  putReceiptIntent: DashboardStorageBackend['putReceiptIntent']
  readReceiptLineage: DashboardStorageBackend['readReceiptLineage']
  flush: DashboardStorageBackend['flush']
  dispose: DashboardStorageBackend['dispose']
}
