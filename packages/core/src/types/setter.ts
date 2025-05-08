import type { SettingField, SettingPropEntry } from '../designer'
import type { Component } from './component'

// export type SetterType = SetterConfig | SetterConfig[] | string
export type SetterType = SetterConfig | string

export type DynamicSetterProps = (target: SettingField) => Record<string, unknown>

export interface SetterConfig {
  /**
   * the name of the setter
   */
  componentName: string

  /**
   * the props pass to Setter Component
   */
  props?: Record<string, unknown> | DynamicSetterProps

  /**
   * is required
   */
  isRequired?: boolean

  /**
   * Setter initial value
   */
  // initialValue?: any | ((target: SettingField) => any)

  /**
   * Setter default value
   */
  defaultValue?: any

  /**
   *  judge which one to be selected
   */
  // condition?: (target: SettingField) => boolean
}

export type DynamicSetter = (target: SettingPropEntry) => string | SetterConfig | Component
