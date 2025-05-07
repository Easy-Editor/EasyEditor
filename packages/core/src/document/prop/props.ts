import { action, computed, observable } from 'mobx'
import { TRANSFORM_STAGE } from '../../types'
import { uniqueId } from '../../utils'
import type { Node } from '../node/node'
import { Prop, type PropKey, type PropValue, type PropsMap, UNSET, splitPath } from './prop'

const EXTRA_KEY_PREFIX = '___'

/**
 * prop key convert to extra key
 */
export const getConvertedExtraKey = (key: string): string => {
  if (!key) {
    return ''
  }
  let _key = key
  if (key.indexOf('.') > 0) {
    _key = key.split('.')[0]
  }
  return EXTRA_KEY_PREFIX + _key + EXTRA_KEY_PREFIX + key.slice(_key.length)
}

/**
 * extra key convert to prop key
 */
export const getOriginalExtraKey = (key: string): string => {
  return key.replace(new RegExp(`${EXTRA_KEY_PREFIX}`, 'g'), '')
}

export const isExtraKey = (key: string): boolean => {
  return key.startsWith(EXTRA_KEY_PREFIX)
}

export class Props {
  readonly id = uniqueId('props')

  readonly path = []

  readonly owner: Node

  getNode() {
    return this.owner
  }

  get props() {
    return this
  }

  getProps() {
    return this.props
  }

  @observable accessor type = 'map'

  @observable.shallow accessor items: Prop[] = []

  @computed
  private get maps() {
    const maps = new Map<PropKey, Prop>()

    if (this.items.length > 0) {
      this.items.forEach(prop => {
        if (prop.key) {
          maps.set(prop.key, prop)
        }
      })
    }

    return maps
  }

  @computed
  get size() {
    return this.items.length
  }

  constructor(owner: Node, props?: PropsMap, extras?: PropsMap) {
    this.owner = owner

    if (props != null) {
      this.items = Object.keys(props).map(key => new Prop(this, key, props[key]))
    }
    if (extras) {
      Object.keys(extras).forEach(key => {
        this.items.push(new Prop(this, getConvertedExtraKey(key), extras[key]))
      })
    }
  }

  @action
  import(props?: PropsMap | null, extras?: PropsMap) {
    // TODO: 是否需要继承之前相同的 key，来保持响应式

    const originItems = this.items
    if (props != null) {
      this.type = 'map'
      this.items = Object.keys(props).map(key => new Prop(this, key, props[key]))
    } else {
      this.type = 'map'
      this.items = []
    }
    if (extras) {
      Object.keys(extras).forEach(key => {
        this.items.push(new Prop(this, getConvertedExtraKey(key), extras[key]))
      })
    }
    originItems.forEach(item => item.purge())
  }

  export(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE) {
    if (this.items.length < 1) {
      return {}
    }

    const props: PropsMap = {}
    const extras: PropsMap = {}

    this.items.forEach(item => {
      const key = item.key as string
      if (key == null || item.isUnset()) return
      const value = item.export(stage)
      if (value != null) {
        if (typeof key === 'string' && isExtraKey(key)) {
          extras[getOriginalExtraKey(key)] = value
        } else {
          props[key] = value
        }
      }
    })

    return { props, extras }
  }

  merge(value: PropsMap, extras?: PropsMap) {
    Object.keys(value).forEach(key => {
      this.query(key, true)!.setValue(value[key])
      this.query(key, true)!.initItems()
    })
    if (extras) {
      Object.keys(extras).forEach(key => {
        this.query(getConvertedExtraKey(key), true)!.setValue(extras[key])
        this.query(getConvertedExtraKey(key), true)!.initItems()
      })
    }
  }

  private purged = false

  @action
  purge() {
    if (this.purged) {
      return
    }
    this.purged = true
    for (const item of this.items) {
      item.purge()
    }
  }

  /**
   * get a prop, if not found, create a prop when createIfNone is true
   */
  get(path: PropKey, createIfNone = false) {
    const { entry, nest } = splitPath(path)

    let prop = this.maps.get(entry)
    if (!prop && createIfNone) {
      prop = this.add(entry, UNSET)
    }

    if (prop) {
      return nest ? prop.get(nest, createIfNone) : prop
    }

    return null
  }

  query(path: PropKey, createIfNone = true) {
    return this.get(path, createIfNone)
  }

  getProp(path: PropKey, createIfNone = true) {
    return this.query(path, createIfNone) || null
  }

  getPropValue(path: PropKey) {
    return this.getProp(path, false)?.value
  }

  setPropValue(path: PropKey, value: any) {
    this.getProp(path, true)!.setValue(value)
  }

  delete(prop: Prop) {
    const index = this.items.indexOf(prop)
    if (index > -1) {
      this.items.splice(index, 1)
      prop.purge()
    }
  }

  deleteKey(key: PropKey) {
    this.items = this.items.filter((item, i) => {
      if (item.key === key) {
        item.purge()
        this.items.splice(i, 1)
        return false
      }
      return true
    })
  }

  @action
  add(key: PropKey, value?: PropValue | UNSET) {
    const prop = new Prop(this, key, value)
    this.items.push(prop)
    return prop
  }

  has(key: PropKey) {
    return this.maps.has(key)
  }

  forEach(fn: (item: Prop, key: PropKey) => void) {
    for (const item of this.items) {
      fn(item, item.key)
    }
  }

  map<E>(fn: (item: Prop, key: PropKey) => E): E[] | null {
    return this.items.map(item => {
      return fn(item, item.key)
    })
  }

  filter(fn: (item: Prop, key: PropKey) => boolean) {
    return this.items.filter(item => {
      return fn(item, item.key)
    })
  }

  [Symbol.iterator](): { next(): { value: Prop } } {
    let index = 0
    const { items } = this
    const length = items.length || 0

    return {
      next() {
        if (index < length) {
          return {
            value: items[index++],
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
