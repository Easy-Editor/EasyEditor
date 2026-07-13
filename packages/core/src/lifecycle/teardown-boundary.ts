type LifecycleTeardownOperation = (args: unknown[]) => unknown

interface LifecycleTeardownBoundary {
  engineOwned: boolean
  operation: LifecycleTeardownOperation
}

const lifecycleTeardownBoundaries = new WeakMap<object, LifecycleTeardownBoundary>()
const lifecycleTeardownChildren = new WeakMap<object, Set<object>>()

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
  for (const child of lifecycleTeardownChildren.get(target) || []) {
    claimEngineTeardownOwnership(child)
  }
}

/** Propagate engine ownership to lazily-created child services. */
export function inheritEngineTeardownOwnership(owner: object, target: object): void {
  let children = lifecycleTeardownChildren.get(owner)
  if (!children) {
    children = new Set()
    lifecycleTeardownChildren.set(owner, children)
  }
  children.add(target)
  if (lifecycleTeardownBoundaries.get(owner)?.engineOwned) {
    claimEngineTeardownOwnership(target)
  }
}

/** Standalone services retain their historical explicit cleanup contract. */
export function assertPublicLifecycleTeardownAllowed(target: object, origin: string): void {
  if (!lifecycleTeardownBoundaries.get(target)?.engineOwned) return
  throw new Error(`Cannot ${origin}; cleanup of an engine-owned service must be initiated by EngineInstance.destroy()`)
}

/** Engine-owned child lifecycles are coordinated by their owning manager. */
export function assertPublicOwnedLifecycleOperationAllowed(target: object, origin: string): void {
  if (!lifecycleTeardownBoundaries.get(target)?.engineOwned) return
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
