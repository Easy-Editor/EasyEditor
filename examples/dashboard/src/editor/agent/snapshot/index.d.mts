import type { HostSnapshot, HostSnapshotDelta, JsonObject, JsonValue, ObserveRequest } from '@easy-editor/agent-runtime'
import type { ComponentMetadata, RootSchema } from '@easy-editor/core/instance'

export interface JsonSanitizerOptions {
  readonly maxDepth?: number
  readonly maxNodes?: number
  readonly maxArrayLength?: number
  readonly maxStringLength?: number
}

export type ProjectionChange =
  | { readonly op: 'remove'; readonly path: readonly [string, ...string[]] }
  | { readonly op: 'set'; readonly path: readonly [string, ...string[]]; readonly value: JsonValue }

export declare const compareCodeUnits: (left: string, right: string) => number
export declare const sanitizeJsonValue: (value: unknown, options?: JsonSanitizerOptions) => JsonValue
export declare const stableStringify: (value: unknown) => string
export declare const hashStableValue: (value: unknown) => string
export declare const createProjectionChanges: (base: JsonObject, next: JsonObject) => readonly ProjectionChange[]
export declare const validateProjectionChanges: (base: JsonObject, changes: readonly ProjectionChange[]) => boolean

export interface HostRevisionInput {
  readonly adapterGeneration: number
  readonly documentId: string
  readonly documentMutationVersion: number
  readonly materialRegistryVersion: number
  readonly providerVersions: Readonly<Record<string, string>>
}

export declare const createHostRevision: (input: HostRevisionInput) => string

export interface CoreProjectionDocument {
  readonly id: string
  readonly mutationVersion: number
  readonly schema: RootSchema
}

export interface CoreProjectionMaterials {
  readonly version: number
  readonly entries: readonly unknown[] | ReadonlyMap<string, unknown>
  readonly resolveEntry?: (entry: unknown) => Readonly<ComponentMetadata>
}

export interface CoreProjectionWritableMaterialField {
  readonly fieldId: string
  readonly access: 'read-write'
  readonly valueSchema?: JsonObject
}

export interface CoreProjectionWritableMaterialManifest {
  readonly componentName: string
  readonly fields: readonly CoreProjectionWritableMaterialField[]
}

export type CoreProjectionWritableNodeValues = Readonly<Record<string, Readonly<Record<string, unknown>>>>

export interface CoreProjectionAdapter {
  readAdapterGeneration(): number
  readDocument(): CoreProjectionDocument | null
  readMaterials(): CoreProjectionMaterials
  readWritableMaterialManifests?():
    | readonly CoreProjectionWritableMaterialManifest[]
    | Promise<readonly CoreProjectionWritableMaterialManifest[]>
  readWritableNodeValues?(): CoreProjectionWritableNodeValues | Promise<CoreProjectionWritableNodeValues>
}

export interface SnapshotProvider {
  readonly id: string
  readFence?(): Omit<HostRevisionInput, 'providerVersions'>
  getVersion(): string
  capture(): JsonObject | Promise<JsonObject>
  isDeltaCompatible?(base: JsonObject, next: JsonObject): boolean
}

export declare const createCoreProjectionProvider: (adapter: CoreProjectionAdapter) => SnapshotProvider & {
  readFence(): Omit<HostRevisionInput, 'providerVersions'>
}

export interface SnapshotProviderRecord {
  readonly provider: SnapshotProvider
  readonly generation: number
  readonly version: string
}

export declare class SnapshotProviderRegistry {
  readonly generation: number
  register(provider: SnapshotProvider): () => void
  snapshot(): readonly SnapshotProviderRecord[]
  isCurrent(record: SnapshotProviderRecord): boolean
}

export interface DashboardSnapshotServiceOptions {
  readonly registry: SnapshotProviderRegistry
  readonly coreProvider: ReturnType<typeof createCoreProjectionProvider>
  readonly maxCaptureAttempts?: number
  readonly historyLimit?: number
}

export declare class DashboardSnapshotService {
  constructor(options: DashboardSnapshotServiceOptions)
  readonly maxCaptureAttempts: number
  readonly historyLimit: number
  readonly disposed: boolean
  observe(request?: Pick<ObserveRequest, 'mode' | 'cursor'>): Promise<HostSnapshot | HostSnapshotDelta>
  dispose(): void
}

export declare const createDashboardSnapshotService: (
  options: DashboardSnapshotServiceOptions,
) => DashboardSnapshotService
