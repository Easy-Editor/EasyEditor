import { action, computed, observable, untracked } from 'mobx'
import { isJSExpression } from '../../document/prop/prop'
import { lockReadonlyProperties } from '../../lifecycle/readonly-properties'
import { withoutProjectMutationAuthority } from '../../project/mutation-authority'
import type { FieldConfig, FieldExtraProps } from '../../types/meta'
import type { DynamicSetter, SetterType } from '../../types/setter'
import { cloneDeep } from '../../utils/common'
import { SettingPropEntry } from './setting-prop-entry'
import type { SettingTopEntry } from './setting-top-entry'

export interface SetValueOptions {
  disableMutator?: boolean
  type?: PropValueChangedType
  fromSetHotValue?: boolean
  forceHotValue?: boolean
}

export enum PropValueChangedType {
  /**
   * normal set value
   */
  SET_VALUE = 'SET_VALUE',
  /**
   * value changed caused by sub-prop value change
   */
  SUB_VALUE_CHANGE = 'SUB_VALUE_CHANGE',
}

function getSettingFieldCollectorKey(parent: SettingTopEntry | SettingField, config: FieldConfig) {
  let cur = parent
  const path = [config.name]
  while (cur !== parent.top) {
    if (cur instanceof SettingField && cur.type !== 'group') {
      path.unshift(cur.name)
    }
    cur = cur.parent
  }
  return path.join('.')
}

export class SettingField extends SettingPropEntry {
  readonly isSettingField = true

  readonly isRequired: boolean

  #config: FieldConfig

  #hotValue: any

  extraProps: FieldExtraProps

  #title?: string

  get title() {
    return this.#title || this.name
  }

  #setter?: SetterType | DynamicSetter

  @observable.ref accessor #expanded = true

  #items: SettingField[] = []

  readonly #settingFieldCollector?: (name: string, field: SettingField) => void

  readonly #settingFieldOwner?: (field: SettingField) => void

  constructor(
    parent: SettingTopEntry | SettingField,
    config: FieldConfig,
    settingFieldCollector?: (name: string, field: SettingField) => void,
    settingFieldOwner?: (field: SettingField) => void,
  ) {
    super(parent, config.name, config.type)
    this.#settingFieldCollector = settingFieldCollector
    this.#settingFieldOwner = settingFieldOwner
    this.#settingFieldOwner?.(this)
    const { title, items, setter, extraProps, ...rest } = config
    this.#config = Object.freeze({ ...config })
    this.#title = title
    this.#setter = setter
    this.extraProps = Object.freeze({
      ...rest,
      ...extraProps,
    })
    this.isRequired = !extraProps?.isRequired || (setter as any)?.isRequired
    this.#expanded = !extraProps?.defaultCollapsed
    lockReadonlyProperties(this, ['extraProps', 'isRequired'])

    // initial items
    if (items && items.length > 0) {
      this.#initItems(items, settingFieldCollector, settingFieldOwner)
    }
    if (this.type !== 'group' && settingFieldCollector && config.name) {
      settingFieldCollector(getSettingFieldCollectorKey(parent, config), this)
    }
  }

  @computed
  get setter(): SetterType | null {
    if (!this.#setter) {
      return null
    }
    if (isDynamicSetter(this.#setter)) {
      return untracked(() => {
        return withoutProjectMutationAuthority(this.getNode().document.project, () =>
          (this.#setter as DynamicSetter)?.call(this, this),
        )
      })
    }
    return this.#setter
  }

  get expanded(): boolean {
    return this.#expanded
  }

  setExpanded(value: boolean) {
    this.assertEntryMutationAllowed('settingField.setExpanded')
    this.#expanded = value
  }

  get items(): SettingField[] {
    return Object.freeze(this.#items.slice()) as SettingField[]
  }

  get config(): FieldConfig {
    return this.#config
  }

  #initItems(
    items: FieldConfig[],
    settingFieldCollector?: (name: string, field: SettingField) => void,
    settingFieldOwner?: (field: SettingField) => void,
  ) {
    this.#items = items.map(item => new SettingField(this, item, settingFieldCollector, settingFieldOwner))
  }

  #disposeItems() {
    this.#items.forEach(item => isSettingField(item) && item.purge())
    this.#items = []
  }

  createField(config: FieldConfig) {
    this.assertEntryMutationAllowed('settingField.createField')
    return new SettingField(this, config, this.#settingFieldCollector, this.#settingFieldOwner)
  }

  purge() {
    this.#disposeItems()
    this.purgeEntry()
  }

  // ======= compatibles for vision ======
  getConfig<K extends keyof FieldConfig>(configName?: K): FieldConfig[K] | FieldConfig {
    if (configName) {
      return this.config[configName]
    }
    return this.#config
  }

  getItems(filter?: (item: SettingField) => boolean): SettingField[] {
    return Object.freeze(
      this.#items.filter(item => {
        if (filter) {
          return withoutProjectMutationAuthority(this.getNode().document.project, () => filter(item))
        }
        return true
      }),
    ) as SettingField[]
  }

  @action
  setValue(val: any, isHotValue?: boolean, extraOptions?: SetValueOptions) {
    this.assertEntryMutationAllowed('settingField.setValue')
    if (isHotValue) {
      this.setHotValue(val, extraOptions)
      return
    }
    super.setValue(val, isHotValue, extraOptions)
  }

  clearValue() {
    this.assertEntryMutationAllowed('settingField.clearValue')
    this.#hotValue = null
    super.clearValue()
  }

  getHotValue(): any {
    if (this.#hotValue) {
      return this.#hotValue
    }
    // avoid View modify
    let v = cloneDeep(this.getMockOrValue())
    if (v == null) {
      v = this.extraProps.defaultValue
    }
    return v
  }

  @action
  setHotValue(data: any, options?: SetValueOptions) {
    this.assertEntryMutationAllowed('settingField.setHotValue')
    this.#hotValue = data
    const value = data
    if (options) {
      options.fromSetHotValue = true
      options.forceHotValue = true
    } else {
      options = { fromSetHotValue: true, forceHotValue: true }
    }
    if (this.isUseVariable() || options?.forceHotValue) {
      const oldValue = this.getValue() || {}
      if (isJSExpression(value)) {
        this.setValue(
          {
            type: 'JSExpression',
            value: value.value,
            mock: oldValue.mock,
          },
          false,
          options,
        )
      } else {
        this.setValue(
          {
            type: 'JSExpression',
            value: oldValue.value,
            mock: value,
          },
          false,
          options,
        )
      }
    } else {
      this.setValue(value, false, options)
    }
  }
}

export const isSettingField = (obj: any): obj is SettingField => obj && obj.isSettingField

export const isDynamicSetter = (obj: any): obj is DynamicSetter => typeof obj === 'function'
