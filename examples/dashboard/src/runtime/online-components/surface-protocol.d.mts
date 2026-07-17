export type OnlineComponentJsonPrimitive = null | boolean | number | string
export type OnlineComponentJsonValue =
  | OnlineComponentJsonPrimitive
  | readonly OnlineComponentJsonValue[]
  | { readonly [key: string]: OnlineComponentJsonValue }

export interface OnlineComponentProtocolIdentity {
  readonly nonce: string
  readonly surfaceId: string
  readonly generation: number
}

export interface OnlineComponentRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface OnlineComponentRenderUpdate {
  readonly instanceId: string
  readonly revisionKey: string
  readonly rect: OnlineComponentRect
  readonly visible: boolean
  readonly generatedZ: number
  readonly payload: Readonly<Record<string, OnlineComponentJsonValue>>
}

export interface OnlineComponentSandboxResourceCounts {
  readonly instanceCount: number
  readonly listenerCount: number
  readonly pendingTaskCount: number
  readonly objectUrlCount: number
}

export interface OnlineComponentConnectMessage extends OnlineComponentProtocolIdentity {
  readonly kind: 'online-component.connect'
  readonly protocolVersion: 1
}

export interface OnlineComponentRenderBatchMessage extends OnlineComponentProtocolIdentity {
  readonly kind: 'online-component.render-batch'
  readonly protocolVersion: 1
  readonly sequence: number
  readonly updates: readonly OnlineComponentRenderUpdate[]
  readonly removals: readonly string[]
}

export interface OnlineComponentReadyMessage extends OnlineComponentProtocolIdentity {
  readonly kind: 'online-component.ready'
  readonly protocolVersion: 1
  readonly resources: OnlineComponentSandboxResourceCounts
}

export interface OnlineComponentBatchAppliedMessage extends OnlineComponentProtocolIdentity {
  readonly kind: 'online-component.batch-applied'
  readonly protocolVersion: 1
  readonly sequence: number
  readonly resources: OnlineComponentSandboxResourceCounts
}

export interface OnlineComponentFaultMessage extends OnlineComponentProtocolIdentity {
  readonly kind: 'online-component.fault'
  readonly protocolVersion: 1
  readonly code: string
  readonly instanceId: string | null
  readonly resources: OnlineComponentSandboxResourceCounts
}

export interface OnlineComponentEventMessage extends OnlineComponentProtocolIdentity {
  readonly kind: 'online-component.event'
  readonly protocolVersion: 1
  readonly instanceId: string
  readonly event: {
    readonly type: string
    readonly payload: OnlineComponentJsonValue
  }
}

export type OnlineComponentSandboxMessage =
  | OnlineComponentReadyMessage
  | OnlineComponentBatchAppliedMessage
  | OnlineComponentFaultMessage
  | OnlineComponentEventMessage

export declare const ONLINE_COMPONENT_PROTOCOL_VERSION: 1
export declare const ONLINE_COMPONENT_PROTOCOL: Readonly<{
  connect: 'online-component.connect'
  ready: 'online-component.ready'
  renderBatch: 'online-component.render-batch'
  batchApplied: 'online-component.batch-applied'
  fault: 'online-component.fault'
  event: 'online-component.event'
  shellEvent: 'online-component.shell-event'
  maxMessageBytes: number
  maxBatchUpdates: number
  maxBatchRemovals: number
}>

export declare class OnlineComponentProtocolError extends Error {
  readonly name: 'OnlineComponentProtocolError'
  readonly code: string
  constructor(code: string, message: string)
}

export declare const normalizeRenderUpdate: (update: OnlineComponentRenderUpdate) => OnlineComponentRenderUpdate
export declare const normalizeSandboxResourceCounts: (
  resources: OnlineComponentSandboxResourceCounts,
) => OnlineComponentSandboxResourceCounts
export declare const createConnectMessage: (input: OnlineComponentProtocolIdentity) => OnlineComponentConnectMessage
export declare const validateConnectMessage: (
  message: unknown,
  expected: OnlineComponentProtocolIdentity,
) => OnlineComponentConnectMessage
export declare const createRenderBatchMessage: (input: {
  readonly nonce: string
  readonly surfaceId: string
  readonly generation: number
  readonly sequence: number
  readonly updates: readonly OnlineComponentRenderUpdate[]
  readonly removals: readonly string[]
}) => OnlineComponentRenderBatchMessage
export declare const parseSandboxMessage: (
  message: unknown,
  expected: OnlineComponentProtocolIdentity,
) => OnlineComponentSandboxMessage
