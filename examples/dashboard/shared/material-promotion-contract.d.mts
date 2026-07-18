export const MATERIAL_PROMOTION_SCHEMA_VERSION: 1
export const MATERIAL_PROMOTION_STATES: readonly MaterialPromotionState[]

export type Sha256Digest = `sha256:${string}`
export type MaterialPromotionState =
  | 'allocated'
  | 'workspace-ready'
  | 'built'
  | 'validated'
  | 'manifest-staged'
  | 'manifest-published'
  | 'active'

export interface MaterialIdentityV1 {
  readonly materialId: string
  readonly materialVersion: string
  readonly buildIntegrity: Sha256Digest
}

export interface MaterialPromotionFileV1 {
  readonly path: string
  readonly byteLength: number
  readonly integrity: Sha256Digest
}

export interface ArtifactSourceRevisionV1 {
  readonly artifactId: string
  readonly sourceRevision: string
  readonly logicalComponentId: string
  readonly sourceIntegrity: Sha256Digest
}

export interface MaterialPromotionRequestV1 extends MaterialIdentityV1 {
  readonly schemaVersion: 1
  readonly promotionId: string
  readonly projectId: string
  readonly logicalComponentId: string
  readonly sourceRevision: ArtifactSourceRevisionV1
  readonly dependencyLockDigest: Sha256Digest
  readonly entryFile: string
  readonly buildDirectory: string
  readonly files: readonly MaterialPromotionFileV1[]
  readonly createdAt: number
}

export type MaterialPromotionBindingV1 = Omit<MaterialPromotionRequestV1, 'buildDirectory'>

export class MaterialPromotionContractError extends TypeError {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
}

export function validateMaterialIdentity(value: unknown): Readonly<MaterialIdentityV1>
export function validateMaterialPromotionFile(value: unknown): Readonly<MaterialPromotionFileV1>
export function validateMaterialPromotionRequest(value: unknown): Readonly<MaterialPromotionRequestV1>
export function createMaterialIdentity(request: MaterialPromotionRequestV1): Readonly<MaterialIdentityV1>
export function createMaterialPromotionBinding(
  request: MaterialPromotionRequestV1,
): Readonly<MaterialPromotionBindingV1>
