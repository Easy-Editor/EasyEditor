import type { Component } from './meta'

import { action } from 'mobx'
import { logger } from '../utils'

/** for setter component props */
export interface SetterProps<T = unknown> {
  value: T
  onChange: (val: T) => void
}

export interface Setter {
  component: Component
  defaultProps?: object
  name?: string
}

interface RegisterSetterOption {
  overwrite?: boolean
}

export class SetterManager {
  private _settersMap = new Map<
    string,
    Setter & {
      type: string
    }
  >()

  get settersMap() {
    return this._settersMap
  }

  getSetter(type: string) {
    return this._settersMap.get(type)
  }

  buildSettersMap = (setters: Record<string, Setter>) => {
    Object.keys(setters).forEach(type => {
      this.registerSetter(type, setters[type])
    })
  }

  @action
  registerSetter(type: string, setter: Component | Setter, option?: RegisterSetterOption) {
    if (this._settersMap.has(type) && !option?.overwrite) {
      logger.error(`SetterManager register error! The setter (${setter.name}) has already been registered!`)
      return
    }

    const newSetter = {
      component: setter,
      title: (setter as Component).displayName || (setter as Setter).name || type,
    }
    this._settersMap.set(type, { type, ...newSetter })
  }
}
