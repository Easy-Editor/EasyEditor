import type {
  ArtifactSourceRevision,
  LocalMaterialArtifactRef,
  OnlineArtifactRef,
} from '../../../../lib/storage/artifact-contracts.mjs'
import type {
  OnlineArtifactCoreResult,
  OnlineArtifactPrepareResult,
  OnlineArtifactProjectCapture,
} from '../artifact/contract.mjs'

export declare const GENERATED_MATERIAL_HOST_COMPONENT_NAME: 'GeneratedMaterialHost'
export declare const LOCAL_MATERIAL_PROMOTION_CAPABILITY: 'artifact.promoteLocal'

export interface LocalMaterialPromotionAuthority {
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly taskId: string
}

export interface LocalMaterialPromotionCall extends LocalMaterialPromotionAuthority {
  readonly schemaVersion: 1
  readonly stepId: string
  readonly callId: string
  readonly capability: 'artifact.promoteLocal'
  readonly expectedRevision: string
  readonly arguments: Readonly<{ schemaVersion: 1; nodeId: string }>
}

export interface LocalMaterialPromotionServerResultV1 {
  readonly schemaVersion: 1
  readonly status: 'active'
  readonly promotionId: `sha256:${string}`
  readonly materialId: string
  readonly materialVersion: string
  readonly buildIntegrity: `sha256:${string}`
  readonly rollbackTo: ArtifactSourceRevision
}

export type NormalizedLocalMaterialPromotionServerResultV1 = LocalMaterialPromotionServerResultV1 &
  Readonly<{ artifactRef: LocalMaterialArtifactRef }>

export interface LocalMaterialPromotionArtifactIdentityV1 extends ArtifactSourceRevision {
  readonly dependencyLockDigest: `sha256:${string}`
}

export interface LocalMaterialPromotionPreImagesV1 {
  readonly schemaVersion: 1
  readonly kind: 'local-material-promotion-pre-images'
  readonly capability: 'artifact.promoteLocal'
  readonly documentId: string
  readonly nodeId: string
  readonly previousArtifactRef: OnlineArtifactRef
  readonly artifactIdentity: LocalMaterialPromotionArtifactIdentityV1
  readonly promotionId: `sha256:${string}`
  readonly callDigest: `sha256:${string}`
  readonly expectedRevision: string
}

export interface LocalMaterialPromotionPlannedPostImagesV1 {
  readonly schemaVersion: 1
  readonly kind: 'local-material-promotion-post-images'
  readonly componentName: 'GeneratedMaterialHost'
  readonly nodeId: string
  readonly promotionId: `sha256:${string}`
  readonly sourceRevision: ArtifactSourceRevision
}

export interface LocalMaterialPromotionFinalPostImagesV1 {
  readonly schemaVersion: 1
  readonly kind: 'local-material-promotion-post-images'
  readonly componentName: 'GeneratedMaterialHost'
  readonly nodeId: string
  readonly artifactRef: LocalMaterialArtifactRef
}

interface LocalMaterialPromotionJournalBaseV1 {
  readonly schemaVersion: 1
  readonly call: LocalMaterialPromotionCall
  readonly callDigest: `sha256:${string}`
  readonly promotionId: `sha256:${string}`
  readonly prepare: OnlineArtifactPrepareResult & Readonly<{ previousArtifactRef: OnlineArtifactRef }>
  readonly artifactIdentity: LocalMaterialPromotionArtifactIdentityV1
}

export type LocalMaterialPromotionJournalValueV1 =
  | (LocalMaterialPromotionJournalBaseV1 & Readonly<{ stage: 'prepared' }>)
  | (LocalMaterialPromotionJournalBaseV1 &
      Readonly<{ stage: 'registry-active'; server: LocalMaterialPromotionServerResultV1 }>)
  | (LocalMaterialPromotionJournalBaseV1 &
      Readonly<{
        stage: 'committed'
        server: LocalMaterialPromotionServerResultV1
        output: LocalMaterialPromotionFinalPostImagesV1
      }>)
  | (LocalMaterialPromotionJournalBaseV1 &
      Readonly<{ stage: 'failed'; server: LocalMaterialPromotionServerResultV1; failureCode: string }>)

export interface LocalMaterialPromotionJournalRecordV1 extends LocalMaterialPromotionAuthority {
  readonly schemaVersion: 1
  readonly callId: string
  readonly recordId: string
  readonly kind: 'local-material-promotion'
  readonly value: LocalMaterialPromotionJournalValueV1
  readonly draftGeneration?: number
  readonly updatedAt?: number
}

export declare const normalizeLocalMaterialPromotionAuthority: (value: unknown) => LocalMaterialPromotionAuthority
export declare const normalizeLocalMaterialPromotionCall: (
  value: unknown,
  boundAuthority: LocalMaterialPromotionAuthority,
) => LocalMaterialPromotionCall
export declare const normalizeLocalMaterialPromotionPrepareResult: (
  value: unknown,
  expected: Readonly<{ expectedRevision: string; nodeId: string }>,
) => OnlineArtifactPrepareResult & Readonly<{ previousArtifactRef: OnlineArtifactRef }>
export declare const normalizeLocalMaterialPromotionCoreResult: (
  value: unknown,
  expected: OnlineArtifactPrepareResult & Readonly<{ artifactRef: LocalMaterialArtifactRef | OnlineArtifactRef }>,
) => OnlineArtifactCoreResult
export declare const normalizeLocalMaterialPromotionProjectCapture: (value: unknown) => OnlineArtifactProjectCapture
export declare const normalizeLocalMaterialPromotionArtifactIdentity: (
  value: unknown,
) => LocalMaterialPromotionArtifactIdentityV1
export declare const normalizeLocalMaterialPromotionPreImages: (value: unknown) => LocalMaterialPromotionPreImagesV1
export declare const normalizeLocalMaterialPromotionPlannedPostImages: (
  value: unknown,
) => LocalMaterialPromotionPlannedPostImagesV1
export declare const normalizeLocalMaterialPromotionFinalPostImages: (
  value: unknown,
) => LocalMaterialPromotionFinalPostImagesV1
export declare const normalizeLocalMaterialPromotionServerResult: (
  value: unknown,
  expected: Readonly<{ promotionId: string; sourceRevision: ArtifactSourceRevision }>,
) => NormalizedLocalMaterialPromotionServerResultV1
export declare const createStoredLocalMaterialPromotionServerResult: (
  value: NormalizedLocalMaterialPromotionServerResultV1,
) => LocalMaterialPromotionServerResultV1
export declare const normalizeLocalMaterialPromotionJournalValue: (
  value: unknown,
  boundAuthority: LocalMaterialPromotionAuthority,
) => LocalMaterialPromotionJournalValueV1
export declare const normalizeLocalMaterialPromotionJournalRecord: (
  value: unknown,
  boundAuthority: LocalMaterialPromotionAuthority,
) => LocalMaterialPromotionJournalRecordV1
