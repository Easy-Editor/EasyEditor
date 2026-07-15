export type DashboardJsonPrimitive = boolean | number | string | null
export type DashboardJsonValue =
  | DashboardJsonPrimitive
  | readonly DashboardJsonValue[]
  | { readonly [key: string]: DashboardJsonValue }
export type DashboardJsonObject = Readonly<Record<string, DashboardJsonValue>>

export type DashboardCapabilityAvailability = 'available' | 'unavailable'

export interface DashboardCapabilityDescriptor {
  readonly schemaVersion: 1
  readonly capability: string
  readonly revision: string
  readonly availability: DashboardCapabilityAvailability
  readonly unavailableReason?: string
  readonly input: DashboardJsonObject
  readonly output: DashboardJsonObject
}

export interface DashboardCapabilitySchema {
  readonly schemaVersion: 1
  readonly capability: string
  readonly revision: string
  readonly input: DashboardJsonObject
  readonly output: DashboardJsonObject
}

export interface DashboardCapabilitySchemaRequest {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly capability: string
}

export interface DashboardCapabilityRegistrySnapshot {
  readonly schemaVersion: 1
  readonly revision: string
  readonly hash: string
  readonly capabilities: readonly DashboardCapabilityDescriptor[]
}

export type DashboardCapabilityErrorCode =
  | 'INVALID_CAPABILITY_REQUEST'
  | 'CAPABILITY_UNAVAILABLE'
  | 'UNKNOWN_CAPABILITY'

export declare const DASHBOARD_CAPABILITY_REGISTRY_SCHEMA_VERSION: 1
export declare const DASHBOARD_CAPABILITY_REGISTRY_REVISION: 'dashboard-capability-registry/1'
export declare const DASHBOARD_PHASE_2_UNAVAILABLE_REASON: 'unavailable-in-phase-2-read-only'
export declare const DASHBOARD_CAPABILITY_ERROR_CODE: Readonly<{
  invalidRequest: 'INVALID_CAPABILITY_REQUEST'
  unavailable: 'CAPABILITY_UNAVAILABLE'
  unknown: 'UNKNOWN_CAPABILITY'
}>
export declare const DASHBOARD_CAPABILITY_DESCRIPTORS: readonly DashboardCapabilityDescriptor[]
export declare const DASHBOARD_CAPABILITY_NAMES: readonly string[]
export declare const DASHBOARD_CAPABILITY_REGISTRY_HASH: string
export declare const DASHBOARD_CAPABILITY_REGISTRY_SNAPSHOT: DashboardCapabilityRegistrySnapshot

export declare class DashboardCapabilityRegistryError extends Error {
  readonly code: DashboardCapabilityErrorCode
  readonly capability: string | null
  readonly reason: string
  constructor(
    code: DashboardCapabilityErrorCode,
    options: { readonly capability?: string | null; readonly reason: string },
  )
  toJSON(): Readonly<{
    schemaVersion: 1
    code: DashboardCapabilityErrorCode
    capability: string | null
    reason: string
  }>
}

export declare const getDashboardCapabilityDescriptor: (capability: string) => DashboardCapabilityDescriptor
export declare const assertDashboardCapabilityAvailable: (capability: string) => DashboardCapabilityDescriptor
export declare const describeDashboardCapability: (
  request: DashboardCapabilitySchemaRequest,
) => Promise<DashboardCapabilitySchema>
export declare const listDashboardCapabilities: () => readonly DashboardCapabilityDescriptor[]
export declare const getDashboardCapabilityRegistrySnapshot: () => DashboardCapabilityRegistrySnapshot

export declare const dashboardCapabilityRegistry: Readonly<{
  assertAvailable: typeof assertDashboardCapabilityAvailable
  describeCapability: typeof describeDashboardCapability
  getDescriptor: typeof getDashboardCapabilityDescriptor
  listCapabilities: typeof listDashboardCapabilities
  snapshot: typeof getDashboardCapabilityRegistrySnapshot
}>
