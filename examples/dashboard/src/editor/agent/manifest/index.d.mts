import type { ComponentMetadata } from '@easy-editor/core'
import type {
  ConfigureAnnotationOverlay,
  JsonValue,
  JsonValueSchema,
  ProjectionPath,
  WriteTarget,
} from '../phase-0-contracts.mjs'

export type MaterialRegistryVersion = number | string

export interface SafeMaterialManifestLimits {
  readonly maxConfigureDepth: number
  readonly maxFields: number
  readonly maxJsonNodes: number
  readonly maxManifestBytes: number
  readonly maxStringLength: number
}

export type SafeManifestDiagnosticCode =
  | 'accessor-rejected'
  | 'advanced-presentation-excluded'
  | 'ambiguous-field-binding'
  | 'callback-annotation-required'
  | 'configure-limit-exceeded'
  | 'cycle-detected'
  | 'duplicate-field-id'
  | 'invalid-annotation'
  | 'invalid-configure'
  | 'invalid-json'
  | 'json-limit-exceeded'
  | 'manifest-limit-exceeded'
  | 'material-component-name-mismatch'
  | 'material-load-failed'
  | 'missing-annotation'
  | 'overlapping-write-targets'
  | 'setter-constraints-unsupported'
  | 'stale-material-registry-version'
  | 'unsafe-or-anonymous-field'

export interface SafeManifestDiagnostic {
  readonly code: SafeManifestDiagnosticCode
  readonly message: string
  readonly fieldId?: string
  readonly sourcePath?: string
}

export interface SafeMaterialManifestField {
  readonly fieldId: string
  readonly access: 'read-only' | 'read-write' | 'unsupported'
  readonly title?: string
  readonly required?: boolean
  readonly readPath?: ProjectionPath
  readonly writeTargets?: readonly WriteTarget[]
  readonly unsetTargets?: readonly WriteTarget[]
  readonly valueSchema?: JsonValueSchema
  readonly verifyPaths?: readonly ProjectionPath[]
}

export interface SafeMaterialManifestReadiness {
  readonly status: 'ready' | 'not-ready'
  readonly missingFieldIds: readonly string[]
  readonly unsupportedFieldIds: readonly string[]
}

export interface SafeMaterialManifest {
  readonly schemaVersion: typeof SAFE_MATERIAL_MANIFEST_SCHEMA_VERSION
  readonly materialRegistryVersion: MaterialRegistryVersion
  readonly componentName: string
  readonly title?: string
  readonly group?: string
  readonly category?: string
  readonly fields: readonly SafeMaterialManifestField[]
  readonly diagnostics: readonly SafeManifestDiagnostic[]
  readonly readiness: SafeMaterialManifestReadiness
}

export type ConfigureAnnotationBindings = Readonly<Record<string, Readonly<Record<string, string>>>>

export interface CompileSafeMaterialManifestOptions {
  readonly metadata: Readonly<ComponentMetadata>
  readonly materialRegistryVersion: MaterialRegistryVersion
  readonly annotations?: ConfigureAnnotationOverlay
  readonly annotationBindings?: ConfigureAnnotationBindings
  readonly limits?: Partial<SafeMaterialManifestLimits>
}

export interface SafeMaterialManifestCacheOptions {
  readonly loadMetadata: (componentName: string) => Readonly<ComponentMetadata> | Promise<Readonly<ComponentMetadata>>
  readonly readMaterialRegistryVersion: () => MaterialRegistryVersion | Promise<MaterialRegistryVersion>
  readonly loadAnnotations?: (
    componentName: string,
  ) => ConfigureAnnotationOverlay | undefined | Promise<ConfigureAnnotationOverlay | undefined>
  readonly loadAnnotationBindings?: (
    componentName: string,
  ) => ConfigureAnnotationBindings | undefined | Promise<ConfigureAnnotationBindings | undefined>
  readonly limits?: Partial<SafeMaterialManifestLimits>
}

export declare const SAFE_MATERIAL_MANIFEST_SCHEMA_VERSION: 1
export declare const DEFAULT_SAFE_MATERIAL_MANIFEST_LIMITS: Readonly<SafeMaterialManifestLimits>
export declare const DASHBOARD_CONFIGURE_ANNOTATION_BINDINGS: Readonly<{
  '*': Readonly<Record<string, string>>
  BarChart: Readonly<Record<string, string>>
  Image: Readonly<Record<string, string>>
  LineChart: Readonly<Record<string, string>>
  Root: Readonly<Record<string, string>>
  Text: Readonly<Record<string, string>>
}>
export declare const DASHBOARD_MATERIAL_READINESS_REQUIREMENTS: Readonly<{
  BarChart: readonly ['props.data']
  LineChart: readonly ['props.data']
  Text: readonly ['props.text']
}>

export declare const compileSafeMaterialManifest: (
  options: CompileSafeMaterialManifestOptions,
) => Readonly<SafeMaterialManifest>

export declare class SafeMaterialManifestCache {
  constructor(options: SafeMaterialManifestCacheOptions)
  readonly size: number
  readonly materialRegistryVersion: MaterialRegistryVersion | undefined
  get(componentName: string, materialRegistryVersion: MaterialRegistryVersion): Promise<Readonly<SafeMaterialManifest>>
  invalidate(materialRegistryVersion?: MaterialRegistryVersion): void
}

export declare const createSafeMaterialManifestCache: (
  options: SafeMaterialManifestCacheOptions,
) => SafeMaterialManifestCache

export type { ConfigureAnnotationOverlay, JsonValue, JsonValueSchema, ProjectionPath, WriteTarget }
