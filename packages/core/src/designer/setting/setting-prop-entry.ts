import { computed, observable, runInAction } from 'mobx'
import type { Node } from '../../document/node/node'
import { type PropKey, isJSExpression } from '../../document/prop/prop'
import {
  assertLifecycleMutationAllowed,
  inheritLifecycleMutationGuard,
  sealLifecycleMutations,
} from '../../lifecycle/mutation-barrier'
import { lockReadonlyProperties } from '../../lifecycle/readonly-properties'
import { inheritEngineTeardownOwnership, runInternalLifecycleTeardown } from '../../lifecycle/teardown-boundary'
import type { ComponentMeta } from '../../materials/component-meta'
import { withoutProjectMutationAuthority } from '../../project/mutation-authority'
import type { Setters } from '../../setters'
import type { Editor } from '../../types/editor'
import type { FieldExtraProps } from '../../types/meta'
import { type EventBus, createEventBus } from '../../utils/event-bus'
import { uniqueId } from '../../utils/unique-id'
import { DESIGNER_EVENT, type Designer } from '../designer'
import { createDesignerEventBus } from '../event-bus'
import type { SettingEntry } from './setting-entry'
import type { SetValueOptions, SettingField } from './setting-field'
import type { SettingTopEntry } from './setting-top-entry'

export class SettingPropEntry implements SettingEntry {
  readonly editor: Editor

  readonly isSameComponent: boolean

  readonly isMultiple: boolean

  readonly isSingle: boolean

  readonly setters: Setters

  readonly nodes: Node[]

  readonly componentMeta: ComponentMeta | null

  readonly designer: Designer | undefined

  readonly top: SettingTopEntry

  readonly isGroup: boolean

  readonly type: 'field' | 'group'

  readonly id = uniqueId('entry')

  readonly emitter: EventBus

  #entryPurged = false

  protected assertEntryMutationAllowed(origin: string): void {
    assertLifecycleMutationAllowed(this, origin)
  }

  protected purgeEntry(): void {
    if (!this.#entryPurged) {
      this.#entryPurged = true
      sealLifecycleMutations(this, 'setting field generation is disposed')
      sealLifecycleMutations(this.emitter, 'setting field event bus generation is disposed')
    }
    runInternalLifecycleTeardown(this.emitter)
  }

  @observable.ref accessor #name: PropKey | undefined

  get name() {
    return this.#name
  }

  @computed
  get path(): PropKey[] {
    const path = this.parent.path.slice()
    if (this.type === 'field' && this.name?.toString()) {
      path.push(this.name)
    }
    return path
  }

  extraProps: FieldExtraProps = {}

  constructor(
    readonly parent: SettingTopEntry | SettingField,
    name: PropKey | undefined,
    type?: 'field' | 'group',
  ) {
    inheritLifecycleMutationGuard(parent, this)
    if (type == null) {
      const c = typeof name === 'string' ? name.slice(0, 1) : ''
      if (c === '#') {
        this.type = 'group'
      } else {
        this.type = 'field'
      }
    } else {
      this.type = type
    }
    // initial self properties
    this.#name = name
    this.isGroup = this.type === 'group'

    // copy parent static properties
    this.editor = parent.editor
    this.nodes = parent.nodes
    this.setters = parent.setters
    this.componentMeta = parent.componentMeta
    this.isSameComponent = parent.isSameComponent
    this.isMultiple = parent.isMultiple
    this.isSingle = parent.isSingle
    this.designer = parent.designer
    this.emitter = this.designer
      ? createDesignerEventBus(this.designer, 'SettingPropEntry')
      : createEventBus('SettingPropEntry')
    if (this.designer) inheritEngineTeardownOwnership(this.designer, this.emitter)
    this.top = parent.top
    lockReadonlyProperties(this, [
      'componentMeta',
      'designer',
      'editor',
      'emitter',
      'id',
      'isGroup',
      'isMultiple',
      'isSameComponent',
      'isSingle',
      'nodes',
      'parent',
      'setters',
      'top',
      'type',
    ])
  }

  getId() {
    return this.id
  }

  setKey(key: PropKey) {
    this.assertEntryMutationAllowed('settingField.setKey')
    if (this.type !== 'field') {
      return
    }
    const propName = this.path.join('.')
    let l = this.nodes.length
    while (l-- > 0) {
      this.nodes[l].getProp(propName, true)!.key = key
    }
    this.#name = key
  }

  getKey() {
    return this.#name
  }

  remove() {
    this.assertEntryMutationAllowed('settingField.remove')
    if (this.type !== 'field') {
      return
    }
    const propName = this.path.join('.')
    let l = this.nodes.length
    while (l-- > 0) {
      this.nodes[l].getProp(propName)?.remove()
    }
  }

  // ====== 当前属性读写 =====

  /**
   * 判断当前属性值是否一致
   * -1 多种值
   * 0 无值
   * 1 类似值，比如数组长度一样
   * 2 单一植
   */
  /* istanbul ignore next */
  @computed get valueState(): number {
    return runInAction(() => {
      if (this.type !== 'field') {
        const { getValue } = this.extraProps
        return getValue
          ? withoutProjectMutationAuthority(this.getNode().document.project, () =>
              getValue(this as unknown as SettingField, undefined),
            ) === undefined
            ? 0
            : 1
          : 0
      }
      if (this.nodes.length === 1) {
        return 2
      }
      const propName = this.path.join('.')
      const first = this.nodes[0].getProp(propName)!
      let l = this.nodes.length
      let state = 2
      while (--l > 0) {
        const next = this.nodes[l].getProp(propName, false)
        const s = first.compare(next)
        if (s > 1) {
          return -1
        }
        if (s === 1) {
          state = 1
        }
      }
      if (state === 2 && first.isUnset()) {
        return 0
      }
      return state
    })
  }

  /**
   * 获取当前属性值
   */
  getValue(): any {
    let val: any
    if (this.type === 'field' && this.name?.toString()) {
      val = this.parent.getPropValue(this.name)
    }
    const { getValue } = this.extraProps
    try {
      return getValue
        ? withoutProjectMutationAuthority(this.getNode().document.project, () =>
            getValue(this as unknown as SettingField, val),
          )
        : val
    } catch (e) {
      console.warn(e)
      return val
    }
  }

  /**
   * 设置当前属性值
   */
  setValue(val: any, isHotValue?: boolean, extraOptions?: SetValueOptions) {
    this.assertEntryMutationAllowed('settingField.setValue')
    const oldValue = this.getValue()
    if (this.type === 'field') {
      this.name?.toString() && this.parent.setPropValue(this.name, val)
    }

    const { setValue } = this.extraProps
    if (setValue && !extraOptions?.disableMutator) {
      try {
        withoutProjectMutationAuthority(this.getNode().document.project, () =>
          setValue(this as unknown as SettingField, val, oldValue),
        )
      } catch (e) {
        /* istanbul ignore next */
        console.warn(e)
      }
    }
    this.notifyValueChange(oldValue, val)
  }

  /**
   * 清除已设置的值
   */
  clearValue() {
    this.assertEntryMutationAllowed('settingField.clearValue')
    if (this.type === 'field') {
      this.name?.toString() && this.parent.clearPropValue(this.name)
    }
    const { setValue } = this.extraProps
    if (setValue) {
      try {
        withoutProjectMutationAuthority(this.getNode().document.project, () =>
          setValue(this as unknown as SettingField, undefined),
        )
      } catch (e) {
        console.warn(e)
      }
    }
  }

  /**
   * 获取子项
   */
  get(propName: PropKey) {
    const path = this.path.concat(propName).join('.')
    return this.top.get(path)
  }

  /**
   * 设置子级属性值
   */
  setPropValue(propName: PropKey, value: any) {
    const path = this.path.concat(propName).join('.')
    this.top.setPropValue(path, value)
  }

  /**
   * 清除已设置值
   */
  clearPropValue(propName: PropKey) {
    const path = this.path.concat(propName).join('.')
    this.top.clearPropValue(path)
  }

  /**
   * 获取子级属性值
   */
  getPropValue(propName: PropKey): any {
    return this.top.getPropValue(this.path.concat(propName).join('.'))
  }

  /**
   * 获取顶层附属属性值
   */
  getExtraPropValue(propName: string) {
    return this.top.getExtraPropValue(propName)
  }

  /**
   * 设置顶层附属属性值
   */
  setExtraPropValue(propName: string, value: any) {
    this.assertEntryMutationAllowed('settingField.setExtraPropValue')
    this.top.setExtraPropValue(propName, value)
  }

  // ======= compatibles for vision ======
  getNode() {
    return this.nodes[0]
  }

  getName(): string {
    return this.path.join('.')
  }

  getProps() {
    return this.top
  }

  // add settingfield props
  get props() {
    return this.top
  }

  onValueChange(func: () => any) {
    this.assertEntryMutationAllowed('settingField.onValueChange')
    this.emitter.on('valuechange', func)

    return () => {
      this.emitter.off('valuechange', func)
    }
  }

  notifyValueChange(oldValue: any, newValue: any) {
    this.assertEntryMutationAllowed('settingField.notifyValueChange')
    this.designer?.postEvent(DESIGNER_EVENT.NODE_PROPS_CHANGE, {
      node: this.getNode(),
      prop: this,
      oldValue,
      newValue,
    })
  }

  getDefaultValue() {
    return this.extraProps.defaultValue
  }

  isIgnore() {
    return false
  }

  getVariableValue() {
    const v = this.getValue()
    if (isJSExpression(v)) {
      return v.value
    }
    return ''
  }

  setVariableValue(value: string) {
    const v = this.getValue()
    this.setValue({
      type: 'JSExpression',
      value,
      mock: isJSExpression(v) ? v.mock : v,
    })
  }

  setUseVariable(flag: boolean) {
    if (this.isUseVariable() === flag) {
      return
    }
    const v = this.getValue()
    if (this.isUseVariable()) {
      this.setValue(v.mock)
    } else {
      this.setValue({
        type: 'JSExpression',
        value: '',
        mock: v,
      })
    }
  }

  isUseVariable() {
    return isJSExpression(this.getValue())
  }

  get useVariable() {
    return this.isUseVariable()
  }

  getMockOrValue() {
    const v = this.getValue()
    if (isJSExpression(v)) {
      return v.mock
    }
    return v
  }
}
