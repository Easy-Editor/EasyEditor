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

const lifecycleMutationParents = new WeakMap<object, object>()

const mutationEpochs = new WeakMap<LifecycleMutationGuard, number>()

interface ResolvedLifecycleMutationOwnership {
  guard?: LifecycleMutationGuard
  sealedReason?: string
}

const getMutationEpoch = (guard?: LifecycleMutationGuard): number => {
  return guard ? mutationEpochs.get(guard) || 0 : 0
}

const resolveLifecycleMutationOwnership = (target: object): ResolvedLifecycleMutationOwnership => {
  const visited = new Set<object>()
  let current: object | undefined = target
  let guard: LifecycleMutationGuard | undefined
  let sealedReason: string | undefined
  while (current) {
    if (visited.has(current)) throw new Error('Lifecycle mutation ownership contains a cycle')
    visited.add(current)
    const ownership = mutationOwnership.get(current)
    guard ||= ownership?.guard
    sealedReason ||= ownership?.sealedReason
    current = lifecycleMutationParents.get(current)
  }
  return { guard, sealedReason }
}

const resolveLifecycleMutationGuard = (target: object): LifecycleMutationGuard | undefined =>
  resolveLifecycleMutationOwnership(target).guard

/**
 * Attach one engine-owned lifecycle guard without changing the target's
 * public identity or constructor contract.
 */
export function installLifecycleMutationGuard(target: object, guard: LifecycleMutationGuard): void {
  const ownership = mutationOwnership.get(target)
  const existingGuard = resolveLifecycleMutationGuard(target)
  if (existingGuard && existingGuard !== guard) {
    throw new Error('Lifecycle mutation ownership is already assigned to another engine')
  }
  if (!mutationEpochs.has(guard)) mutationEpochs.set(guard, 0)
  mutationOwnership.set(target, { ...ownership, guard })
}

/** Inherit the same engine owner for a lazily-created nested runtime. */
export function inheritLifecycleMutationGuard(owner: object, target: object): void {
  const existingParent = lifecycleMutationParents.get(target)
  if (existingParent && existingParent !== owner) {
    throw new Error('Lifecycle mutation parent is already assigned to another owner')
  }
  let ancestor: object | undefined = owner
  while (ancestor) {
    if (ancestor === target) throw new Error('Lifecycle mutation ownership cannot contain a cycle')
    ancestor = lifecycleMutationParents.get(ancestor)
  }
  const ownerGuard = resolveLifecycleMutationGuard(owner)
  const targetGuard = resolveLifecycleMutationGuard(target)
  if (ownerGuard && targetGuard && ownerGuard !== targetGuard) {
    throw new Error('Lifecycle mutation ownership is already assigned to another engine')
  }
  lifecycleMutationParents.set(target, owner)
}

/** Package-private ownership query used to keep raw runtime objects out of capability membranes. */
export function sharesLifecycleMutationOwner(owner: object, target: object): boolean {
  const ownerGuard = resolveLifecycleMutationGuard(owner)
  return ownerGuard !== undefined && resolveLifecycleMutationGuard(target) === ownerGuard
}

/** Whether a target belongs to any Engine lifecycle generation. */
export function hasLifecycleMutationOwner(target: object): boolean {
  return resolveLifecycleMutationGuard(target) !== undefined
}

/** Permanently revoke a generation-scoped object while retaining its owner. */
export function sealLifecycleMutations(target: object, reason: string): void {
  const ownership = mutationOwnership.get(target)
  mutationOwnership.set(target, { ...ownership, sealedReason: reason })
}

/** Standalone modules remain usable when no Engine has claimed ownership. */
export function assertLifecycleMutationAllowed(target: object, origin: string): void {
  const ownership = resolveLifecycleMutationOwnership(target)
  if (ownership.sealedReason) {
    throw new Error(`Cannot ${origin}; ${ownership.sealedReason}`)
  }
  ownership.guard?.(origin)
}

/**
 * Reject work on a retired object without consulting the engine state guard.
 * Internal teardown may still need to publish final lifecycle events while the
 * engine is disposing, but a locally sealed generation must never emit again.
 */
export function assertLifecycleMutationUnsealed(target: object, origin: string): void {
  const { sealedReason } = resolveLifecycleMutationOwnership(target)
  if (sealedReason) {
    throw new Error(`Cannot ${origin}; ${sealedReason}`)
  }
}

/** Package-private probe for dropping work queued before its generation retired. */
export function isLifecycleMutationSealed(target: object): boolean {
  return resolveLifecycleMutationOwnership(target).sealedReason !== undefined
}

/**
 * Invalidate every in-flight mutation owned by the same engine guard. Engine
 * lifecycle transitions call this before asynchronous work can commit into a
 * later generation.
 */
export function advanceLifecycleMutationEpoch(target: object): void {
  const guard = resolveLifecycleMutationGuard(target)
  if (!guard) return
  mutationEpochs.set(guard, getMutationEpoch(guard) + 1)
}

/** Capture the current owner generation before awaiting untrusted work. */
export function captureLifecycleMutationTicket(target: object, origin: string): LifecycleMutationTicket {
  assertLifecycleMutationAllowed(target, origin)
  return captureLifecycleMutationGeneration(target)
}

/** Package-private snapshot for deferred work that may also be emitted during teardown. */
export function captureLifecycleMutationGeneration(target: object): LifecycleMutationTicket {
  const guard = resolveLifecycleMutationGuard(target)
  return { epoch: getMutationEpoch(guard), guard }
}

/**
 * Non-throwing generation probe for deferred delivery. Stale work is dropped
 * rather than converted into a post-commit observer error.
 */
export function isLifecycleMutationTicketCurrent(target: object, ticket: LifecycleMutationTicket): boolean {
  const ownership = resolveLifecycleMutationOwnership(target)
  if (ownership.sealedReason) return false
  return ownership.guard === ticket.guard && getMutationEpoch(ownership.guard) === ticket.epoch
}

/** Reject a completion that resumed under another lifecycle generation. */
export function assertLifecycleMutationTicket(target: object, ticket: LifecycleMutationTicket, origin: string): void {
  assertLifecycleMutationAllowed(target, origin)
  const guard = resolveLifecycleMutationGuard(target)
  if (guard !== ticket.guard || getMutationEpoch(guard) !== ticket.epoch) {
    throw new Error(`Cannot ${origin}; the engine lifecycle generation changed while the operation was pending`)
  }
}
