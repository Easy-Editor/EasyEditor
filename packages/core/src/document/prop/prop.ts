import { action, computed, isObservableArray, observable, set, untracked } from 'mobx'
import { DESIGNER_EVENT } from '../../designer'
import {
  assertLifecycleMutationAllowed,
  inheritLifecycleMutationGuard,
  sealLifecycleMutations,
} from '../../lifecycle/mutation-barrier'
import { lockPrototypeAccessors, lockReadonlyProperties } from '../../lifecycle/readonly-properties'
import {
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../../lifecycle/teardown-boundary'
import { withoutProjectMutationAuthority } from '../../project/mutation-authority'
import { type NodeSchema, TRANSFORM_STAGE } from '../../types'
import { isObject, isPlainObject, uniqueId } from '../../utils'
import type { Node } from '../node/node'
import { type Props, getConvertedExtraKey } from './props'
import { valueToSource } from './value-to-source'

export const UNSET = Symbol.for('unset')
export type UNSET = typeof UNSET

// TODO: slot
export type ValueTypes = 'unset' | 'literal' | 'list' | 'map' | 'expression'

/**
 * a common interface for Prop and Props
 */
export interface PropParent {
  readonly props: Props

  readonly owner: Node

  get path(): string[]

  delete(prop: Prop): void
}

export type PropKey = string | number

export type PropValue = CompositeValue

export type PropsMap = CompositeObject<NodeSchema | NodeSchema[]>

export type CompositeValue = JSONValue | CompositeArray | CompositeObject | JSExpression | JSFunction

export type CompositeArray = CompositeValue[]

export interface CompositeObject<T = CompositeValue> {
  [key: PropKey]: CompositeValue | T
}

export type JSONValue = boolean | string | number | null | undefined | JSONArray | JSONObject

export type JSONArray = JSONValue[]

export interface JSONObject {
  [key: PropKey]: JSONValue
}

export interface JSExpression {
  type: 'JSExpression'

  /**
   * 表达式字符串
   */
  value: string

  /**
   * 模拟值
   */
  mock?: any

  /**
   * 源码
   */
  compiled?: string
}

export interface JSFunction {
  type: 'JSFunction'

  /**
   * 函数定义，或直接函数表达式
   */
  value: string

  /**
   * 源码
   */
  compiled?: string

  /**
   * 模拟值
   */
  mock?: any

  /**
   * 额外扩展属性，如 extType、events
   */
  [key: string]: any
}

export const isJSExpression = (data: any): data is JSExpression => {
  if (!isObject(data)) {
    return false
  }
  return data.type === 'JSExpression' && data.extType !== 'function'
}

export function isJSFunction(data: any): data is JSFunction {
  if (!isObject(data)) {
    return false
  }
  return data.type === 'JSFunction'
}

export class Prop {
  readonly isProp = true

  readonly id = uniqueId('prop')

  #assertPropMutationAllowed(origin: string): void {
    assertLifecycleMutationAllowed(this, origin)
    this.owner.document.project.assertDocumentMutationAllowed(this.owner.document)
  }

  @observable.ref accessor #key: PropKey

  get key(): PropKey {
    return this.#key
  }

  @action
  set key(value: PropKey) {
    this.#assertPropMutationAllowed('prop.key')
    if (this.#key === value) return
    this.owner.document.markSchemaMutation()
    this.#key = value
  }

  readonly owner: Node

  getNode() {
    return this.owner
  }

  readonly props: Props

  getProps() {
    return this.props
  }

  @observable.ref accessor #valueState: PropValue | UNSET = UNSET

  @computed
  get value(): unknown | UNSET {
    return this.export(TRANSFORM_STAGE.SERIALIZE)
  }

  /**
   * 获得表达式值
   */
  @computed get code() {
    if (isJSExpression(this.value)) {
      return this.value.value
    }
    return this.#code != null ? this.#code : JSON.stringify(this.value)
  }

  /**
   * 设置表达式值
   */
  set code(code: string) {
    if (isJSExpression(this.#valueState)) {
      this.setValue({
        ...this.#valueState,
        value: code,
      })
      this.#code = code
      return
    }

    try {
      const v = JSON.parse(code)
      this.setValue(v)
      this.#code = code
      return
    } catch (e) {
      // ignore
    }

    this.setValue({
      type: 'JSExpression',
      value: code,
      mock: this.#valueState,
    })
    this.#code = code
  }

  #code: string | null = null

  @observable.ref accessor #valueType: ValueTypes = 'unset'

  get type() {
    return this.#valueType
  }

  /** use for list or map type */
  @observable.shallow accessor #itemsState: Prop[] | null = null

  /**
   * 作为一层缓存机制，主要是复用部分已存在的 Prop，保持响应式关系，比如：
   * 当前 Prop 值为 { a: 1 }，当调用 setValue({ a: 2 }) 时，所有原来的子 Prop 均被销毁，
   * 导致假如外部有 mobx reaction（常见于 observer），此时响应式链路会被打断，
   * 因为 reaction 监听的是原 Prop(a) 的值，而不是新 Prop(a) 的值。
   */
  @observable.shallow accessor #mapsState: Map<PropKey, Prop> | null = null

  /**
   * Construct the items and maps for the prop value
   */
  #getItems(): Prop[] | null {
    if (this.#itemsState) {
      return this.#itemsState
    }

    this.initItems()
    return this.#itemsState
  }

  #getMaps(): Map<PropKey, Prop> | null {
    if (!this.#getItems()) {
      return null
    }
    return this.#mapsState
  }

  /**
   * return a path of prop
   */
  get path(): string[] {
    return (this.parent.path || []).concat(this.key as string)
  }

  /**
   * item length
   */
  get size(): number {
    return this.#getItems()?.length || 0
  }

  constructor(
    readonly parent: PropParent,
    key: PropKey,
    value: PropValue | UNSET = UNSET,
  ) {
    this.owner = parent.owner
    this.props = parent.props
    inheritLifecycleMutationGuard(parent as object, this)
    installLifecycleTeardownOperation(this, () => this.#purgeInternal(true))
    inheritEngineTeardownOwnership(parent as object, this)
    lockReadonlyProperties(this, ['id', 'owner', 'parent', 'props'])
    lockPrototypeAccessors(this, ['key'])
    this.key = key

    if (value !== UNSET) {
      this.setValue(value)
    }

    this.initItems()
  }

  /**
   * This is to trigger the execution of the items getter function,
   * which will construct the items and maps for the prop value
   */
  @action
  initItems() {
    this.#assertPropMutationAllowed('prop.initItems')
    let items: Prop[] | null = null

    if (this.#valueType === 'list') {
      const maps = new Map<string, Prop>()
      const data = this.#valueState as Array<PropValue>

      for (let i = 0; i < data.length; i++) {
        const item = data[i]
        let prop: Prop
        items = items || []
        if (this.#mapsState?.has(i.toString())) {
          prop = this.#mapsState.get(i.toString())!
          prop.setValue(item)
        } else {
          prop = new Prop(this, i.toString(), item)
        }

        maps.set(i.toString(), prop)
        items.push(prop)
      }
      this.#mapsState = maps
    } else if (this.#valueType === 'map') {
      const maps = new Map<string, Prop>()
      const data = this.#valueState as Record<string, PropValue>
      const keys = Object.keys(data)

      for (const key of keys) {
        let prop: Prop
        if (this.#mapsState?.has(key)) {
          prop = this.#mapsState.get(key)!
          prop.setValue(data[key])
        } else {
          prop = new Prop(this, key, data[key])
        }
        items = items || []
        items.push(prop)
        maps.set(key, prop)
      }

      this.#mapsState = maps
    } else {
      items = null
      this.#mapsState = null
    }

    this.#itemsState = items
  }

  export(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE): PropValue {
    const type = this.#valueType

    if (stage === TRANSFORM_STAGE.RENDER && this.key === getConvertedExtraKey('condition')) {
      // 在设计器里，所有组件默认需要展示，除非开启了 enableCondition 配置
      if (this.owner.document.designer.editor.engineConfig.get('enableCondition') !== true) {
        return true
      }
      return this.#valueState as boolean
    }

    if (type === 'unset') {
      return undefined
    }

    if (type === 'literal' || type === 'expression') {
      return this.#valueState as CompositeValue
    }

    if (type === 'map') {
      if (!this.#itemsState) {
        return this.#valueState as CompositeValue
      }

      let maps: CompositeObject | undefined = undefined
      const items = this.#getItems()!
      for (let i = 0; i < items.length; i++) {
        const prop = items[i]
        if (!prop.isUnset()) {
          const v = prop.export(stage)
          if (v !== null) {
            maps = maps || {}
            maps[prop.key || i] = v
          }
        }
      }
      return maps
    }

    if (type === 'list') {
      if (!this.#itemsState) {
        return this.#valueState as CompositeValue
      }

      return this.#getItems()!.map(prop => {
        return prop.export(stage)
      }) as CompositeArray
    }
  }

  /**
   * whether the prop has been destroyed
   */
  @observable.ref accessor #purged = false

  /**
   * clear internal data
   */
  @action
  purge() {
    if (this.#purged) return
    this.#assertPropMutationAllowed('prop.purge')
    this.parent.delete(this)
  }

  #purgeInternal(teardown: boolean): void {
    if (this.#purged && !teardown) return
    if (!this.#purged && !teardown) {
      this.#assertPropMutationAllowed('prop.purge')
      this.owner.document.markSchemaMutation()
    }

    const errors: unknown[] = []
    this.#purged = true
    if (this.#itemsState) {
      const failedItems: Prop[] = []
      for (const item of this.#itemsState) {
        try {
          runInternalLifecycleTeardown(item)
        } catch (error) {
          errors.push(error)
          failedItems.push(item)
        }
      }
      this.#itemsState = failedItems.length > 0 ? failedItems : null
    } else {
      this.#itemsState = null
    }

    this.#mapsState = null
    sealLifecycleMutations(this, 'prop generation is disposed')
    if (errors.length) throw new AggregateError(errors, 'Prop disposal completed with errors')
  }

  @action
  remove() {
    this.purge()
  }

  /**
   * dispose internal data, use for changing value,
   * this will not trigger reactive
   */
  #dispose() {
    const items = untracked(() => this.#itemsState)
    if (items) {
      for (const prop of items) {
        runInternalLifecycleTeardown(prop)
      }
    }

    this.#itemsState = null
    this.#mapsState = null
  }

  @action
  unset() {
    this.#assertPropMutationAllowed('prop.unset')
    if (this.#valueType === 'unset') return
    this.owner.document.markSchemaMutation()
    this.#valueType = 'unset'
  }

  isUnset() {
    return this.#valueType === 'unset'
  }

  /**
   * @returns  0: the same 1: maybe & like 2: not the same
   */
  compare(other: Prop | null): number {
    if (!other || other.isUnset()) {
      return this.isUnset() ? 0 : 2
    }
    if (other.type !== this.type) {
      return 2
    }
    // list
    if (this.type === 'list') {
      return this.size === other.size ? 1 : 2
    }
    if (this.type === 'map') {
      return 1
    }

    // 'literal' | 'map' | 'expression' | 'slot'
    return this.value === other.value ? 0 : 2
  }

  /**
   * set value, val should be JSON Object
   */
  @action
  setValue(val: PropValue) {
    this.#assertPropMutationAllowed('prop.setValue')
    if (val === this.#valueState) return

    this.owner.document.markSchemaMutation()
    const oldValue = this.#valueState
    this.#valueState = val
    const t = typeof val
    if (val == null) {
      this.#valueType = 'literal'
    } else if (t === 'string' || t === 'number' || t === 'boolean') {
      this.#valueType = 'literal'
    } else if (Array.isArray(val)) {
      this.#valueType = 'list'
    } else if (isPlainObject(val)) {
      if (isJSExpression(val)) {
        this.#valueType = 'expression'
      } else {
        this.#valueType = 'map'
      }
    } else {
      this.#valueType = 'expression'
      this.#valueState = {
        type: 'JSExpression',
        value: valueToSource(val),
      }
    }

    this.#dispose()
    this.initItems()

    if (oldValue !== this.#valueState) {
      const propsInfo = {
        key: this.key,
        prop: this,
        oldValue,
        newValue: this.#valueState,
      }

      this.owner.emitPropChange(propsInfo)
      this.owner.document.designer.postEvent(DESIGNER_EVENT.NODE_PROPS_CHANGE, propsInfo)
    }
  }

  getValue() {
    return this.value
  }

  getAsString() {
    if (this.type === 'literal') {
      return this.#valueState ? String(this.#valueState) : ''
    }
    return ''
  }

  get(path: PropKey, createIfNone = true): Prop | null {
    if (createIfNone) this.#assertPropMutationAllowed('prop.get')
    const type = this.#valueType
    if (type !== 'map' && type !== 'list' && type !== 'unset' && !createIfNone) {
      return null
    }

    const maps = type === 'map' ? this.#getMaps() : null
    const items = type === 'list' ? this.#getItems() : null

    const { entry, nest } = splitPath(path)

    let prop: any
    if (type === 'list') {
      if (isValidArrayIndex(entry, this.size)) {
        prop = items![entry]
      }
    } else if (type === 'map') {
      prop = maps?.get(entry)
    }

    if (prop) {
      return nest ? prop.get(nest, createIfNone) : prop
    }

    if (createIfNone) {
      prop = new Prop(this, entry, UNSET)
      this.set(entry, prop, true)
      if (nest) {
        return prop.get(nest, true)
      }

      return prop
    }

    return null
  }

  @action
  set(key: PropKey, value: PropValue | Prop, force = false) {
    this.#assertPropMutationAllowed('prop.set')
    if (isProp(value)) {
      if (value.parent !== this || value.props !== this.props || value.owner !== this.owner || value.key !== key) {
        throw new Error('A Prop cannot adopt a foreign or mismatched child Prop identity')
      }
      const currentIndex = this.#itemsState?.indexOf(value) ?? -1
      const currentForKey = this.#mapsState?.get(key)
      if (currentIndex >= 0 && currentForKey !== value) {
        throw new Error('A Prop child identity cannot be inserted more than once')
      }
      if (currentForKey === value) return value
    }
    const type = this.#valueType
    if (type !== 'map' && type !== 'list' && type !== 'unset' && !force) {
      return null
    }

    if (type === 'unset' || (force && type !== 'map')) {
      if (isValidArrayIndex(key)) {
        if (type !== 'list') {
          this.setValue([])
        }
      } else {
        this.setValue({})
      }
    }

    const prop = isProp(value) ? value : new Prop(this, key, value)
    const items = this.#itemsState || []

    if (this.type === 'list') {
      if (!isValidArrayIndex(key)) {
        return null
      }
      if (isObservableArray(items)) {
        set(items, key, prop)
      } else {
        items[key] = prop
      }
      this.#itemsState = items
    } else if (this.type === 'map') {
      const maps = this.#mapsState || new Map<string, Prop>()
      const orig = maps?.get(key)

      if (orig) {
        // replace
        const i = items.indexOf(orig)
        if (i > -1) {
          this.owner.document.markSchemaMutation()
          runInternalLifecycleTeardown(items.splice(i, 1, prop)[0])
        }
        maps?.set(key, prop)
      } else {
        // push
        this.owner.document.markSchemaMutation()
        items.push(prop)
        this.#itemsState = items
        maps?.set(key, prop)
      }
      this.#mapsState = maps
    } else {
      return null
    }

    return prop
  }

  @action
  delete(prop: Prop) {
    this.#assertPropMutationAllowed('prop.delete')
    if (this.#itemsState) {
      const i = this.#itemsState.indexOf(prop)
      if (i > -1) {
        this.owner.document.markSchemaMutation()
        this.#itemsState.splice(i, 1)
        runInternalLifecycleTeardown(prop)
      }
      if (this.#mapsState && prop.key) {
        this.#mapsState.delete(String(prop.key))
      }
    }
  }

  @action
  add(key: PropKey, value?: PropValue | UNSET, force = false) {
    this.#assertPropMutationAllowed('prop.add')
    const type = this.#valueType
    if (type !== 'list' && type !== 'unset' && !force) {
      return null
    }
    if (type === 'unset' || (force && type !== 'list')) {
      this.setValue([])
    }

    const prop = new Prop(this, key, value)
    this.#itemsState = this.#itemsState || []
    this.owner.document.markSchemaMutation()
    this.#itemsState.push(prop)
    return prop
  }

  /**
   * check if the prop has the key, only for map and list type
   */
  has(key: PropKey) {
    if (this.#valueType !== 'map') {
      return false
    }
    if (this.#mapsState) {
      return this.#mapsState.has(key)
    }
    return Object.prototype.hasOwnProperty.call(this.#valueState, key)
  }

  deleteKey(key: PropKey) {
    this.#assertPropMutationAllowed('prop.deleteKey')
    const maps = this.#getMaps()
    if (maps) {
      const prop = maps.get(key)
      if (prop) {
        this.delete(prop)
      }
    }
  }

  /**
   * @see SettingTarget
   */
  @action
  getPropValue(key: PropKey): any {
    return this.get(key)!.getValue()
  }

  /**
   * @see SettingTarget
   */
  @action
  setPropValue(key: PropKey, value: any): void {
    this.set(key, value)
  }

  /**
   * @see SettingTarget
   */
  @action
  clearPropValue(key: PropKey): void {
    this.get(key, false)?.unset()
  }

  @action
  forEach(fn: (item: Prop, key: PropKey | number) => void): void {
    const items = this.#getItems()
    if (!items) {
      return
    }

    const isMap = this.#valueType === 'map'
    items.forEach((item, index) => {
      return withoutProjectMutationAuthority(this.owner.document.project, () =>
        isMap ? fn(item, item.key) : fn(item, index),
      )
    })
  }

  @action
  map<T>(fn: (item: Prop, key: PropKey | number) => T): T[] | null {
    const items = this.#getItems()
    if (!items) {
      return null
    }

    const isMap = this.#valueType === 'map'
    return items.map((item, index) => {
      return withoutProjectMutationAuthority(this.owner.document.project, () =>
        isMap ? fn(item, item.key) : fn(item, index),
      )
    })
  }

  [Symbol.iterator](): { next(): { value: Prop } } {
    let index = 0
    const items = this.#getItems()
    const length = items?.length || 0
    return {
      next() {
        if (index < length) {
          return {
            value: items![index++],
            done: false,
          }
        }
        return {
          value: undefined as any,
          done: true,
        }
      },
    }
  }
}

export const isProp = (obj: any): obj is Prop => {
  return obj && obj.isProp
}

/**
 * split path to entry and nest
 * - entry: a or 0
 * - nest: .b or [1].b
 */
export const splitPath = (path: PropKey) => {
  let entry = path
  let nest = ''

  if (typeof path === 'string') {
    const objIndex = path.indexOf('.', 1) // path = ".c.a.b"
    const arrIndex = path.indexOf('[', 1) // path = "[0].a.b"

    if (objIndex > 0 && ((arrIndex > 0 && objIndex < arrIndex) || arrIndex < 0)) {
      entry = path.slice(0, objIndex)
      nest = path.slice(objIndex + 1)
    }

    if (arrIndex > 0 && ((objIndex > 0 && arrIndex < objIndex) || objIndex < 0)) {
      entry = path.slice(0, arrIndex)
      nest = path.slice(arrIndex)
    }
    if ((entry as string).startsWith('[')) {
      entry = (entry as string).slice(1, (entry as string).length - 1)
    }
  }

  return { entry, nest }
}

/**
 * check if the key is a valid array index
 */
export function isValidArrayIndex(key: any, limit = -1): key is number {
  const n = Number.parseFloat(String(key))
  return n >= 0 && Math.floor(n) === n && Number.isFinite(n) && (limit < 0 || n < limit)
}
