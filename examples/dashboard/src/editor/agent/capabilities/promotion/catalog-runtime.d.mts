import type { Snippet } from '@easy-editor/core'
import type { ArtifactReadRequestV1, ArtifactRecordV1 } from '../../../../lib/storage/artifact-contracts.mjs'
import type { DashboardLocalMaterialCatalogClient, LocalMaterialCatalogItemV1 } from './catalog-client.mjs'

export type LocalMaterialCatalogAvailability = 'available' | 'unavailable'
export type LocalMaterialCatalogUnavailableReason =
  | 'artifact-missing'
  | 'artifact-unreadable'
  | 'artifact-invalid'
  | 'artifact-identity-mismatch'

export type DashboardDurableCatalogMaterialV1 = LocalMaterialCatalogItemV1 &
  Readonly<
    | { availability: 'available'; unavailableReason: null }
    | { availability: 'unavailable'; unavailableReason: LocalMaterialCatalogUnavailableReason }
  >

export type DashboardLocalMaterialCatalogStatus = 'disabled' | 'loading' | 'ready' | 'error' | 'fail-closed'

export interface DashboardLocalMaterialCatalogFailure {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
}

export interface DashboardLocalMaterialCatalogSnapshotV1 {
  readonly schemaVersion: 1
  readonly status: DashboardLocalMaterialCatalogStatus
  readonly projectId: string | null
  readonly materials: readonly DashboardDurableCatalogMaterialV1[]
  readonly failure: DashboardLocalMaterialCatalogFailure | null
}

export interface DashboardLocalMaterialCatalogPersistencePort {
  getSnapshot(): Readonly<{
    state: string
    projectId: string | null
    branchId?: string | null
  }>
  subscribe(listener: () => void): () => void
  readArtifact(request: ArtifactReadRequestV1): Promise<ArtifactRecordV1 | null>
}

export interface DashboardLocalMaterialCatalogRuntime {
  getSnapshot(): DashboardLocalMaterialCatalogSnapshotV1
  subscribe(listener: () => void): () => void
  refresh(): Promise<DashboardLocalMaterialCatalogSnapshotV1>
  dispose(): void
}

export declare const createDurableMaterialSnippet: (
  material: LocalMaterialCatalogItemV1 | DashboardDurableCatalogMaterialV1,
) => Readonly<Snippet>

export declare const createDashboardLocalMaterialCatalogRuntime: {
  (options: { readonly enabled: false }): DashboardLocalMaterialCatalogRuntime
  (options: {
    readonly enabled: boolean
    readonly client: Pick<DashboardLocalMaterialCatalogClient, 'listMaterials'>
    readonly persistence: DashboardLocalMaterialCatalogPersistencePort
    readonly hashBytes?: (bytes: Uint8Array) => ArrayBuffer | ArrayBufferView | Promise<ArrayBuffer | ArrayBufferView>
  }): DashboardLocalMaterialCatalogRuntime
}
