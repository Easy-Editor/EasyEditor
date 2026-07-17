export type OnlineComponentSurfaceMode = 'editor' | 'preview'
export type OnlineComponentTrustedShellEventType = 'select' | 'drag-start' | 'drag-move' | 'drag-end' | 'activate'

export interface OnlineComponentPointerSnapshot {
  readonly button: number
  readonly clientX: number
  readonly clientY: number
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

export interface OnlineComponentTrustedShellEvent {
  readonly kind: 'online-component.shell-event'
  readonly protocolVersion: 1
  readonly surfaceId: string
  readonly instanceId: string
  readonly mode: OnlineComponentSurfaceMode
  readonly type: OnlineComponentTrustedShellEventType
  readonly pointer: OnlineComponentPointerSnapshot
}

export interface OnlineComponentTrustedShellEventInput {
  readonly mode: OnlineComponentSurfaceMode
  readonly surfaceId: string
  readonly instanceId: string
  readonly type: OnlineComponentTrustedShellEventType
  readonly event?: {
    readonly button?: number
    readonly clientX?: number
    readonly clientY?: number
    readonly altKey?: boolean
    readonly ctrlKey?: boolean
    readonly metaKey?: boolean
    readonly shiftKey?: boolean
  }
}

export interface OnlineComponentTrustedShellEventAdapter {
  readonly mode: OnlineComponentSurfaceMode
  readonly surfaceId: string
  dispatch(input: Omit<OnlineComponentTrustedShellEventInput, 'mode' | 'surfaceId'>): OnlineComponentTrustedShellEvent
}

export declare const normalizeTrustedShellEvent: (
  input: OnlineComponentTrustedShellEventInput,
) => OnlineComponentTrustedShellEvent
export declare const createTrustedShellEventAdapter: (options: {
  readonly mode: OnlineComponentSurfaceMode
  readonly surfaceId: string
  readonly allowedRuntimeEvents?: readonly OnlineComponentTrustedShellEventType[]
  readonly onSelection?: (event: OnlineComponentTrustedShellEvent) => void
  readonly onRuntimeEvent?: (event: OnlineComponentTrustedShellEvent) => void
}) => OnlineComponentTrustedShellEventAdapter
