import {
  type LifecycleMutationTicket,
  assertLifecycleMutationTicket,
  captureLifecycleMutationTicket,
} from '../lifecycle/mutation-barrier'
import type { PluginContext } from './plugin-context'

const capabilityKeys = [
  'engine',
  'clipboard',
  'trustPolicy',
  'project',
  'setters',
  'materials',
  'event',
  'hotkey',
  'config',
  'plugins',
  'logger',
  'pluginEvent',
] as const satisfies readonly (keyof PluginContext)[]

const capabilityProxyTargets = new WeakMap<object, object>()

/** Internal teardown may unwrap a revocable disposer without lending it back to plugin code. */
export function unwrapPluginContextCapability<T>(value: T): T {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value
  return (capabilityProxyTargets.get(value as object) as T | undefined) || value
}

const isPromiseLike = (value: object): value is PromiseLike<unknown> => {
  return typeof (value as { then?: unknown }).then === 'function'
}

/** Create a deep, generation-bound membrane for one engine-owned capability. */
export function createLifecycleCapabilityBinder(owner: object, bindingOrigin: string) {
  const ticket = captureLifecycleMutationTicket(owner, `${bindingOrigin}.bind`)
  const proxies = new WeakMap<object, object>()
  const methods = new WeakMap<object, Map<PropertyKey, (...args: unknown[]) => unknown>>()

  const assertActive = (origin: string): void => {
    assertLifecycleMutationTicket(owner, ticket, origin)
  }

  const wrapResult = <T>(result: T, origin: string): T => {
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      return Promise.resolve(result).then(resolved => {
        assertActive(`${origin}.complete`)
        return wrap(resolved, `${origin}.result`)
      }) as T
    }
    return wrap(result, `${origin}.result`)
  }

  const wrap = <T>(value: T, origin: string): T => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value
    if (typeof value === 'object' && isPromiseLike(value)) return value
    const target = value as object
    const existing = proxies.get(target)
    if (existing) return existing as T

    const callable = typeof value === 'function'
    // Callable capabilities use a neutral constructable target. Proxying the
    // original function directly cannot wrap a class's non-configurable
    // `prototype` property without violating the ECMAScript Proxy invariants.
    const proxyTarget = callable ? function CapabilityFacade() {}.bind(undefined) : target
    const proxy: object = new Proxy(proxyTarget, {
      apply(_innerTarget, thisArg, args) {
        assertActive(`${origin}.apply`)
        return wrapResult(Reflect.apply(target as (...args: unknown[]) => unknown, thisArg, args), origin)
      },
      construct(_innerTarget, args, newTarget) {
        assertActive(`${origin}.construct`)
        const effectiveNewTarget = newTarget === proxy ? (target as new (...args: unknown[]) => object) : newTarget
        return wrapResult(
          Reflect.construct(target as new (...args: unknown[]) => object, args, effectiveNewTarget),
          origin,
        )
      },
      defineProperty(_innerTarget, property, descriptor) {
        assertActive(`${origin}.defineProperty`)
        if (callable && descriptor.configurable !== true) return false
        return Reflect.defineProperty(target, property, descriptor)
      },
      deleteProperty(_innerTarget, property) {
        assertActive(`${origin}.deleteProperty`)
        return Reflect.deleteProperty(target, property)
      },
      get(_innerTarget, property) {
        assertActive(`${origin}.get`)
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
        if (
          !callable &&
          descriptor &&
          'value' in descriptor &&
          descriptor.configurable === false &&
          descriptor.writable === false
        ) {
          return descriptor.value
        }
        const child = Reflect.get(target, property, target)
        if (typeof child !== 'function') return wrap(child, `${origin}.${String(property)}`)

        let targetMethods = methods.get(target)
        if (!targetMethods) {
          targetMethods = new Map()
          methods.set(target, targetMethods)
        }
        const existingMethod = targetMethods.get(property)
        if (existingMethod) return existingMethod

        const guardedMethod = (...args: unknown[]) => {
          assertActive(`${origin}.${String(property)}`)
          return wrapResult(Reflect.apply(child, target, args), `${origin}.${String(property)}`)
        }
        targetMethods.set(property, guardedMethod)
        return guardedMethod
      },
      getOwnPropertyDescriptor(_innerTarget, property) {
        assertActive(`${origin}.getOwnPropertyDescriptor`)
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
        if (!descriptor) return descriptor
        if (!('value' in descriptor)) {
          const wrappedDescriptor = {
            ...descriptor,
            get: descriptor.get ? wrap(descriptor.get, `${origin}.${String(property)}.get`) : descriptor.get,
            set: descriptor.set ? wrap(descriptor.set, `${origin}.${String(property)}.set`) : descriptor.set,
          }
          return callable && descriptor.configurable === false
            ? { ...wrappedDescriptor, configurable: true }
            : wrappedDescriptor
        }
        if (!callable && descriptor.configurable === false && descriptor.writable === false) return descriptor
        const wrappedDescriptor = { ...descriptor, value: wrap(descriptor.value, `${origin}.${String(property)}`) }
        return callable && descriptor.configurable === false
          ? { ...wrappedDescriptor, configurable: true }
          : wrappedDescriptor
      },
      getPrototypeOf() {
        assertActive(`${origin}.getPrototypeOf`)
        return Reflect.getPrototypeOf(target)
      },
      has(_innerTarget, property) {
        assertActive(`${origin}.has`)
        return Reflect.has(target, property)
      },
      ownKeys() {
        assertActive(`${origin}.ownKeys`)
        return Reflect.ownKeys(target)
      },
      preventExtensions() {
        assertActive(`${origin}.preventExtensions`)
        return false
      },
      set(_innerTarget, property, child) {
        assertActive(`${origin}.set`)
        return Reflect.set(target, property, child, target)
      },
      setPrototypeOf(_innerTarget, prototype) {
        assertActive(`${origin}.setPrototypeOf`)
        return Reflect.setPrototypeOf(target, prototype)
      },
    })
    proxies.set(target, proxy)
    capabilityProxyTargets.set(proxy, target)
    return proxy as T
  }

  return <T>(value: T, origin = bindingOrigin): T => wrap(value, origin)
}

/**
 * Create generation-bound views of every engine capability exposed to a
 * plugin. Retained views remain revoked even after the same Engine restarts.
 */
export function bindPluginContextCapabilities(context: PluginContext): void {
  const bind = createLifecycleCapabilityBinder(context, 'pluginContext.capabilities')
  for (const key of capabilityKeys) {
    const capability = context[key]
    Object.defineProperty(context, key, {
      configurable: false,
      enumerable: true,
      value: capability === undefined || key === 'pluginEvent' ? capability : bind(capability, `pluginContext.${key}`),
      writable: false,
    })
  }

  for (const method of ['dispose', 'onDispose'] as const) {
    Object.defineProperty(context, method, {
      configurable: false,
      value: context[method].bind(context),
      writable: false,
    })
  }
}
