import type { ArtifactNodeV1, ArtifactRecordV1, ArtifactRef } from '../../lib/storage/artifact-contracts.mjs'
import type { DashboardStorageBackend } from '../../lib/storage/contracts.mjs'
import type { OnlineComponentSurfaceController, OnlineComponentSurfaceMarkerStorage } from './surface-controller.mjs'
import type { OnlineComponentJsonValue } from './surface-protocol.mjs'
import type { OnlineComponentTrustedShellEvent } from './trusted-event-adapter.mjs'

export interface DashboardOnlineComponentBindingInput {
  readonly instanceId: string
  readonly node: Readonly<ArtifactNodeV1 & { componentName: 'GeneratedMaterialHost' }>
  readonly props: Readonly<Record<string, unknown>>
  readonly element: HTMLElement
}

export interface DashboardOnlineComponentBindingHandle {
  update(input: Omit<DashboardOnlineComponentBindingInput, 'instanceId'>): boolean
  dispose(): boolean
}

export interface DashboardOnlineComponentSurfaceBridge {
  attach(input: {
    readonly controller: OnlineComponentSurfaceController
    readonly projectId: string
    readonly mount: HTMLElement
  }): () => boolean
  detach(controller?: OnlineComponentSurfaceController): boolean
  connect(input: DashboardOnlineComponentBindingInput): DashboardOnlineComponentBindingHandle
  getDiagnostics(): Readonly<{
    attached: boolean
    instanceCount: number
    scheduledFrameCount: number
  }>
}

export interface DashboardOnlineComponentSurfaceBridgeOptions {
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number
  readonly cancelAnimationFrame?: (handle: number) => void
  readonly getComputedStyle?: (element: Element) => CSSStyleDeclaration
  readonly onError?: (error: unknown) => void
}

export interface DashboardOnlineComponentSurfaceHandle {
  dispose(): void
  getDiagnostics(): Readonly<{
    state: 'disabled' | 'discovering' | 'safe-boot' | 'active' | 'disposed'
    controllerCreated: boolean
  }>
}

export interface DashboardOnlineComponentSurfaceOptions {
  readonly enabled: boolean
  readonly safeBoot?: boolean
  readonly mode: 'editor' | 'preview'
  readonly projectId: string
  readonly branchId: string
  readonly surfaceId: string
  readonly bridge: DashboardOnlineComponentSurfaceBridge
  readonly markerStore: OnlineComponentSurfaceMarkerStorage
  readonly persistence: Pick<DashboardStorageBackend, 'readArtifact'>
  readonly document: Document
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number
  readonly cancelAnimationFrame?: (handle: number) => void
  readonly MutationObserver?: typeof MutationObserver
  readonly createController?: (options: {
    readonly projectId: string
    readonly branchId: string
    readonly surfaceId: string
    readonly featureEnabled: true
    readonly safeBoot: boolean
    readonly markerStore: OnlineComponentSurfaceMarkerStorage
    readonly readArtifact: (artifactRef: ArtifactRef) => Promise<ArtifactRecordV1 | null>
    readonly surfaceHostOptions: Readonly<{
      mode: 'editor' | 'preview'
      mount: HTMLElement
      onSelection?: (event: OnlineComponentTrustedShellEvent) => void
      onRuntimeEvent?: (event: OnlineComponentTrustedShellEvent) => void
    }>
  }) => OnlineComponentSurfaceController
  readonly onSelection?: (event: OnlineComponentTrustedShellEvent) => void
  readonly onRuntimeEvent?: (event: OnlineComponentTrustedShellEvent) => void
}

export declare const DASHBOARD_ONLINE_COMPONENT_BRIDGE_KEY: 'onlineComponentSurfaceBridge'
export declare const DASHBOARD_ONLINE_COMPONENT_SAFE_BOOT_QUERY: 'easy-editor-online-safe-boot'
export declare const DASHBOARD_ONLINE_COMPONENT_RUNTIME_EVENT: 'easy-editor:online-component-runtime-event'
export declare const sanitizeDashboardOnlineComponentProps: (
  props: Readonly<Record<string, unknown>>,
) => Readonly<Record<string, OnlineComponentJsonValue>>
export declare const resolveDashboardOnlineComponentSafeBoot: (search: string) => boolean
export declare const isDashboardOnlineComponentSurfaceEnabled: (flags: {
  readonly runtime?: boolean
  readonly online?: boolean
}) => boolean
export declare const dispatchDashboardOnlineComponentRuntimeEvent: (
  target: Pick<EventTarget, 'dispatchEvent'>,
  event: Readonly<{ surfaceId: string; instanceId: string; type: string; payload?: unknown }>,
  CustomEventClass?: typeof CustomEvent,
) => boolean
export declare const createDashboardOnlineComponentSurfaceBridge: (
  options?: DashboardOnlineComponentSurfaceBridgeOptions,
) => DashboardOnlineComponentSurfaceBridge
export declare const startDashboardOnlineComponentSurface: (
  options: DashboardOnlineComponentSurfaceOptions,
) => DashboardOnlineComponentSurfaceHandle
