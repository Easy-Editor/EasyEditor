import { action } from 'mobx'
import type { Component, Node } from '..'
import type { SettingField } from '../designer'
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
  settersMap = new Map<string, Setter & { type: string }>()

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
    if (typeof typeOrMaps === 'object') {
      Object.keys(typeOrMaps).forEach(type => {
        this.registerSetter(type, typeOrMaps[type])
      })
      return
    }

    if (!setter) {
      return
    }

    if (this.settersMap.has(typeOrMaps) && !option?.overwrite) {
      logger.error(`SetterManager register error! The setter (${setter.name}) has already been registered!`)
      return
    }

    // TODO: 暂时通过这样判断是 Setter 还是 Component
    if (!('component' in setter)) {
      setter = {
        component: setter,
        title: (setter as Component).displayName || (setter as Setter).name || typeOrMaps,
      }
    }

    if (!setter.initialValue) {
      const initial = getInitialFromSetter(setter.component)
      if (initial) {
        setter.initialValue = (field: any) => {
          return initial.call(field, field.getValue())
        }
      }
    }

    this.settersMap.set(typeOrMaps, { type: typeOrMaps, ...setter })
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
}

const getInitialFromSetter = (setter: any) => {
  return (
    (setter && (setter.initial || setter.Initial || (setter.type && (setter.type.initial || setter.type.Initial)))) ||
    null
  )
}
