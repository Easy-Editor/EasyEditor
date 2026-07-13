/**
 * Expose a stable Map identity while keeping writes behind the owner's
 * mutation seam. Read operations retain native Map behaviour.
 */
export function createMutationGuardedMapView<K, V>(backing: Map<K, V>, assertMutation: () => void): Map<K, V> {
  return new Proxy(backing, {
    get(target, property, receiver) {
      if (property === 'set') {
        return (key: K, value: V) => {
          assertMutation()
          target.set(key, value)
          return receiver as Map<K, V>
        }
      }
      if (property === 'delete') {
        return (key: K) => {
          assertMutation()
          return target.delete(key)
        }
      }
      if (property === 'clear') {
        return () => {
          assertMutation()
          target.clear()
        }
      }
      if (property === 'forEach') {
        return (callback: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown) => {
          target.forEach((value, key) => callback.call(thisArg, value, key, receiver as Map<K, V>))
        }
      }
      if (property === 'size') return target.size
      if (property === 'valueOf') return () => receiver
      if (
        property === 'get' ||
        property === 'has' ||
        property === 'entries' ||
        property === 'keys' ||
        property === 'values' ||
        property === Symbol.iterator
      ) {
        const method = Reflect.get(target, property, target) as (...args: unknown[]) => unknown
        return (...args: unknown[]) => Reflect.apply(method, target, args)
      }

      return Reflect.get(target, property, receiver)
    },
    defineProperty(target, property, attributes) {
      assertMutation()
      return Reflect.defineProperty(target, property, attributes)
    },
    deleteProperty(target, property) {
      assertMutation()
      return Reflect.deleteProperty(target, property)
    },
    preventExtensions(target) {
      assertMutation()
      return Reflect.preventExtensions(target)
    },
    set(target, property, value) {
      assertMutation()
      return Reflect.set(target, property, value, target)
    },
    setPrototypeOf(target, prototype) {
      assertMutation()
      return Reflect.setPrototypeOf(target, prototype)
    },
  })
}
