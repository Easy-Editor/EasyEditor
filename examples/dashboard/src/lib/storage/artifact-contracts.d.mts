import type { JsonObject, JsonValue } from './canonical-json.mjs'

export interface ArtifactSourceRevision {
  readonly artifactId: string
  readonly sourceRevision: string
  readonly logicalComponentId: string
  readonly sourceIntegrity: `sha256:${string}`
}

export interface OnlineArtifactRef extends ArtifactSourceRevision {
  readonly target: Readonly<{ kind: 'online' }>
}

export interface LocalMaterialArtifactRef extends ArtifactSourceRevision {
  readonly target: Readonly<{
    kind: 'local-material'
    materialId: string
    materialVersion: string
    buildIntegrity: `sha256:${string}`
  }>
  readonly rollbackTo: ArtifactSourceRevision
}

export type ArtifactRef = OnlineArtifactRef | LocalMaterialArtifactRef

export interface ArtifactRecordV1 extends ArtifactSourceRevision {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly source: string
  readonly css: string
  readonly safeManifest: JsonObject & Readonly<{ schemaVersion: 1 }>
  readonly lockedDependencies: readonly LockedArtifactDependencyV1[]
  readonly dependencyLockDigest: `sha256:${string}`
  readonly diagnostics: readonly JsonValue[]
  readonly provenance: JsonObject
  readonly createdAt: number
  readonly supersedes: ArtifactSourceRevision | null
}

export interface LockedArtifactDependencyModuleV1 {
  readonly format: 'bundled-esm'
  readonly contentType: 'text/javascript'
  readonly encoding: 'base64'
  readonly byteLength: number
  readonly bytes: string
}

export interface LockedArtifactDependencyV1 {
  readonly package: string
  readonly range: string
  readonly exactVersion: string
  readonly finalUrl: string
  readonly integrity: `sha256-${string}`
  readonly cached: boolean
  readonly module: LockedArtifactDependencyModuleV1
}

export interface ArtifactReadRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly artifactId: string
  readonly sourceRevision: string
}

export interface ArtifactRootRecordV1 extends ArtifactReadRequestV1 {
  readonly branchId: string
  readonly ownerType: string
  readonly ownerId: string
}

export interface ArtifactIdentityV1 {
  readonly artifactId: string
  readonly sourceRevision: string
}

export interface ArtifactGenerationFenceV1 {
  readonly branchId: string
  readonly draftGeneration: number
}

export interface ArtifactRootFenceV1 extends ArtifactIdentityV1 {
  readonly branchId: string
  readonly ownerType: string
  readonly ownerId: string
}

export interface ArtifactSweepRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly generationFence: readonly ArtifactGenerationFenceV1[]
  readonly artifactIdentityFence: readonly ArtifactIdentityV1[]
  readonly rootFence: readonly ArtifactRootFenceV1[]
  readonly deletionCandidates: readonly ArtifactIdentityV1[]
}

export interface ArtifactCreateResultV1 {
  readonly schemaVersion: 1
  readonly status: 'created' | 'reconciled'
  readonly artifact: ArtifactRecordV1
}

export interface ArtifactRootCreateResultV1 {
  readonly schemaVersion: 1
  readonly status: 'created' | 'reconciled'
  readonly root: ArtifactRootRecordV1
}

export interface ArtifactRootDeleteResultV1 {
  readonly schemaVersion: 1
  readonly status: 'deleted' | 'absent'
  readonly root: ArtifactRootRecordV1
}

export interface ArtifactSweepBackendResultV1 {
  readonly schemaVersion: 1
  readonly status: 'committed'
  readonly projectId: string
  readonly deletedArtifacts: readonly ArtifactIdentityV1[]
}

export interface CanonicalNodeAgentExtraV1 {
  readonly schemaVersion: 1
  readonly artifactRef: ArtifactRef
}

export interface ArtifactNodeV1 extends JsonObject {
  readonly $agent?: CanonicalNodeAgentExtraV1
  readonly extra?: JsonObject
}

export type CanonicalNodeExtra = Readonly<ArtifactNodeV1 & { $agent: CanonicalNodeAgentExtraV1 }>

export declare const ARTIFACT_SOURCE_MAX_BYTES: number
export declare const ARTIFACT_CSS_MAX_BYTES: number
export declare const ARTIFACT_LOCKED_DEPENDENCY_MAX_COUNT: number
export declare const ARTIFACT_DIAGNOSTIC_MAX_COUNT: number
export declare const ARTIFACT_SAFE_MANIFEST_MAX_BYTES: number
export declare const ARTIFACT_DIAGNOSTICS_MAX_BYTES: number
export declare const ARTIFACT_PROVENANCE_MAX_BYTES: number
export declare const ARTIFACT_RECORD_MAX_BYTES: number
export declare const cloneFrozenJson: <T extends JsonValue>(value: T) => Readonly<T>
export declare const validateArtifactSourceRevision: (value: unknown) => ArtifactSourceRevision
export declare const validateLockedArtifactDependency: (value: unknown) => LockedArtifactDependencyV1
export declare const validateArtifactRef: (value: unknown) => ArtifactRef
export declare const createArtifactRevisionKey: (value: unknown) => string
export declare const validateArtifactRecord: (value: unknown) => ArtifactRecordV1
export declare const validateArtifactReadRequest: (value: unknown) => ArtifactReadRequestV1
export declare const validateArtifactRootRecord: (value: unknown) => ArtifactRootRecordV1
export declare const validateArtifactRootReadRequest: (value: unknown) => ArtifactRootRecordV1
export declare const normalizeArtifactIdentityFence: (value: unknown, label?: string) => readonly ArtifactIdentityV1[]
export declare const normalizeArtifactGenerationFence: (
  value: unknown,
  label?: string,
) => readonly ArtifactGenerationFenceV1[]
export declare const normalizeArtifactRootFence: (value: unknown, label?: string) => readonly ArtifactRootFenceV1[]
export declare const validateArtifactSweepRequest: (value: unknown) => ArtifactSweepRequestV1
export declare const readCanonicalNodeArtifactRef: (node: unknown) => ArtifactRef | null
export declare const writeCanonicalNodeArtifactRef: (node: unknown, artifactRef: unknown) => Readonly<ArtifactNodeV1>
export declare const migrateLegacyNodeArtifactRef: (node: unknown) => Readonly<ArtifactNodeV1>
