import type { RemoteAccessRequest } from '@easy-editor/core/instance'

export interface RemoteOperation {
  readonly abortController: AbortController
  readonly generation: number
  readonly label: string
}

export interface OwnedDomNode {
  remove(): void
}

export interface OwnedSocket {
  close(): void
}

export declare class RemoteResourceScope {
  constructor(authorize: (request: RemoteAccessRequest) => unknown)
  get isActive(): boolean
  assertActive(): void
  activate(): void
  beginOperation(label?: string): RemoteOperation
  finishOperation(operation: RemoteOperation): void
  assertCurrent(operation: RemoteOperation): void
  perform<T>(request: RemoteAccessRequest, effect: () => T): T
  ownNode(node: OwnedDomNode): void
  removeOwnedNode(node: OwnedDomNode): void
  ownSocket(socket: OwnedSocket): void
  releaseSocket(socket: OwnedSocket): void
  setTimer(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimer(timer: ReturnType<typeof setTimeout>): void
  dispose(): Promise<void>
}
