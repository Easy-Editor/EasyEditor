import type {
  MaterialCatalogItemV1,
  MaterialCatalogListResponseV1,
} from '../../../../../shared/material-catalog-contract.mjs'

export declare const LOCAL_MATERIAL_CATALOG_LIST_ROUTE: '/api/materials/catalog/list'
export declare const LOCAL_MATERIAL_CATALOG_READ_ROUTE: '/api/materials/catalog/read'

export type LocalMaterialCatalogItemV1 = Readonly<MaterialCatalogItemV1>
export type LocalMaterialCatalogListV1 = Readonly<MaterialCatalogListResponseV1>

export interface LocalMaterialCatalogListRequest {
  readonly projectId: string
  readonly signal?: AbortSignal
}

export interface LocalMaterialCatalogReadRequest extends LocalMaterialCatalogListRequest {
  readonly materialId: string
  readonly materialVersion: string
  readonly buildIntegrity: `sha256:${string}`
}

export interface DashboardLocalMaterialCatalogClient {
  listMaterials(request: LocalMaterialCatalogListRequest): Promise<LocalMaterialCatalogListV1>
  readMaterial(request: LocalMaterialCatalogReadRequest): Promise<LocalMaterialCatalogItemV1>
}

export declare class DashboardLocalMaterialCatalogClientError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  constructor(code: string, options?: Readonly<{ status?: number; retryable?: boolean; message?: string }>)
}

export declare const normalizeLocalMaterialCatalogItem: (value: unknown) => LocalMaterialCatalogItemV1
export declare const normalizeLocalMaterialCatalogList: (value: unknown) => LocalMaterialCatalogListV1

export declare const createDashboardSameOriginLocalMaterialCatalogClient: (options: {
  readonly fetchImpl: typeof fetch
  readonly routes?: Readonly<{ list?: string; read?: string }>
}) => DashboardLocalMaterialCatalogClient
