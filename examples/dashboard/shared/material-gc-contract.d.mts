import type { MaterialIdentityV1 } from './material-promotion-contract.mjs'

export declare const MATERIAL_GC_SCHEMA_VERSION: 1
export type Sha256Digest = `sha256:${string}`

export interface MaterialGcPlanRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly replicaId: string
  readonly expectedReplicaGeneration: number
  readonly snapshotDigest: Sha256Digest
  readonly materialRefs: readonly Readonly<MaterialIdentityV1>[]
  readonly unresolvedPromotionIds: readonly Sha256Digest[]
}

export interface MaterialGcPlanV1 {
  readonly schemaVersion: 1
  readonly kind: 'material-gc-plan'
  readonly registryId: Sha256Digest
  readonly registryGeneration: number
  readonly rootKeyDigest: Sha256Digest
  readonly projectId: string
  readonly replicaId: string
  readonly replicaGeneration: number
  readonly requestDigest: Sha256Digest
  readonly snapshotDigest: Sha256Digest
  readonly globalRetainedMaterialRefs: readonly Readonly<MaterialIdentityV1>[]
  readonly deletionCandidates: readonly Readonly<MaterialIdentityV1>[]
  readonly planHash: Sha256Digest
}

export interface MaterialGcSweepRequestV1 {
  readonly schemaVersion: 1
  readonly plan: Readonly<MaterialGcPlanV1>
}

export interface MaterialGcReleaseRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly replicaId: string
  readonly expectedReplicaGeneration: number
  readonly snapshotDigest: Sha256Digest
}

export interface MaterialGcSweepResultV1 {
  readonly schemaVersion: 1
  readonly deletedMaterials: readonly Readonly<MaterialIdentityV1>[]
  readonly registryGeneration: number
  readonly replicaGeneration: number
  readonly planHash: Sha256Digest
}

export interface MaterialGcReleaseResultV1 {
  readonly schemaVersion: 1
  readonly status: 'released'
  readonly projectId: string
  readonly replicaId: string
  readonly replicaGeneration: number
  readonly requestDigest: Sha256Digest
  readonly registryGeneration: number
}

export declare class MaterialGcContractError extends TypeError {
  readonly code: 'invalid-request'
  readonly status: 400
  readonly retryable: false
}

export declare const validateMaterialGcPlanRequest: (value: unknown) => Readonly<MaterialGcPlanRequestV1>
export declare const createMaterialGcPlanRequestDigestInput: (
  value: MaterialGcPlanRequestV1,
) => Readonly<{ readonly kind: 'material-gc-root-update' } & MaterialGcPlanRequestV1>
export declare const validateMaterialGcPlan: (value: unknown) => Readonly<MaterialGcPlanV1>
export declare const createMaterialGcPlanHashInput: (
  value: MaterialGcPlanV1,
) => Readonly<Omit<MaterialGcPlanV1, 'planHash'>>
export declare const validateMaterialGcSweepRequest: (value: unknown) => Readonly<MaterialGcSweepRequestV1>
export declare const validateMaterialGcReleaseRequest: (value: unknown) => Readonly<MaterialGcReleaseRequestV1>
export declare const createMaterialGcReleaseRequestDigestInput: (
  value: MaterialGcReleaseRequestV1,
) => Readonly<{ readonly kind: 'material-gc-root-release' } & MaterialGcReleaseRequestV1>
