/**
 * Ownership is released only after the underlying cleanup effect succeeds.
 * A failed effect remains on the owning scope so a later disposal can retry it.
 */
export const closeOwnedSocket = (scope, socket) => {
  socket.close()
  scope.releaseSocket(socket)
}

/**
 * Promise settlement callbacks cannot allow node cleanup to throw past their
 * resolve/reject path. Return the error that should reject the operation while
 * leaving failed removals owned by the scope for disposal retry.
 */
export const removeOwnedNodeForSettlement = (scope, node, operationError) => {
  try {
    scope.removeOwnedNode(node)
    return operationError
  } catch (cleanupError) {
    if (operationError === undefined) return cleanupError
    return new AggregateError([operationError, cleanupError], 'Remote DOM node cleanup failed')
  }
}
