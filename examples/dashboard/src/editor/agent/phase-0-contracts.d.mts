export declare const GENERATED_MATERIAL_HOST_COMPONENT_NAME: 'GeneratedMaterialHost'

export interface ArtifactSourceRevision {
  readonly artifactId: string
  readonly sourceRevision: string
  readonly logicalComponentId: string
  readonly sourceIntegrity: string
}

export interface OnlineArtifactRef extends ArtifactSourceRevision {
  readonly target: {
    readonly kind: 'online'
  }
}

export interface LocalMaterialTarget {
  readonly kind: 'local-material'
  readonly materialId: string
  readonly materialVersion: string
  readonly buildIntegrity: string
}

export interface LocalMaterialArtifactRef extends ArtifactSourceRevision {
  readonly target: LocalMaterialTarget
  readonly rollbackTo: ArtifactSourceRevision
}

export type ArtifactRef = OnlineArtifactRef | LocalMaterialArtifactRef

export interface GeneratedNodeArtifactBinding<TArtifactRef extends ArtifactRef = ArtifactRef> {
  readonly componentName: typeof GENERATED_MATERIAL_HOST_COMPONENT_NAME
  readonly artifactRef: TArtifactRef
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
