import { action, computed, observable, untracked } from 'mobx'
import { cloneDeep, isJSExpression } from '../..'
import type { DynamicSetter, FieldConfig, FieldExtraProps, SetterType } from '../component-meta'
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

  private _config: FieldConfig

  private hotValue: any

  parent: SettingTopEntry | SettingField

  extraProps: FieldExtraProps

  private _title?: string

  get title() {
    return this._title || this.name
  }

  private _setter?: SetterType | DynamicSetter

  @observable.ref private accessor _expanded = true

  private _items: SettingField[] = []

  constructor(
    parent: SettingTopEntry | SettingField,
    config: FieldConfig,
    private settingFieldCollector?: (name: string, field: SettingField) => void,
  ) {
    super(parent, config.name, config.type)
    const { title, items, setter, extraProps, ...rest } = config
    this.parent = parent
    this._config = config
    this._title = title
    this._setter = setter
    this.extraProps = {
      ...rest,
      ...extraProps,
    }
    this.isRequired = !extraProps?.isRequired || (setter as any)?.isRequired
    this._expanded = !extraProps?.defaultCollapsed

    // initial items
    if (items && items.length > 0) {
      this.initItems(items, settingFieldCollector)
    }
    if (this.type !== 'group' && settingFieldCollector && config.name) {
      settingFieldCollector(getSettingFieldCollectorKey(parent, config), this)
    }
  }

  @computed
  get setter(): SetterType | null {
    if (!this._setter) {
      return null
    }
    if (isDynamicSetter(this._setter)) {
      return untracked(() => {
        return (this._setter as DynamicSetter)?.call(this, this)
      })
    }
    return this._setter
  }

  get expanded(): boolean {
    return this._expanded
  }

  setExpanded(value: boolean) {
    this._expanded = value
  }

  get items(): SettingField[] {
    return this._items
  }

  get config(): FieldConfig {
    return this._config
  }

  private initItems(items: FieldConfig[], settingFieldCollector?: (name: string, field: SettingField) => void) {
    this._items = items.map(item => new SettingField(this, item, settingFieldCollector))
  }

  private disposeItems() {
    this._items.forEach(item => isSettingField(item) && item.purge())
    this._items = []
  }

  createField(config: FieldConfig) {
    this.settingFieldCollector?.(getSettingFieldCollectorKey(this.parent, config), this)
    return new SettingField(this, config, this.settingFieldCollector)
  }

  purge() {
    this.disposeItems()
  }

  // ======= compatibles for vision ======
  getConfig<K extends keyof FieldConfig>(configName?: K): FieldConfig[K] | FieldConfig {
    if (configName) {
      return this.config[configName]
    }
    return this._config
  }

  getItems(filter?: (item: SettingField) => boolean): SettingField[] {
    return this._items.filter(item => {
      if (filter) {
        return filter(item)
      }
      return true
    })
  }

  @action
  setValue(val: any, isHotValue?: boolean, extraOptions?: SetValueOptions) {
    if (isHotValue) {
      this.setHotValue(val, extraOptions)
      return
    }
    super.setValue(val, isHotValue, extraOptions)
  }

  clearValue() {
    this.hotValue = null
    super.clearValue()
  }

  getHotValue(): any {
    if (this.hotValue) {
      return this.hotValue
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
    this.hotValue = data
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
