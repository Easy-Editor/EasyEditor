import type {
  DashboardAgentPersistenceBatchV1,
  DashboardStorageBackend,
  DurableProjectBatchV1,
  MemoryStorageFaultPhase,
} from './contracts.mjs'

export interface MemoryStorageFaultEvent {
  readonly phase: MemoryStorageFaultPhase
  readonly operationIndex?: number
  readonly batch: DurableProjectBatchV1 | DashboardAgentPersistenceBatchV1
}

export declare class MemoryDashboardStorageBackend implements DashboardStorageBackend {
  constructor(
    options?: Readonly<{
      faultInjector?: (event: MemoryStorageFaultEvent) => void
      crypto?: Pick<Crypto, 'subtle'>
    }>,
  )
  get: DashboardStorageBackend['get']
  getAll: DashboardStorageBackend['getAll']
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
