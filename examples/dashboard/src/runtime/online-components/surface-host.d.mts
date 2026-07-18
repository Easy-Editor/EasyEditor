import type { OnlineComponentActivationMarkerStore } from './activation-lifecycle.mjs'
import type {
  OnlineComponentJsonValue,
  OnlineComponentProtocolIdentity,
  OnlineComponentRenderUpdate,
} from './surface-protocol.mjs'
import type {
  OnlineComponentSurfaceMode,
  OnlineComponentTrustedShellEvent,
  OnlineComponentTrustedShellEventType,
} from './trusted-event-adapter.mjs'

export interface OnlineComponentFrameResourceCounts {
  readonly iframeCount: number
  readonly shellCount: number
  readonly listenerCount: number
}

export interface OnlineComponentShellResourceCounts {
  readonly shellCount: number
  readonly listenerCount: number
}

export interface OnlineComponentShellHandle {
  update(update: Pick<OnlineComponentRenderUpdate, 'rect' | 'visible' | 'generatedZ'>): void
  dispose(): void
  getResourceCounts(): OnlineComponentShellResourceCounts
}

export interface OnlineComponentSandboxFrameHandle {
  onLoad(listener: () => void): () => void
  postConnect(message: unknown, transferredPort: unknown): void
  createShell(
    input: OnlineComponentRenderUpdate & {
      readonly mode: OnlineComponentSurfaceMode
      readonly onEvent: (input: {
        readonly instanceId: string
        readonly type: OnlineComponentTrustedShellEventType
        readonly event?: object
      }) => OnlineComponentTrustedShellEvent
      readonly bindTrustedShell?: (shell: HTMLElement, instanceId: string) => () => void
    },
  ): OnlineComponentShellHandle
  getResourceCounts(): OnlineComponentFrameResourceCounts
  dispose(): void
}

export interface OnlineComponentMessagePort {
  onmessage: ((event: { readonly data: unknown }) => void) | undefined
  postMessage(message: unknown): void
  start(): void
  close(): void
}

export interface OnlineComponentSurfaceEnvironment {
  createNonce(): string
  createMessageChannel(): {
    readonly port1: OnlineComponentMessagePort
    readonly port2: OnlineComponentMessagePort
  }
  createSandboxFrame(options: {
    readonly mount: HTMLElement
    readonly mode: OnlineComponentSurfaceMode
    readonly surfaceId: string
    readonly generation: number
    readonly nonce: string
    readonly sandbox: 'allow-scripts'
    readonly pointerEvents: 'none'
    readonly document: string
  }): OnlineComponentSandboxFrameHandle
  requestAnimationFrame(callback: (timestamp: number) => void): number
  cancelAnimationFrame(handle: number): void
  subscribeVisibility(listener: (visible: boolean) => void): () => void
}

export interface OnlineComponentRuntimeEvent {
  readonly kind: 'online-component.runtime-event'
  readonly surfaceId: string
  readonly instanceId: string
  readonly type: string
  readonly payload: OnlineComponentJsonValue
}

export interface OnlineComponentSurfaceDiagnostics {
  readonly state: string
  readonly surfaceId: string
  readonly mode: OnlineComponentSurfaceMode
  readonly generation: number
  readonly iframeCount: number
  readonly portCount: number
  readonly shellCount: number
  readonly instanceCount: number
  readonly scheduledFrameCount: number
  readonly batchCount: number
  readonly pendingBatchCount: number
  readonly restartCount: number
  readonly faultCount: number
  readonly rejectedMessageCount: number
  readonly listenerCount: number
  readonly pendingActivationCount: number
  readonly quarantinedRevisionCount: number
  readonly sandboxInstanceCount: number
  readonly sandboxListenerCount: number
  readonly sandboxPendingTaskCount: number
  readonly objectUrlCount: number
}

export interface OnlineComponentSurfaceHost {
  readonly surfaceId: string
  readonly mode: OnlineComponentSurfaceMode
  register(input: OnlineComponentRenderUpdate): false | (() => boolean)
  update(instanceId: string, patch: Partial<Omit<OnlineComponentRenderUpdate, 'instanceId'>>): boolean
  unregister(instanceId: string): boolean
  restart(reason: string): boolean
  setSurfaceVisible(visible: boolean): boolean
  abortOwnedActivation(): boolean
  whenReady(input: Readonly<{ expectedInstanceIds: readonly string[] }>): Promise<boolean>
  dispose(): void
  getDiagnostics(): OnlineComponentSurfaceDiagnostics
}

export interface OnlineComponentSurfaceHostOptions {
  readonly enabled?: boolean
  readonly safeBoot?: boolean
  readonly mount: HTMLElement
  readonly mode: OnlineComponentSurfaceMode
  readonly surfaceId: string
  readonly activationId: string
  readonly environment?: OnlineComponentSurfaceEnvironment
  readonly markerStore: OnlineComponentActivationMarkerStore
  readonly now?: () => number
  readonly telemetry?: Readonly<{ record(event: Readonly<Record<string, unknown>>): unknown }>
  readonly telemetryNow?: () => number
  readonly allowedRuntimeEvents?: readonly OnlineComponentTrustedShellEventType[]
  readonly onSelection?: (event: OnlineComponentTrustedShellEvent) => void
  readonly onRuntimeEvent?: (event: OnlineComponentTrustedShellEvent | OnlineComponentRuntimeEvent) => void
  readonly bindTrustedShell?: (shell: HTMLElement, instanceId: string) => () => void
}

export declare const createBrowserOnlineComponentSurfaceEnvironment: () => OnlineComponentSurfaceEnvironment
export declare const createOnlineComponentSurfaceHost: (
  options: OnlineComponentSurfaceHostOptions,
) => OnlineComponentSurfaceHost

export type { OnlineComponentProtocolIdentity }
