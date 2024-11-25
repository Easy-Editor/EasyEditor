import type { Node } from '../node/node'
import type { Props } from './props'

import { action, computed, isObservableArray, observable, runInAction, set, untracked } from 'mobx'
import { DESIGNER_EVENT } from '../../designer'
import { TRANSFORM_STAGE } from '../../types'
import { uniqueId } from '../../utils'

export const UNSET = Symbol.for('unset')
export type UNSET = typeof UNSET

// TODO: expression & slot
export type ValueTypes = 'unset' | 'literal' | 'list' | 'map'

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

export type CompositeValue = JSONValue | CompositeArray | CompositeObject

export type CompositeArray = CompositeValue[]

export interface CompositeObject<T = CompositeValue> {
  [key: PropKey]: CompositeValue | T
}

export type JSONValue = boolean | string | number | null | undefined | JSONArray | JSONObject

export type JSONArray = JSONValue[]

export interface JSONObject {
  [key: PropKey]: JSONValue
}

export class Prop {
  readonly isProp = true

  readonly id = uniqueId('prop')

  @observable.ref accessor key: PropKey

  readonly owner: Node

  readonly props: Props

  getProps() {
    return this.props
  }

  getNode() {
    return this.owner
  }

  @observable.ref private accessor _value: PropValue | UNSET = UNSET

  @computed get value(): unknown | UNSET {
    return this.export(TRANSFORM_STAGE.SERIALIZE)
  }

  @observable.ref private accessor _type: ValueTypes = 'unset'

  get type() {
    return this._type
  }

  @action
  unset() {
    this._type = 'unset'
  }

  isUnset() {
    return this._type === 'unset'
  }

  /** use for list or map type */
  @observable.shallow private accessor _items: Prop[] | null = null

  /**
   * 作为一层缓存机制，主要是复用部分已存在的 Prop，保持响应式关系，比如：
   * 当前 Prop#_value 值为 { a: 1 }，当调用 setValue({ a: 2 }) 时，所有原来的子 Prop 均被销毁，
   * 导致假如外部有 mobx reaction（常见于 observer），此时响应式链路会被打断，
   * 因为 reaction 监听的是原 Prop(a) 的 _value，而不是新 Prop(a) 的 _value。
   */
  @observable.shallow private accessor _maps: Map<PropKey, Prop> | null = null

  /**
   * Construct the items and maps for the prop value
   */
  private get items() {
    if (this._items) {
      return this._items
    }

    this.initItems()
    return this._items
  }

  @computed private get maps(): Map<PropKey, Prop> | null {
    if (!this.items) {
      return null
    }
    return this._maps
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
    return this.items?.length || 0
  }

  constructor(
    readonly parent: PropParent,
    key: PropKey,
    value: PropValue | UNSET = UNSET,
  ) {
    this.owner = parent.owner
    this.props = parent.props
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
    runInAction(() => {
      let items: Prop[] | null = null

      if (this._type === 'list') {
        const maps = new Map<string, Prop>()
        const data = this._value as Array<PropValue>

        for (let i = 0; i < data.length; i++) {
          const item = data[i]
          let prop: Prop
          items = items || []
          if (this._maps?.has(i.toString())) {
            prop = this._maps.get(i.toString())!
            prop.setValue(item)
          } else {
            prop = new Prop(this, i.toString(), item)
          }

          maps.set(i.toString(), prop)
          items.push(prop)
        }
        this._maps = maps
      } else if (this._type === 'map') {
        const maps = new Map<string, Prop>()
        const data = this._value as Record<string, PropValue>
        const keys = Object.keys(data)

        for (const key of keys) {
          let prop: Prop
          if (this._maps?.has(key)) {
            prop = this._maps.get(key)!
            prop.setValue(data[key])
          } else {
            prop = new Prop(this, key, data[key])
          }
          items = items || []
          items.push(prop)
          maps.set(key, prop)
        }

        this._maps = maps
      } else {
        items = null
        this._maps = null
      }

      this._items = items
    })
  }

  export(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE): PropValue {
    const type = this._type

    if (type === 'unset') {
      return undefined
    }

    if (type === 'literal') {
      return this._value as any
    }

    if (type === 'map') {
      if (!this._items) {
        return this._value as any
      }

      let maps: any = undefined
      for (let i = 0; i < this.items!.length; i++) {
        const prop = this.items![i]
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
      if (!this._items) {
        return this._value as any
      }

      return this.items!.map(prop => {
        return prop.export(stage)
      }) as CompositeArray
    }
  }

  getAsString(): string {
    if (this.type === 'literal') {
      return this._value ? String(this._value) : ''
    }
    return ''
  }

  /**
   * whether the prop has been destroyed
   */
  @observable.ref private accessor purged = false

  /**
   * clear internal data
   */
  @action
  purge() {
    if (this.purged) {
      return
    }

    this.purged = true
    if (this._items) {
      for (const item of this._items) {
        item.purge()
      }
    }

    this._items = null
    this._maps = null
  }

  @action
  remove() {
    this.purge()
    this.parent.delete(this)
  }

  /**
   * dispose internal data, use for changing value,
   * this will not trigger reactive
   */
  @action
  private dispose() {
    const items = untracked(() => this._items)
    if (items) {
      for (const prop of items) {
        prop.purge()
      }
    }

    this._items = null
    this._maps = null
  }

  /**
   * set value, val should be JSON Object
   */
  @action
  setValue(val: PropValue) {
    if (val === this._value) return

    const oldValue = this._value
    this._value = val
    const t = typeof val
    if (val == null) {
      this._type = 'literal'
    } else if (t === 'string' || t === 'number' || t === 'boolean') {
      this._type = 'literal'
    } else if (Array.isArray(val)) {
      this._type = 'list'
    } else if (isPlainObject(val)) {
      this._type = 'map'
    }

    this.dispose()
    this.initItems()

    if (oldValue !== this._value) {
      const propsInfo = {
        key: this.key,
        prop: this,
        oldValue,
        newValue: this._value,
      }

      this.owner.emitPropChange(propsInfo)
      this.owner.document.designer.postEvent(DESIGNER_EVENT.NODE_PROPS_CHANGE, propsInfo)
    }
  }

  getValue() {
    return this.value
  }

  get(path: string, createIfNone = true): Prop | null {
    const type = this._type
    if (type !== 'list' && type !== 'unset' && !createIfNone) {
      return null
    }

    const maps = type === 'map' ? this.maps : null
    const items = type === 'list' ? this.items : null

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
    const type = this._type
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
    const items = this._items! || []

    if (this.type === 'list') {
      if (!isValidArrayIndex(key)) {
        return null
      }
      if (isObservableArray(items)) {
        set(items, key, prop)
      } else {
        items[key] = prop
      }
      this._items = items
    } else if (this.type === 'map') {
      const maps = this._maps || new Map<string, Prop>()
      const orig = maps?.get(key)

      if (orig) {
        // replace
        const i = items.indexOf(orig)
        if (i > -1) {
          items.splice(i, 1, prop)[0].purge()
        }
        maps?.set(key, prop)
      } else {
        // push
        items.push(prop)
        this._items = items
        maps?.set(key, prop)
      }
      this._maps = maps
    } else {
      return null
    }

    return prop
  }

  @action
  delete(prop: Prop) {
    if (this._items) {
      const i = this._items.indexOf(prop)
      if (i > -1) {
        this._items.splice(i, 1)
        prop.purge()
      }
      if (this._maps && prop.key) {
        this._maps.delete(String(prop.key))
      }
    }
  }

  @action
  add(key: PropKey, value?: PropValue | UNSET, force = false) {
    const type = this._type
    if (type !== 'list' && type !== 'unset' && !force) {
      return null
    }
    if (type === 'unset' || (force && type !== 'list')) {
      this.setValue([])
    }

    const prop = new Prop(this, key, value)
    this._items = this._items || []
    this._items.push(prop)
    return prop
  }

  /**
   * check if the prop has the key, only for map and list type
   */
  has(key: string) {
    if (this._type !== 'map') {
      return false
    }
    if (this._maps) {
      return this._maps.has(key)
    }
    return Object.prototype.hasOwnProperty.call(this._value, key)
  }

  deleteKey(key: string) {
    if (this.maps) {
      const prop = this.maps.get(key)
      if (prop) {
        this.delete(prop)
      }
    }
  }

  clearPropValue(propName: string): void {
    this.get(propName, false)?.unset()
  }

  @action
  forEach(fn: (item: Prop, key: PropKey | number) => void): void {
    const { items } = this
    if (!items) {
      return
    }

    const isMap = this._type === 'map'
    items.forEach((item, index) => {
      return isMap ? fn(item, item.key) : fn(item, index)
    })
  }

  @action
  map<T>(fn: (item: Prop, key: PropKey | number) => T): T[] | null {
    const { items } = this
    if (!items) {
      return null
    }

    const isMap = this._type === 'map'
    return items.map((item, index) => {
      return isMap ? fn(item, item.key) : fn(item, index)
    })
  }

  [Symbol.iterator](): { next(): { value: Prop } } {
    let index = 0
    const { items } = this
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
export const splitPath = (path: string) => {
  let entry = path
  let nest = ''

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
  if (entry.startsWith('[')) {
    entry = entry.slice(1, entry.length - 1)
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

export const isObject = (value: any): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object'
}

export const isPlainObject = (value: any): value is any => {
  if (!isObject(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null || Object.getPrototypeOf(proto) === null
}
