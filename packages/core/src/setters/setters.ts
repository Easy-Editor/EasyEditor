import { action } from 'mobx'
import type { SettingField } from '../designer'
import type { Node } from '../document/node/node'
import { assertLifecycleMutationAllowed } from '../lifecycle/mutation-barrier'
import { assertPublicLifecycleTeardownAllowed, installLifecycleTeardownOperation } from '../lifecycle/teardown-boundary'
import type { Component } from '../types/component'
import { createLogger, isPlainObject } from '../utils'

const logger = createLogger('Setters')

/**
 * for setter component props
 */
export interface SetterProps<T = unknown> {
  field: SettingField
  selected: Node
  initialValue?: T
  value: T
  onChange: (val: T) => void
  onInitial: () => void
  removeProp: () => void
}

export interface Setter {
  component: Component
  defaultProps?: object
  name?: string
}

export interface RegisteredSetter {
  readonly component: Component
  readonly defaultProps?: object
  readonly name?: string
  readonly type: string
  readonly [key: string]: unknown
}

interface SetterContent {
  component: Component | null | undefined
  props: Record<string, any>
}

interface RegisterSetterOption {
  overwrite?: boolean
}

type MutableSetterRecord = Record<PropertyKey, unknown> & { component: Component }

const readonlyMapError = (): never => {
  throw new TypeError('Setters map is read-only; use setters.registerSetter(...) to register values')
}

/**
 * Preserve the familiar Map read surface without exposing the Map that owns
 * runtime registrations. In particular, borrowed native Map mutation methods
 * cannot reach the backing Map because the facade itself has no Map slots.
 */
const createReadonlySettersMap = (backing: Map<string, RegisteredSetter>): ReadonlyMap<string, RegisteredSetter> => {
  const facade = new Proxy(backing, {
    get(target, property) {
      if (property === 'set' || property === 'delete' || property === 'clear') return readonlyMapError
      if (property === 'forEach') {
        return (
          callback: (value: RegisteredSetter, key: string, map: Map<string, RegisteredSetter>) => void,
          thisArg?: unknown,
        ) => {
          target.forEach((value, key) => callback.call(thisArg, value, key, facade))
        }
      }
      if (property === 'size') return target.size
      if (property === 'valueOf') return () => facade
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
      return Reflect.get(target, property, target)
    },
    defineProperty: readonlyMapError,
    deleteProperty: readonlyMapError,
    preventExtensions: readonlyMapError,
    set: readonlyMapError,
    setPrototypeOf: readonlyMapError,
  })
  return facade
}

const cloneAndFreezePlainSetterData = <T>(value: T, path: string, visited = new Map<object, unknown>()): T => {
  if (!value || typeof value !== 'object') return value
  if (visited.has(value)) return visited.get(value) as T

  let clone: Record<PropertyKey, unknown> | unknown[]
  if (Array.isArray(value)) {
    clone = new Array(value.length)
  } else if (isPlainObject(value)) {
    clone = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>
  } else {
    // Non-plain values are capability leaves. Only plain setter data is part
    // of the owned, immutable registry snapshot.
    return value
  }

  visited.set(value, clone)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable) continue
    if (!('value' in descriptor)) {
      throw new TypeError(`Setter data at ${path}.${String(key)} must be a data property`)
    }
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: cloneAndFreezePlainSetterData(descriptor.value, `${path}.${String(key)}`, visited),
      writable: true,
    })
  }
  return Object.freeze(clone) as T
}

const copySetterRecord = (type: string, setter: Setter): MutableSetterRecord => {
  const componentDescriptor = Object.getOwnPropertyDescriptor(setter, 'component')
  if (!componentDescriptor || !('value' in componentDescriptor)) {
    throw new TypeError(`Setter ${type} component must be an own data property`)
  }

  const normalized = { component: componentDescriptor.value } as MutableSetterRecord
  for (const key of Reflect.ownKeys(setter)) {
    if (key === 'component' || key === 'type') continue
    const descriptor = Object.getOwnPropertyDescriptor(setter, key)
    if (!descriptor?.enumerable) continue
    if (!('value' in descriptor)) {
      throw new TypeError(`Setter ${type} property ${String(key)} must be a data property`)
    }
    Object.defineProperty(normalized, key, {
      configurable: true,
      enumerable: true,
      value: cloneAndFreezePlainSetterData(descriptor.value, `setter.${type}.${String(key)}`),
      writable: true,
    })
  }
  return normalized
}

export class Setters {
  readonly #registeredSetters = new Map<string, RegisteredSetter>()

  readonly #settersMap = createReadonlySettersMap(this.#registeredSetters)

  readonly settersMap: ReadonlyMap<string, RegisteredSetter>

  readonly getSettersMap: () => ReadonlyMap<string, RegisteredSetter>

  constructor() {
    Object.defineProperties(this, {
      getSettersMap: {
        configurable: false,
        enumerable: true,
        value: () => this.#settersMap,
        writable: false,
      },
      settersMap: {
        configurable: false,
        enumerable: true,
        value: this.#settersMap,
        writable: false,
      },
    })
    installLifecycleTeardownOperation(this, () => this.#disposeInternal())
  }

  getSetter(type: string) {
    return this.#registeredSetters.get(type)
  }

  @action
  registerSetter(
    typeOrMaps: string | { [key: string]: Component | Setter },
    setter?: Component | Setter,
    option?: RegisterSetterOption,
  ) {
    assertLifecycleMutationAllowed(this, 'setters.registerSetter')
    if (typeof typeOrMaps === 'object') {
      const checkpoint = new Map(this.#registeredSetters)
      const descriptors = Object.getOwnPropertyDescriptors(typeOrMaps)
      try {
        for (const type of Object.keys(typeOrMaps)) {
          const descriptor = descriptors[type]
          if (!descriptor || !('value' in descriptor)) {
            throw new TypeError(`Setter map entry ${type} must be a data property`)
          }
          this.registerSetter(type, descriptor.value)
        }
      } catch (error) {
        this.#registeredSetters.clear()
        for (const [type, registeredSetter] of checkpoint) this.#registeredSetters.set(type, registeredSetter)
        throw error
      }
      return
    }

    if (!setter) {
      return
    }

    if (typeof setter !== 'object' && typeof setter !== 'function') {
      throw new TypeError(`Setter ${typeOrMaps} must be a component or setter object`)
    }

    if (this.#registeredSetters.has(typeOrMaps) && !option?.overwrite) {
      logger.error(`SetterManager register error! The setter (${setter.name}) has already been registered!`)
      return
    }

    // TODO: 暂时通过这样判断是 Setter 还是 Component
    let normalizedSetter: MutableSetterRecord
    if (Object.prototype.hasOwnProperty.call(setter, 'component')) {
      normalizedSetter = copySetterRecord(typeOrMaps, setter as Setter)
    } else {
      normalizedSetter = {
        component: setter,
        title: (setter as Component).displayName || (setter as Setter).name || typeOrMaps,
      }
    }

    if (!normalizedSetter.initialValue) {
      const initial = getInitialFromSetter(normalizedSetter.component)
      if (initial) {
        normalizedSetter.initialValue = (field: any) => {
          return initial.call(field, field.getValue())
        }
      }
    }

    this.#registeredSetters.set(typeOrMaps, Object.freeze({ ...normalizedSetter, type: typeOrMaps }))
  }

  createSetterContent = (setter: any, props: Record<string, any>): SetterContent | null => {
    if (typeof setter === 'string') {
      setter = this.getSetter(setter)
      if (!setter) {
        return null
      }
      if (setter.defaultProps) {
        props = {
          ...setter.defaultProps,
          ...props,
        }
      }
      setter = setter.component
    }

    return {
      component: setter,
      props,
    }
  }

  dispose(): void {
    assertPublicLifecycleTeardownAllowed(this, 'setters.dispose')
    this.#disposeInternal()
  }

  #disposeInternal(): void {
    this.#registeredSetters.clear()
  }
}

const getInitialFromSetter = (setter: any) => {
  return (
    (setter && (setter.initial || setter.Initial || (setter.type && (setter.type.initial || setter.type.Initial)))) ||
    null
  )
}
