export declare const MATERIAL_CATALOG_SCHEMA_VERSION: 1
export declare const MATERIAL_CATALOG_COMPONENT_NAME: 'GeneratedMaterialHost'

export type Sha256Digest = `sha256:${string}`

export interface MaterialCatalogArtifactSourceRevisionV1 {
  readonly artifactId: string
  readonly sourceRevision: string
  readonly logicalComponentId: string
  readonly sourceIntegrity: Sha256Digest
}

export interface MaterialCatalogLocalTargetV1 {
  readonly kind: 'local-material'
  readonly materialId: string
  readonly materialVersion: string
  readonly buildIntegrity: Sha256Digest
}

export interface MaterialCatalogArtifactRefV1 extends MaterialCatalogArtifactSourceRevisionV1 {
  readonly target: Readonly<MaterialCatalogLocalTargetV1>
  readonly rollbackTo: Readonly<MaterialCatalogArtifactSourceRevisionV1>
}

export interface MaterialCatalogItemV1 {
  readonly schemaVersion: 1
  readonly componentName: 'GeneratedMaterialHost'
  readonly title: string
  readonly createdAt: number
  readonly promotionId: Sha256Digest
  readonly artifactRef: Readonly<MaterialCatalogArtifactRefV1>
}

export interface MaterialCatalogListResponseV1 {
  readonly schemaVersion: 1
  readonly materials: readonly Readonly<MaterialCatalogItemV1>[]
}

export interface MaterialCatalogRegistryRecord {
  readonly materialId: string
  readonly materialVersion: string
  readonly buildIntegrity: Sha256Digest
  readonly promotionId: Sha256Digest
  readonly sourceRevision: Readonly<MaterialCatalogArtifactSourceRevisionV1>
  readonly createdAt: number
}

export declare const validateMaterialCatalogItem: (value: unknown) => Readonly<MaterialCatalogItemV1>
export declare const createMaterialCatalogItem: (
  record: MaterialCatalogRegistryRecord,
) => Readonly<MaterialCatalogItemV1>
export declare const createMaterialCatalogListResponse: (
  records: readonly MaterialCatalogRegistryRecord[],
) => Readonly<MaterialCatalogListResponseV1>
export declare const validateMaterialCatalogListResponse: (value: unknown) => Readonly<MaterialCatalogListResponseV1>
