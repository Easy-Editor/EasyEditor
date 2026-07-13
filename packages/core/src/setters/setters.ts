import { action } from 'mobx'
import type { SettingField } from '../designer'
import type { Node } from '../document/node/node'
import { assertLifecycleMutationAllowed } from '../lifecycle/mutation-barrier'
import { createMutationGuardedMapView } from '../lifecycle/mutation-guarded-map'
import { assertPublicLifecycleTeardownAllowed, installLifecycleTeardownOperation } from '../lifecycle/teardown-boundary'
import type { Component } from '../types/component'
import { createLogger } from '../utils'

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

interface RegisterSetterOption {
  overwrite?: boolean
}

export class Setters {
  private readonly registeredSetters = new Map<string, Setter & { type: string }>()

  readonly settersMap = createMutationGuardedMapView(this.registeredSetters, () =>
    assertLifecycleMutationAllowed(this, 'setters.map.mutate'),
  )

  constructor() {
    installLifecycleTeardownOperation(this, () => this.#disposeInternal())
  }

  getSetter(type: string) {
    return this.settersMap.get(type)
  }

  getSettersMap = () => {
    return this.settersMap
  }

  @action
  registerSetter(
    typeOrMaps: string | { [key: string]: Component | Setter },
    setter?: Component | Setter,
    option?: RegisterSetterOption,
  ) {
    assertLifecycleMutationAllowed(this, 'setters.registerSetter')
    if (typeof typeOrMaps === 'object') {
      const checkpoint = new Map(this.registeredSetters)
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
        this.registeredSetters.clear()
        for (const [type, registeredSetter] of checkpoint) this.registeredSetters.set(type, registeredSetter)
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

    if (this.settersMap.has(typeOrMaps) && !option?.overwrite) {
      logger.error(`SetterManager register error! The setter (${setter.name}) has already been registered!`)
      return
    }

    // TODO: 暂时通过这样判断是 Setter 还是 Component
    let normalizedSetter: Component | Setter
    if ('component' in setter) {
      normalizedSetter = { ...setter }
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

    this.registeredSetters.set(typeOrMaps, { type: typeOrMaps, ...normalizedSetter })
  }

  createSetterContent = (setter: any, props: Record<string, any>): Component => {
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
    this.registeredSetters.clear()
  }
}

const getInitialFromSetter = (setter: any) => {
  return (
    (setter && (setter.initial || setter.Initial || (setter.type && (setter.type.initial || setter.type.Initial)))) ||
    null
  )
}
