export type DashboardDataJsonPrimitive = boolean | number | string | null
export type DashboardDataJsonValue =
  | DashboardDataJsonPrimitive
  | readonly DashboardDataJsonValue[]
  | { readonly [key: string]: DashboardDataJsonValue }

export interface DashboardDataLimits {
  readonly maxArrayLength: number
  readonly maxBytes: number
  readonly maxDepth: number
  readonly maxFields: number
  readonly maxNodes: number
  readonly maxPathSegments: number
  readonly maxRows: number
  readonly maxSources: number
  readonly maxStringLength: number
  readonly timeoutMs: number
}

export type DashboardDataTransformStep =
  | { readonly op: 'select'; readonly path: readonly string[] }
  | { readonly op: 'project'; readonly fields: Readonly<Record<string, readonly string[]>> }
  | {
      readonly op: 'filter'
      readonly path: readonly string[]
      readonly operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
      readonly value: DashboardDataJsonPrimitive
    }
  | { readonly op: 'sort'; readonly path: readonly string[]; readonly direction?: 'asc' | 'desc' }
  | { readonly op: 'take' | 'limit'; readonly count: number }

export interface DashboardDataRequest {
  readonly url: string
  readonly method: 'GET' | 'POST'
  readonly body?: DashboardDataJsonValue
}

export interface DashboardPublicDataRequest {
  readonly url: string
  readonly method: 'GET'
}

interface DashboardDataDescriptorBase {
  readonly schemaVersion: 1
  readonly id: string
  readonly transform?: readonly DashboardDataTransformStep[]
}

export type DashboardSafeDataDescriptor =
  | (DashboardDataDescriptorBase & { readonly kind: 'static'; readonly value: DashboardDataJsonValue })
  | (DashboardDataDescriptorBase & { readonly kind: 'mock'; readonly fixture: DashboardDataJsonValue })
  | (DashboardDataDescriptorBase & {
      readonly kind: 'public-http-json'
      readonly request: DashboardPublicDataRequest
    })
  | (DashboardDataDescriptorBase & {
      readonly kind: 'credentialed-http-json'
      readonly providerId: string
      readonly credentialRef: string
      readonly request: DashboardDataRequest
    })

export interface DashboardSafeDataCatalog {
  readonly schemaVersion: 1
  readonly sources: readonly DashboardSafeDataDescriptor[]
}

export interface DashboardSafeDataBinding {
  readonly sourceId: string
  readonly transform?: readonly DashboardDataTransformStep[]
}

export interface DashboardSafeDataBindings {
  readonly schemaVersion: 1
  readonly fields: Readonly<Partial<Record<'text' | 'data', DashboardSafeDataBinding>>>
}

export interface DashboardDataResolver {
  resolve(
    descriptor: DashboardSafeDataDescriptor,
    context?: Readonly<{
      projectId?: string
      signal?: AbortSignal
      limits?: Partial<DashboardDataLimits>
    }>,
  ): Promise<DashboardDataJsonValue>
}

export declare const DEFAULT_DASHBOARD_DATA_LIMITS: Readonly<DashboardDataLimits>

export declare class DashboardDataCapabilityError extends TypeError {
  readonly code: string
  readonly reason: string
  readonly path: string
  constructor(code: string, reason: string, path?: string)
  toJSON(): Readonly<{ schemaVersion: 1; code: string; reason: string; path: string }>
}

export declare const parseSafeDataTransform: (
  value: unknown,
  options?: Readonly<{ limits?: Partial<DashboardDataLimits> }>,
) => readonly DashboardDataTransformStep[] | undefined
export declare const parseSafeDataDescriptor: (
  value: unknown,
  options?: Readonly<{ limits?: Partial<DashboardDataLimits> }>,
) => DashboardSafeDataDescriptor
export declare const parseSafeDataCatalog: (
  value: unknown,
  options?: Readonly<{ limits?: Partial<DashboardDataLimits> }>,
) => DashboardSafeDataCatalog
export declare const parseSafeDataBinding: (
  value: unknown,
  options?: Readonly<{ limits?: Partial<DashboardDataLimits> }>,
) => DashboardSafeDataBinding
export declare const parseSafeDataBindings: (
  value: unknown,
  options?: Readonly<{ limits?: Partial<DashboardDataLimits> }>,
) => DashboardSafeDataBindings
export declare const applySafeDataTransform: (
  value: DashboardDataJsonValue,
  transform?: readonly DashboardDataTransformStep[],
  options?: Readonly<{ limits?: Partial<DashboardDataLimits>; now?: () => number }>,
) => DashboardDataJsonValue
export declare const summarizeSafeDataDescriptor: (descriptor: DashboardSafeDataDescriptor) => Readonly<{
  schemaVersion: 1
  id: string
  kind: DashboardSafeDataDescriptor['kind']
  hasTransform: boolean
  providerId?: string
  destination?: Readonly<{ url: string; method: 'GET' | 'POST' }>
}>
export declare const createDashboardSameOriginDataResolver: (
  options?: Readonly<{
    endpoint?: string
    fetchImpl?: typeof fetch
  }>,
) => DashboardDataResolver
