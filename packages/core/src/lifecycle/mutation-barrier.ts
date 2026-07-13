export type LifecycleMutationGuard = (origin: string) => void

export interface LifecycleMutationTicket {
  readonly epoch: number
  readonly guard?: LifecycleMutationGuard
}

interface MutationOwnership {
  guard?: LifecycleMutationGuard
  sealedReason?: string
}

const mutationOwnership = new WeakMap<object, MutationOwnership>()

const mutationEpochs = new WeakMap<LifecycleMutationGuard, number>()

const getMutationEpoch = (guard?: LifecycleMutationGuard): number => {
  return guard ? mutationEpochs.get(guard) || 0 : 0
}

/**
 * Attach one engine-owned lifecycle guard without changing the target's
 * public identity or constructor contract.
 */
export function installLifecycleMutationGuard(target: object, guard: LifecycleMutationGuard): void {
  const ownership = mutationOwnership.get(target)
  if (ownership?.guard && ownership.guard !== guard) {
    throw new Error('Lifecycle mutation ownership is already assigned to another engine')
  }
  if (!mutationEpochs.has(guard)) mutationEpochs.set(guard, 0)
  mutationOwnership.set(target, { ...ownership, guard })
}

/** Inherit the same engine owner for a lazily-created nested runtime. */
export function inheritLifecycleMutationGuard(owner: object, target: object): void {
  const guard = mutationOwnership.get(owner)?.guard
  if (guard) installLifecycleMutationGuard(target, guard)
}

/** Permanently revoke a generation-scoped object while retaining its owner. */
export function sealLifecycleMutations(target: object, reason: string): void {
  const ownership = mutationOwnership.get(target)
  mutationOwnership.set(target, { ...ownership, sealedReason: reason })
}

/** Standalone modules remain usable when no Engine has claimed ownership. */
export function assertLifecycleMutationAllowed(target: object, origin: string): void {
  const ownership = mutationOwnership.get(target)
  if (ownership?.sealedReason) {
    throw new Error(`Cannot ${origin}; ${ownership.sealedReason}`)
  }
  ownership?.guard?.(origin)
}

/**
 * Invalidate every in-flight mutation owned by the same engine guard. Engine
 * lifecycle transitions call this before asynchronous work can commit into a
 * later generation.
 */
export function advanceLifecycleMutationEpoch(target: object): void {
  const guard = mutationOwnership.get(target)?.guard
  if (!guard) return
  mutationEpochs.set(guard, getMutationEpoch(guard) + 1)
}

/** Capture the current owner generation before awaiting untrusted work. */
export function captureLifecycleMutationTicket(target: object, origin: string): LifecycleMutationTicket {
  assertLifecycleMutationAllowed(target, origin)
  const guard = mutationOwnership.get(target)?.guard
  return { epoch: getMutationEpoch(guard), guard }
}

/** Reject a completion that resumed under another lifecycle generation. */
export function assertLifecycleMutationTicket(target: object, ticket: LifecycleMutationTicket, origin: string): void {
  assertLifecycleMutationAllowed(target, origin)
  const guard = mutationOwnership.get(target)?.guard
  if (guard !== ticket.guard || getMutationEpoch(guard) !== ticket.epoch) {
    throw new Error(`Cannot ${origin}; the engine lifecycle generation changed while the operation was pending`)
  }
}
