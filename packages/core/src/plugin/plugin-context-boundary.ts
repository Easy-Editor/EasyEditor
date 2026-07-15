import {
  type LifecycleMutationTicket,
  assertLifecycleMutationTicket,
  captureLifecycleMutationTicket,
} from '../lifecycle/mutation-barrier'
import type { Disposable } from '../utils/hotkey'
import type { PluginContext } from './plugin-context'

export const pluginContextCapabilityKeys = [
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

// Package-private proof that an engine-owned object has already been reduced
// to a finite plugin capability. A WeakSet keeps the proof unforgeable by
// same-realm plugin code and avoids reopening every object with the same
// lifecycle owner.
const reviewedPluginContextCapabilities = new WeakSet<object>()

export function markReviewedPluginContextCapability(target: object): void {
  reviewedPluginContextCapabilities.add(target)
}

export function isReviewedPluginContextCapability(target: object): boolean {
  return reviewedPluginContextCapabilities.has(target)
}

const blockedCapabilityProperties = new Set<PropertyKey>([
  '__defineGetter__',
  '__defineSetter__',
  '__proto__',
  'constructor',
  'prototype',
])

const callbackArgumentIndexesByMethod = new Map<PropertyKey, readonly number[]>([
  ['acquireBinding', [1]],
  ['addListener', [1]],
  ['bind', [1]],
  ['every', [0]],
  ['filter', [0]],
  ['find', [0]],
  ['findIndex', [0]],
  ['findLast', [0]],
  ['findLastIndex', [0]],
  ['flatMap', [0]],
  ['forEach', [0]],
  ['getComponentMeta', [1]],
  ['map', [0]],
  ['off', [1]],
  ['on', [1]],
  ['onGot', [1]],
  ['onMetadataChange', [0]],
  ['prependListener', [1]],
  ['reduce', [0]],
  ['reduceRight', [0]],
  ['removeListener', [1]],
  ['some', [0]],
  ['sort', [0]],
  ['toSorted', [0]],
  ['unbind', [1]],
  ['waitPasteData', [1]],
])

const callbackThisPreservingMethods = new Set<PropertyKey>([
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'forEach',
  'map',
  'some',
])

interface LifecycleCapabilityBinderOptions {
  readonly isBlockedProperty?: (target: object, property: PropertyKey) => boolean
  readonly blockedPropertiesByTarget?: WeakMap<object, ReadonlySet<PropertyKey>>
}

interface PluginContextOperations {
  dispose(): void
  onDispose(disposer: Disposable): Disposable
}

const pluginContextOperations = new WeakMap<PluginContext, PluginContextOperations>()

const pluginContextBlockedTargetProperties = new WeakMap<PluginContext, WeakMap<object, ReadonlySet<PropertyKey>>>()

const pluginContextBlockedPropertyResolvers = new WeakMap<
  PluginContext,
  (target: object, property: PropertyKey) => boolean
>()

export function installPluginContextOperations(context: PluginContext, operations: PluginContextOperations): void {
  if (pluginContextOperations.has(context)) throw new Error('Plugin context operations are already installed')
  pluginContextOperations.set(context, operations)
}

export function blockPluginContextTargetProperties(
  context: PluginContext,
  target: object,
  properties: ReadonlySet<PropertyKey>,
): void {
  let blockedTargets = pluginContextBlockedTargetProperties.get(context)
  if (!blockedTargets) {
    blockedTargets = new WeakMap()
    pluginContextBlockedTargetProperties.set(context, blockedTargets)
  }
  blockedTargets.set(target, properties)
}

export function installPluginContextBlockedPropertyResolver(
  context: PluginContext,
  resolver: (target: object, property: PropertyKey) => boolean,
): void {
  if (pluginContextBlockedPropertyResolvers.has(context)) {
    throw new Error('Plugin context blocked-property resolver is already installed')
  }
  pluginContextBlockedPropertyResolvers.set(context, resolver)
}

const getPluginContextOperations = (context: PluginContext): PluginContextOperations => {
  const operations = pluginContextOperations.get(context)
  if (!operations) throw new Error('Plugin context operations are not installed')
  return operations
}

/** Internal teardown may unwrap a revocable disposer without lending it back to plugin code. */
export function unwrapPluginContextCapability<T>(value: T): T {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value
  return (capabilityProxyTargets.get(value as object) as T | undefined) || value
}

const isPromiseLike = (value: object): value is PromiseLike<unknown> => {
  return typeof (value as { then?: unknown }).then === 'function'
}

const createCapabilityFacadeTarget = (target: object, callable: boolean, preserveArrayIdentity: boolean): object => {
  if (callable) return function CapabilityFacade() {}.bind(undefined)
  if (Array.isArray(target) && preserveArrayIdentity) {
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
export function createLifecycleCapabilityBinder(
  owner: object,
  bindingOrigin: string,
  options: LifecycleCapabilityBinderOptions = {},
) {
  const ticket = captureLifecycleMutationTicket(owner, `${bindingOrigin}.bind`)
  const proxies = new WeakMap<object, object>()
  const methods = new WeakMap<object, Map<PropertyKey, (...args: unknown[]) => unknown>>()
  const callbackWrappersWithHiddenThis = new WeakMap<(...args: unknown[]) => unknown, (...args: unknown[]) => unknown>()
  const callbackWrappersWithWrappedThis = new WeakMap<
    (...args: unknown[]) => unknown,
    (...args: unknown[]) => unknown
  >()

  const assertActive = (origin: string): void => {
    assertLifecycleMutationTicket(owner, ticket, origin)
  }

  const isBlockedCapabilityProperty = (target: object, property: PropertyKey): boolean =>
    blockedCapabilityProperties.has(property) ||
    options.isBlockedProperty?.(target, property) === true ||
    options.blockedPropertiesByTarget?.get(target)?.has(property) === true

  const unwrap = <T>(value: T): T => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value
    return (capabilityProxyTargets.get(value as object) as T | undefined) || value
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
    const preserveArrayIdentity = Array.isArray(target) && !isBlockedCapabilityProperty(target, 'length')
    const proxyTarget = createCapabilityFacadeTarget(target, callable, preserveArrayIdentity)
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
      defineProperty(_innerTarget, _property, _descriptor) {
        assertActive(`${origin}.defineProperty`)
        return false
      },
      deleteProperty(_innerTarget, _property) {
        assertActive(`${origin}.deleteProperty`)
        return false
      },
      get(_innerTarget, property) {
        assertActive(`${origin}.get`)
        if (isBlockedCapabilityProperty(target, property)) return undefined
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
          const callbackIndexes = callbackArgumentIndexesByMethod.get(property)
          const hostArgs = args.map((argument, index) => {
            if (!callbackIndexes?.includes(index) || typeof argument !== 'function') return unwrap(argument)
            const callback = argument as (...args: unknown[]) => unknown
            const preserveCallbackThis = callbackThisPreservingMethods.has(property)
            const callbackWrappers = preserveCallbackThis
              ? callbackWrappersWithWrappedThis
              : callbackWrappersWithHiddenThis
            const existingCallback = callbackWrappers.get(callback)
            if (existingCallback) return existingCallback
            const guardedCallback = function (this: unknown, ...callbackArgs: unknown[]) {
              assertActive(`${origin}.${String(property)}.callback`)
              // Registration callbacks do not receive the host object's
              // implicit receiver. In particular, EventEmitter invokes
              // listeners with its private emitter as `this`. Native forEach
              // is the one supported exception because it has an explicit
              // caller-provided thisArg contract.
              const callbackThis = preserveCallbackThis
                ? wrap(this, `${origin}.${String(property)}.callback.this`)
                : undefined
              const wrappedArgs = callbackArgs.map((value, callbackIndex) =>
                wrap(value, `${origin}.${String(property)}.callback.${callbackIndex}`),
              )
              return Reflect.apply(callback, callbackThis, wrappedArgs)
            }
            callbackWrappers.set(callback, guardedCallback)
            return guardedCallback
          })
          return wrapResult(Reflect.apply(child, target, hostArgs), `${origin}.${String(property)}`)
        }
        targetMethods.set(property, guardedMethod)
        return guardedMethod
      },
      getOwnPropertyDescriptor(_innerTarget, property) {
        assertActive(`${origin}.getOwnPropertyDescriptor`)
        if (isBlockedCapabilityProperty(target, property)) return undefined
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
        return null
      },
      has(_innerTarget, property) {
        assertActive(`${origin}.has`)
        if (isBlockedCapabilityProperty(target, property)) return false
        return Reflect.has(target, property)
      },
      ownKeys() {
        assertActive(`${origin}.ownKeys`)
        return Reflect.ownKeys(target).filter(property => !isBlockedCapabilityProperty(target, property))
      },
      preventExtensions() {
        assertActive(`${origin}.preventExtensions`)
        return false
      },
      set(_innerTarget, _property, _child) {
        assertActive(`${origin}.set`)
        return false
      },
      setPrototypeOf(_innerTarget, _prototype) {
        assertActive(`${origin}.setPrototypeOf`)
        return false
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
  const blockedPropertiesByTarget =
    pluginContextBlockedTargetProperties.get(context) || new WeakMap<object, ReadonlySet<PropertyKey>>()
  const reviewedCapabilityRoots = new WeakSet<object>()
  for (const key of pluginContextCapabilityKeys) {
    const capability = context[key]
    if ((typeof capability === 'object' || typeof capability === 'function') && capability !== null) {
      reviewedCapabilityRoots.add(capability as object)
    }
  }
  if ((typeof context.engine === 'object' || typeof context.engine === 'function') && context.engine !== null) {
    blockedPropertiesByTarget.set(context.engine as object, new Set(['destroy', 'init']))
  }
  const blockedPropertyResolver = pluginContextBlockedPropertyResolvers.get(context)
  const bind = createLifecycleCapabilityBinder(context, 'pluginContext.capabilities', {
    blockedPropertiesByTarget,
    isBlockedProperty: (target, property) => {
      // The context roots were already reduced to explicit finite facades.
      // Ownership filtering applies to values crossing those facades, not to
      // the reviewed facade methods themselves.
      if (reviewedCapabilityRoots.has(target) || isReviewedPluginContextCapability(target)) return false
      return blockedPropertyResolver?.(target, property) === true
    },
  })
  for (const key of pluginContextCapabilityKeys) {
    const capability = context[key]
    Object.defineProperty(context, key, {
      configurable: false,
      enumerable: true,
      value: capability === undefined || key === 'pluginEvent' ? capability : bind(capability, `pluginContext.${key}`),
      writable: false,
    })
  }

  const operations = getPluginContextOperations(context)
  Object.defineProperties(context, {
    dispose: {
      configurable: false,
      value: () => operations.dispose(),
      writable: false,
    },
    onDispose: {
      configurable: false,
      value: (disposer: Disposable) => operations.onDispose(disposer),
      writable: false,
    },
  })
}
