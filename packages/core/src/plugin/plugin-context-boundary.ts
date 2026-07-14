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

const createCapabilityFacadeTarget = (target: object, callable: boolean): object => {
  if (callable) return function CapabilityFacade() {}.bind(undefined)
  if (Array.isArray(target)) {
    const facade: unknown[] = []
    // Preserve Array.isArray() without copying any capability-bearing values
    // onto the Proxy target. Array length stays writable on the facade so the
    // get trap may safely report the current source length.
    facade.length = target.length
    return facade
  }
  return Object.create(null) as object
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
      return Promise.resolve(result).then(
        resolved => {
          assertActive(`${origin}.complete`)
          return wrap(resolved, `${origin}.result`)
        },
        reason => {
          assertActive(`${origin}.reject`)
          throw wrap(reason, `${origin}.reason`)
        },
      ) as T
    }
    return wrap(result, `${origin}.result`)
  }

  const wrap = <T>(value: T, origin: string): T => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value
    const target = value as object
    const existing = proxies.get(target)
    if (existing) return existing as T

    if (typeof value === 'object' && isPromiseLike(value)) {
      const guardedPromise = wrapResult(value, origin) as T & object
      proxies.set(target, guardedPromise)
      capabilityProxyTargets.set(guardedPromise, target)
      return guardedPromise as T
    }

    const callable = typeof value === 'function'
    // Every capability uses a neutral facade target. Proxying the source
    // object directly forces non-configurable readonly data properties to
    // expose their raw value, which punches through the generation membrane.
    // Arrays retain their observable Array identity; callables retain their
    // callable/constructable shape without copying authority-bearing values.
    const proxyTarget = createCapabilityFacadeTarget(target, callable)
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
        if (descriptor.configurable !== true) return false
        return Reflect.defineProperty(target, property, descriptor)
      },
      deleteProperty(_innerTarget, property) {
        assertActive(`${origin}.deleteProperty`)
        return Reflect.deleteProperty(target, property)
      },
      get(_innerTarget, property) {
        assertActive(`${origin}.get`)
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
        const facadeDescriptor = Reflect.getOwnPropertyDescriptor(proxyTarget, property)
        if (facadeDescriptor?.configurable === false) {
          if ('value' in descriptor && 'value' in facadeDescriptor) {
            return { ...facadeDescriptor, value: descriptor.value }
          }
          return facadeDescriptor
        }
        if (!('value' in descriptor)) {
          return {
            ...descriptor,
            configurable: true,
            get: descriptor.get ? wrap(descriptor.get, `${origin}.${String(property)}.get`) : descriptor.get,
            set: descriptor.set ? wrap(descriptor.set, `${origin}.${String(property)}.set`) : descriptor.set,
          }
        }
        return {
          ...descriptor,
          configurable: true,
          value: wrap(descriptor.value, `${origin}.${String(property)}`),
        }
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
