type LifecycleTeardownOperation = (args: unknown[]) => unknown

interface LifecycleTeardownBoundary {
  engineOwned: boolean
  operation: LifecycleTeardownOperation
}

const lifecycleTeardownBoundaries = new WeakMap<object, LifecycleTeardownBoundary>()
// Ownership points from a child to its owner. A persistent Engine service must
// never keep retired generation resources alive merely to remember teardown
// authority. WeakMap keys make the child collectable while dynamic parent
// resolution still supports owners claimed after their children are created.
const lifecycleTeardownParents = new WeakMap<object, object>()

const isEngineTeardownOwned = (target: object): boolean => {
  const visited = new Set<object>()
  let current: object | undefined = target
  while (current) {
    if (visited.has(current)) throw new Error('Lifecycle teardown ownership contains a cycle')
    visited.add(current)
    if (lifecycleTeardownBoundaries.get(current)?.engineOwned) return true
    current = lifecycleTeardownParents.get(current)
  }
  return false
}

/** Register an internal cleanup operation without exposing it on the public instance. */
export function installLifecycleTeardownOperation<TArgs extends unknown[], TResult>(
  target: object,
  operation: (...args: TArgs) => TResult,
): void {
  if (lifecycleTeardownBoundaries.has(target)) {
    throw new Error('Lifecycle teardown operation is already installed')
  }
  lifecycleTeardownBoundaries.set(target, {
    engineOwned: false,
    operation: args => operation(...(args as TArgs)),
  })
}

/** Mark a service as owned by an EngineInstance after construction is complete. */
export function claimEngineTeardownOwnership(target: object): void {
  const boundary = lifecycleTeardownBoundaries.get(target)
  if (!boundary) throw new Error('Engine-owned service has no internal teardown operation')
  if (boundary.engineOwned) return
  boundary.engineOwned = true
}

/** Propagate engine ownership to lazily-created child services. */
export function inheritEngineTeardownOwnership(owner: object, target: object): void {
  if (!lifecycleTeardownBoundaries.has(owner)) {
    throw new Error('Lifecycle teardown owner has no internal teardown operation')
  }
  if (!lifecycleTeardownBoundaries.has(target)) {
    throw new Error('Engine-owned child has no internal teardown operation')
  }
  const existingParent = lifecycleTeardownParents.get(target)
  if (existingParent && existingParent !== owner) {
    throw new Error('Lifecycle teardown parent is already assigned to another owner')
  }
  let ancestor: object | undefined = owner
  while (ancestor) {
    if (ancestor === target) throw new Error('Lifecycle teardown ownership cannot contain a cycle')
    ancestor = lifecycleTeardownParents.get(ancestor)
  }
  lifecycleTeardownParents.set(target, owner)
}

/** Package-private diagnostic used by the kernel regression suite. */
export function getLifecycleTeardownParent(target: object): object | undefined {
  return lifecycleTeardownParents.get(target)
}

/** Standalone services retain their historical explicit cleanup contract. */
export function assertPublicLifecycleTeardownAllowed(target: object, origin: string): void {
  if (!isEngineTeardownOwned(target)) return
  throw new Error(`Cannot ${origin}; cleanup of an engine-owned service must be initiated by EngineInstance.destroy()`)
}

/** Engine-owned child lifecycles are coordinated by their owning manager. */
export function assertPublicOwnedLifecycleOperationAllowed(target: object, origin: string): void {
  if (!isEngineTeardownOwned(target)) return
  throw new Error(`Cannot ${origin}; lifecycle of an engine-owned child must be coordinated by its owning service`)
}

/** Execute a registered cleanup operation through a package-private capability. */
export function runInternalLifecycleTeardown<TArgs extends unknown[], TResult = void>(
  target: object,
  ...args: TArgs
): TResult {
  const boundary = lifecycleTeardownBoundaries.get(target)
  if (!boundary) throw new Error('Lifecycle teardown operation is not installed')
  return boundary.operation(args) as TResult
}
