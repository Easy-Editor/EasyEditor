import type { OwnedDomNode, OwnedSocket, RemoteResourceScope } from './resource-scope.js'

type ResourceOwner = Pick<RemoteResourceScope, 'releaseSocket' | 'removeOwnedNode'>

export declare const closeOwnedSocket: (scope: ResourceOwner, socket: OwnedSocket) => void

export declare const removeOwnedNodeForSettlement: (
  scope: ResourceOwner,
  node: OwnedDomNode,
  operationError?: unknown,
) => unknown
