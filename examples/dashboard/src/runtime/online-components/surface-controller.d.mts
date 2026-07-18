import type {
  ArtifactNodeV1,
  ArtifactRecordV1,
  ArtifactRef,
  CanonicalNodeExtra,
} from '../../lib/storage/artifact-contracts.mjs'
import type { OnlineComponentSurfaceHost, OnlineComponentSurfaceHostOptions } from './surface-host.mjs'
import type { OnlineComponentJsonValue, OnlineComponentRect } from './surface-protocol.mjs'

export interface OnlineComponentSurfaceMarkerStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface OnlineComponentSandboxArtifactDependency {
  readonly specifier: string
  readonly source: string
}

export interface OnlineComponentSandboxArtifact {
  readonly source: string
  readonly css: string
  readonly dependencies: readonly OnlineComponentSandboxArtifactDependency[]
}

export interface OnlineComponentSurfaceRegistration {
  readonly projectId: string
  readonly instanceId: string
  readonly node: Readonly<ArtifactNodeV1 & CanonicalNodeExtra & { componentName: 'GeneratedMaterialHost' }>
  readonly rect: OnlineComponentRect
  readonly visible: boolean
  readonly generatedZ: number
  readonly payload: Readonly<Record<string, OnlineComponentJsonValue>>
}

export interface OnlineComponentSurfaceUpdate {
  readonly projectId?: string
  readonly node?: OnlineComponentSurfaceRegistration['node']
  readonly rect?: OnlineComponentRect
  readonly visible?: boolean
  readonly generatedZ?: number
  readonly payload?: Readonly<Record<string, OnlineComponentJsonValue>>
}

export type OnlineComponentSurfaceHostFactoryOptions = Omit<
  OnlineComponentSurfaceHostOptions,
  'enabled' | 'safeBoot' | 'surfaceId' | 'activationId' | 'markerStore'
>

export interface OnlineComponentSurfaceControllerOptions {
  readonly projectId: string
  readonly branchId: string
  readonly surfaceId: string
  readonly featureEnabled?: boolean
  readonly safeBoot?: boolean
  readonly markerStore: OnlineComponentSurfaceMarkerStorage
  readonly readArtifact: (
    artifactRef: ArtifactRef,
  ) => ArtifactRecordV1 | null | undefined | Promise<ArtifactRecordV1 | null | undefined>
  readonly hashBytes?: (bytes: Uint8Array) => ArrayBufferView | Promise<ArrayBufferView>
  readonly createSurfaceHost?: (options: OnlineComponentSurfaceHostOptions) => OnlineComponentSurfaceHost
  readonly surfaceHostOptions: OnlineComponentSurfaceHostFactoryOptions
}

export interface OnlineComponentSurfaceControllerDiagnostics {
  readonly state: 'disabled' | 'safe-boot' | 'idle' | 'quarantined' | 'active' | 'disposed'
  readonly instanceCount: number
  readonly iframeCount: number
  readonly hostCreated: boolean
  readonly faultCount: number
}

export interface OnlineComponentSurfaceController {
  register(input: OnlineComponentSurfaceRegistration): Promise<boolean>
  update(instanceId: string, patch: OnlineComponentSurfaceUpdate): Promise<boolean>
  unregister(instanceId: string): boolean
  whenReady(input: Readonly<{ expectedInstanceIds: readonly string[] }>): Promise<boolean>
  matchesReadyCensus(input: Readonly<{ expectedInstanceIds: readonly string[] }>): boolean
  clearQuarantine(): boolean
  abortOwnedActivation(): boolean
  dispose(): void
  getDiagnostics(): OnlineComponentSurfaceControllerDiagnostics
}

export declare const createOnlineComponentSurfaceMarkerStorageKey: (input: {
  readonly projectId: string
  readonly branchId: string
  readonly surfaceId: string
}) => string

export declare const createBrowserOnlineComponentHashBytes: (
  crypto?: Pick<Crypto, 'subtle'>,
) => (bytes: Uint8Array) => Promise<Uint8Array>

export declare const createOnlineComponentSurfaceController: (
  options: OnlineComponentSurfaceControllerOptions,
) => OnlineComponentSurfaceController
