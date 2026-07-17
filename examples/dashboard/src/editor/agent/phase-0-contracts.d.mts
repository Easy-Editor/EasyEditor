export declare const GENERATED_MATERIAL_HOST_COMPONENT_NAME: 'GeneratedMaterialHost'

import type {
  ArtifactRef,
  ArtifactSourceRevision,
  LocalMaterialArtifactRef,
  OnlineArtifactRef,
} from '../../lib/storage/artifact-contracts.mjs'

export type { ArtifactRef, ArtifactSourceRevision, LocalMaterialArtifactRef, OnlineArtifactRef }

export interface LocalMaterialTarget {
  readonly kind: 'local-material'
  readonly materialId: string
  readonly materialVersion: string
  readonly buildIntegrity: `sha256:${string}`
}

export interface GeneratedNodeArtifactBinding<TArtifactRef extends ArtifactRef = ArtifactRef> {
  readonly componentName: typeof GENERATED_MATERIAL_HOST_COMPONENT_NAME
  readonly $agent: Readonly<{
    readonly schemaVersion: 1
    readonly artifactRef: TArtifactRef
  }>
  readonly extra?: Readonly<Record<string, unknown>>
}

export declare const promoteArtifactRef: (
  onlineArtifactRef: OnlineArtifactRef,
  target: LocalMaterialTarget,
) => LocalMaterialArtifactRef

export declare const promoteGeneratedNodeArtifact: (
  binding: GeneratedNodeArtifactBinding<OnlineArtifactRef>,
  target: LocalMaterialTarget,
) => GeneratedNodeArtifactBinding<LocalMaterialArtifactRef>

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type JsonValueSchema = Readonly<Record<string, JsonValue>>

export type ProjectionRoot = 'extra' | 'node' | 'props'
export type ProjectionPath = readonly [root: ProjectionRoot, ...segments: string[]]

export interface WriteTarget {
  readonly path: ProjectionPath
  readonly valuePath?: readonly string[]
}

export interface ConfigureFieldAnnotation {
  readonly fieldId: string
  readonly access: 'read-only' | 'read-write' | 'unsupported'
  readonly readPath?: ProjectionPath
  readonly writeTargets?: readonly WriteTarget[]
  readonly unsetTargets?: readonly WriteTarget[]
  readonly valueSchema?: JsonValueSchema
  readonly verifyPaths?: readonly ProjectionPath[]
}

export type ConfigureAnnotationOverlay = Readonly<Record<string, ConfigureFieldAnnotation>>

export declare const defineConfigureAnnotationOverlay: <const TOverlay extends ConfigureAnnotationOverlay>(
  overlay: TOverlay,
) => TOverlay

export declare const dashboardConfigureAnnotations: ConfigureAnnotationOverlay
