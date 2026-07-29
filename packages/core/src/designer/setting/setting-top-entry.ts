import type { Node } from '../../document/node/node'
import type { PropKey } from '../../document/prop/prop'
import {
  assertLifecycleMutationAllowed,
  inheritLifecycleMutationGuard,
  sealLifecycleMutations,
} from '../../lifecycle/mutation-barrier'
import { lockReadonlyProperties } from '../../lifecycle/readonly-properties'
import { inheritEngineTeardownOwnership, runInternalLifecycleTeardown } from '../../lifecycle/teardown-boundary'
import type { ComponentMeta } from '../../materials/component-meta'
import { withoutProjectMutationAuthority } from '../../project/mutation-authority'
import type { Setters } from '../../setters/setters'
import type { Editor } from '../../types/editor'
import { type EventBus, createEventBus } from '../../utils/event-bus'
import { DESIGNER_EVENT, type Designer } from '../designer'
import { createDesignerEventBus } from '../event-bus'
import type { SettingEntry } from './setting-entry'
import { SettingField } from './setting-field'
import { installSettingTopEntryDisposerBoundary } from './setting-top-entry-boundary'

export const generateSessionId = (nodes: Node[]) => {
  return nodes
    .map(node => node.id)
    .sort()
    .join(',')
}

export class SettingTopEntry implements SettingEntry {
  #emitter: EventBus

  #purged = false

  readonly #ownedFields = new Set<SettingField>()

  readonly #ownField = (field: SettingField): void => {
    this.#ownedFields.add(field)
  }

  #assertEntryMutationAllowed(origin: string): void {
    assertLifecycleMutationAllowed(this, origin)
  }

  #items: SettingField[] = []

  #componentMeta: ComponentMeta | null = null

  #isSame = true

  #settingFieldMap: Record<string, SettingField> = {}

  #disposeFunctions: (() => void)[] = []

  readonly path = Object.freeze([]) as []

  readonly top = this

  readonly parent = this

  get componentMeta() {
    return this.#componentMeta
  }

  get items() {
    return Object.freeze(this.#items.slice())
  }

  /**
   * 同样的
   */
  get isSameComponent(): boolean {
    return this.#isSame
  }

  /**
   * 一个
   */
  get isSingle(): boolean {
    return this.nodes.length === 1
  }

  get isLocked(): boolean {
    return this.first.locked
  }

  get isHidden(): boolean {
    return this.first.hidden
  }

  /**
   * 多个
   */
  get isMultiple(): boolean {
    return this.nodes.length > 1
  }

  readonly id: string

  readonly first: Node

  readonly designer: Designer | undefined

  readonly setters: Setters

  readonly editor: Editor

  readonly nodes: Node[]

  constructor(editor: Editor, nodes: Node[]) {
    if (!Array.isArray(nodes) || nodes.length < 1) {
      throw new ReferenceError('nodes should not be empty')
    }
    this.editor = editor
    this.nodes = Object.freeze(nodes.slice()) as Node[]
    this.id = generateSessionId(nodes)
    this.first = this.nodes[0]
    inheritLifecycleMutationGuard(this.first, this)
    this.designer = this.first.document?.designer
    this.#emitter = this.designer
      ? createDesignerEventBus(this.designer, 'SettingTopEntry')
      : createEventBus('SettingTopEntry')
    if (this.designer) inheritEngineTeardownOwnership(this.designer, this.#emitter)
    this.setters = editor.get<Setters>('setterManager')!
    lockReadonlyProperties(this, ['designer', 'editor', 'first', 'id', 'nodes', 'parent', 'path', 'setters', 'top'])
    installSettingTopEntryDisposerBoundary(this, dispose => this.#disposeFunctions.push(dispose))

    // setups
    this.#setupComponentMeta()

    // clear fields
    this.#setupItems()

    const disposeEvents = this.#setupEvents()
    if (disposeEvents) this.#disposeFunctions.push(disposeEvents)
  }

  #setupComponentMeta() {
    // todo: enhance compile a temp configure.compiled
    const { first } = this
    const meta = first.componentMeta
    const l = this.nodes.length
    let theSame = true
    for (let i = 1; i < l; i++) {
      const other = this.nodes[i]
      if (other.componentMeta !== meta) {
        theSame = false
        break
      }
    }
    if (theSame) {
      this.#isSame = true
      this.#componentMeta = meta
    } else {
      this.#isSame = false
      this.#componentMeta = null
    }
  }

  #setupItems() {
    this.#disposeItems()
    if (this.componentMeta) {
      const settingFieldMap: Record<string, SettingField> = {}
      const settingFieldCollector = (name: string | number, field: SettingField) => {
        settingFieldMap[name] = field
      }
      this.#items = this.componentMeta.configure.map(item => {
        return new SettingField(this, item as any, settingFieldCollector, this.#ownField)
      })
      this.#settingFieldMap = settingFieldMap
    }
  }

  #setupEvents() {
    return this.componentMeta?.onMetadataChange(() => {
      this.#setupItems()
    })
  }

  /**
   * 获取当前属性值
   */
  getValue() {
    return this.first?.propsData
  }

  /**
   * 设置当前属性值
   */
  setValue(val: any) {
    this.#assertEntryMutationAllowed('settingEntry.setValue')
    this.setProps(val)

    this.#emitter.emit(DESIGNER_EVENT.SETTING_TOP_ENTRY_VALUE_CHANGE, val)
  }

  /**
   * 获取子项
   */
  get(propName: PropKey): SettingField | null {
    this.#assertEntryMutationAllowed('settingEntry.get')
    if (!propName) return null
    return this.#settingFieldMap[propName] || new SettingField(this, { name: propName }, undefined, this.#ownField)
  }

  /**
   * 设置子级属性值
   */
  setPropValue(propName: PropKey, value: any) {
    this.#assertEntryMutationAllowed('settingEntry.setPropValue')
    this.nodes.forEach(node => {
      node.setPropValue(propName.toString(), value)
    })
  }

  /**
   * 清除已设置值
   */
  clearPropValue(propName: PropKey) {
    this.#assertEntryMutationAllowed('settingEntry.clearPropValue')
    this.nodes.forEach(node => {
      node.clearPropValue(propName.toString())
    })
  }

  /**
   * 获取子级属性值
   */
  getPropValue(propName: PropKey): any {
    return this.first.getProp(propName.toString(), false)?.getValue()
  }

  /**
   * 获取顶层附属属性值
   */
  getExtraPropValue(propName: string) {
    return this.first.getExtraProp(propName, false)?.getValue()
  }

  /**
   * 设置顶层附属属性值
   */
  setExtraPropValue(propName: string, value: any) {
    this.#assertEntryMutationAllowed('settingEntry.setExtraPropValue')
    this.nodes.forEach(node => {
      node.getExtraProp(propName, true)?.setValue(value)
    })
  }

  // 设置多个属性值，替换原有值
  setProps(data: object) {
    this.#assertEntryMutationAllowed('settingEntry.setProps')
    this.nodes.forEach(node => {
      node.setProps(data as any)
    })
  }

  // 设置多个属性值，和原有值合并
  mergeProps(data: object) {
    this.#assertEntryMutationAllowed('settingEntry.mergeProps')
    this.nodes.forEach(node => {
      node.mergeProps(data as any)
    })
  }

  #disposeItems() {
    const errors: unknown[] = []
    for (const field of [...this.#ownedFields].reverse()) {
      try {
        field.purge()
        this.#ownedFields.delete(field)
      } catch (error) {
        errors.push(error)
      }
    }
    this.#items = []
    if (errors.length) throw new AggregateError(errors, 'Setting fields disposal completed with errors')
  }

  purge() {
    const errors: unknown[] = []
    try {
      this.#disposeItems()
    } catch (error) {
      errors.push(error)
    }
    this.#settingFieldMap = {}
    const failedDisposers: (() => void)[] = []
    for (const dispose of this.#disposeFunctions.splice(0).reverse()) {
      try {
        withoutProjectMutationAuthority(this.first.document.project, dispose)
      } catch (error) {
        errors.push(error)
        failedDisposers.unshift(dispose)
      }
    }
    this.#disposeFunctions = failedDisposers
    if (!this.#purged) {
      this.#purged = true
      sealLifecycleMutations(this, 'setting entry generation is disposed')
      sealLifecycleMutations(this.#emitter, 'setting entry event bus generation is disposed')
    }
    try {
      runInternalLifecycleTeardown(this.#emitter)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw new AggregateError(errors, 'Setting entry disposal completed with errors')
  }

  getProp(propName: PropKey) {
    return this.get(propName)
  }

  getNode() {
    return this.nodes[0]
  }
}

interface Purgeable {
  purge(): void
}

export const isPurgeable = (obj: any): obj is Purgeable => {
  return obj && obj.purge
}
