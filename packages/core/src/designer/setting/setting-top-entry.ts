import {
  type ComponentMeta,
  DESIGNER_EVENT,
  type Designer,
  type Editor,
  type Node,
  type PropKey,
  type SetterManager,
  createEventBus,
} from '../..'
import type { SettingEntry } from './setting-entry'
import { SettingField } from './setting-field'

export const generateSessionId = (nodes: Node[]) => {
  return nodes
    .map(node => node.id)
    .sort()
    .join(',')
}

export class SettingTopEntry implements SettingEntry {
  private emitter = createEventBus('SettingTopEntry')

  private _items: SettingField[] = []

  private _componentMeta: ComponentMeta | null = null

  private _isSame = true

  private _settingFieldMap: Record<string, SettingField> = {}

  readonly path = []

  readonly top = this

  readonly parent = this

  get componentMeta() {
    return this._componentMeta
  }

  get items() {
    return this._items
  }

  /**
   * 同样的
   */
  get isSameComponent(): boolean {
    return this._isSame
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

  /**
   * 多个
   */
  get isMultiple(): boolean {
    return this.nodes.length > 1
  }

  readonly id: string

  readonly first: Node

  readonly designer: Designer | undefined

  readonly setters: SetterManager

  disposeFunctions: any[] = []

  constructor(
    readonly editor: Editor,
    readonly nodes: Node[],
  ) {
    if (!Array.isArray(nodes) || nodes.length < 1) {
      throw new ReferenceError('nodes should not be empty')
    }
    this.id = generateSessionId(nodes)
    this.first = nodes[0]
    this.designer = this.first.document?.designer
    this.setters = editor.get<SetterManager>('setterManager')!

    // setups
    this.setupComponentMeta()

    // clear fields
    this.setupItems()

    this.disposeFunctions.push(this.setupEvents())
  }

  private setupComponentMeta() {
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
      this._isSame = true
      this._componentMeta = meta
    } else {
      this._isSame = false
      this._componentMeta = null
    }
  }

  private setupItems() {
    if (this.componentMeta) {
      const settingFieldMap: Record<string, SettingField> = {}
      const settingFieldCollector = (name: string | number, field: SettingField) => {
        settingFieldMap[name] = field
      }
      this._items = this.componentMeta.configure.map(item => {
        return new SettingField(this, item as any, settingFieldCollector)
      })
      this._settingFieldMap = settingFieldMap
    }
  }

  private setupEvents() {
    return this.componentMeta?.onMetadataChange(() => {
      this.setupItems()
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
    this.setProps(val)

    this.emitter.emit(DESIGNER_EVENT.SETTING_TOP_ENTRY_VALUE_CHANGE, val)
  }

  /**
   * 获取子项
   */
  get(propName: PropKey): SettingField | null {
    if (!propName) return null
    return this._settingFieldMap[propName] || new SettingField(this, { name: propName })
  }

  /**
   * 设置子级属性值
   */
  setPropValue(propName: PropKey, value: any) {
    this.nodes.forEach(node => {
      node.setPropValue(propName.toString(), value)
    })
  }

  /**
   * 清除已设置值
   */
  clearPropValue(propName: PropKey) {
    this.nodes.forEach(node => {
      node.clearPropValue(propName.toString())
    })
  }

  /**
   * 获取子级属性值
   */
  getPropValue(propName: PropKey): any {
    return this.first.getProp(propName.toString(), true)?.getValue()
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
    this.nodes.forEach(node => {
      node.getExtraProp(propName, true)?.setValue(value)
    })
  }

  // 设置多个属性值，替换原有值
  setProps(data: object) {
    this.nodes.forEach(node => {
      node.setProps(data as any)
    })
  }

  // 设置多个属性值，和原有值合并
  mergeProps(data: object) {
    this.nodes.forEach(node => {
      node.mergeProps(data as any)
    })
  }

  private disposeItems() {
    this._items.forEach(item => isPurgeable(item) && item.purge())
    this._items = []
  }

  purge() {
    this.disposeItems()
    this._settingFieldMap = {}
    // this.emitter.removeAllListeners()
    this.disposeFunctions.forEach(f => f())
    this.disposeFunctions = []
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
