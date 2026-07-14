/**
 * Turn TypeScript-only readonly fields into non-shadowable runtime invariants.
 *
 * This is intentionally limited to already-initialized own data properties.
 * Mutable state must stay behind dedicated methods/accessors instead of being
 * included here.
 */
export function lockReadonlyProperties(target: object, keys: readonly PropertyKey[]): void {
  const descriptors: PropertyDescriptorMap = {}
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key)
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError(`Cannot lock non-data property ${String(key)}`)
    }
    descriptors[key as PropertyKey] = {
      ...descriptor,
      configurable: false,
      writable: false,
    }
  }
  Object.defineProperties(target, descriptors)
}

/**
 * Pin prototype accessors onto one instance so an own data property cannot
 * shadow the guarded getter or setter. The delegate is bound to the original
 * instance so private slots and MobX-decorated accessors keep their semantics.
 */
export function lockPrototypeAccessors(target: object, keys: readonly PropertyKey[]): void {
  for (const key of keys) {
    let prototype: object | null = Object.getPrototypeOf(target)
    let descriptor: PropertyDescriptor | undefined
    while (prototype && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, key)
      prototype = Object.getPrototypeOf(prototype)
    }
    if (!descriptor || (!descriptor.get && !descriptor.set)) {
      throw new TypeError(`Cannot lock missing prototype accessor ${String(key)}`)
    }

    const getter = descriptor.get
    const setter = descriptor.set
    Object.defineProperty(target, key, {
      configurable: false,
      enumerable: descriptor.enumerable ?? false,
      get: getter ? () => getter.call(target) : undefined,
      set: setter ? value => setter.call(target, value) : undefined,
    })
  }
}
