import { action, computed, observable } from 'mobx'
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
import { TRANSFORM_STAGE } from '../../types'
import { uniqueId } from '../../utils'
import type { Node } from '../node/node'
import { Prop, type PropKey, type PropValue, type PropsMap, UNSET, isProp, splitPath } from './prop'

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

  @observable.ref accessor #type = 'map'

  get type() {
    return this.#type
  }

  @observable.shallow accessor #items: Prop[] = []

  get items(): readonly Prop[] {
    const snapshot = this.#items.slice()
    inheritLifecycleMutationGuard(this, snapshot)
    return Object.freeze(snapshot)
  }

  private assertPropsMutationAllowed(origin: string): void {
    assertLifecycleMutationAllowed(this, origin)
    this.owner.document.project.assertDocumentMutationAllowed(this.owner.document)
  }

  @computed
  private get maps() {
    const maps = new Map<PropKey, Prop>()

    if (this.#items.length > 0) {
      this.#items.forEach(prop => {
        if (prop.key) {
          maps.set(prop.key, prop)
        }
      })
    }

    return maps
  }

  @computed
  get size() {
    return this.#items.length
  }

  constructor(owner: Node, props?: PropsMap, extras?: PropsMap) {
    this.owner = owner
    inheritLifecycleMutationGuard(owner, this)
    installLifecycleTeardownOperation(this, () => this.#purgeInternal(true))
    inheritEngineTeardownOwnership(owner, this)
    lockReadonlyProperties(this, ['id', 'owner', 'path'])
    lockPrototypeAccessors(this, ['items', 'props', 'type'])

    if (props != null) {
      this.#items = Object.keys(props).map(key => new Prop(this, key, props[key]))
    }
    if (extras) {
      Object.keys(extras).forEach(key => {
        this.#items.push(new Prop(this, getConvertedExtraKey(key), extras[key]))
      })
    }
    this.#validateItems(this.#items)
  }

  #validateItems(items: readonly Prop[]): void {
    const identities = new Set<Prop>()
    const keys = new Set<PropKey>()
    for (const prop of items) {
      if (!isProp(prop)) throw new TypeError('Props only accepts Prop identities')
      if (prop.parent !== this || prop.props !== this || prop.owner !== this.owner) {
        throw new Error('Props cannot accept a foreign Prop identity')
      }
      if (identities.has(prop) || keys.has(prop.key)) {
        throw new Error(`Props cannot contain duplicate Prop identity or key "${String(prop.key)}"`)
      }
      identities.add(prop)
      keys.add(prop.key)
    }
  }

  @action
  import(props?: PropsMap | null, extras?: PropsMap) {
    this.assertPropsMutationAllowed('props.import')
    // TODO: 是否需要继承之前相同的 key，来保持响应式

    this.owner.document.markSchemaMutation()
    const originItems = this.#items
    const nextItems: Prop[] = []
    if (props != null) {
      this.#type = 'map'
      nextItems.push(...Object.keys(props).map(key => new Prop(this, key, props[key])))
    } else {
      this.#type = 'map'
    }
    if (extras) {
      Object.keys(extras).forEach(key => {
        nextItems.push(new Prop(this, getConvertedExtraKey(key), extras[key]))
      })
    }
    this.#validateItems(nextItems)
    this.#items = nextItems
    originItems.forEach(item => runInternalLifecycleTeardown(item))
  }

  export(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE) {
    if (this.#items.length < 1) {
      return {}
    }

    const props: PropsMap = {}
    const extras: PropsMap = {}

    this.#items.forEach(item => {
      const key = item.key as string
      if (key == null || item.isUnset()) return
      const value = item.export(stage)
      if (typeof key === 'string' && isExtraKey(key)) {
        extras[getOriginalExtraKey(key)] = value
      } else {
        props[key] = value
      }
    })

    return { props, extras }
  }

  merge(value: PropsMap, extras?: PropsMap) {
    this.assertPropsMutationAllowed('props.merge')
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
    if (this.purged) return
    this.assertPropsMutationAllowed('props.purge')
    throw new Error('Cannot props.purge; cleanup must be coordinated by its owning Node')
  }

  #purgeInternal(teardown: boolean): void {
    if (this.purged && !teardown) return
    if (!this.purged && !teardown) {
      this.assertPropsMutationAllowed('props.purge')
      this.owner.document.markSchemaMutation()
    }
    const errors: unknown[] = []
    const cleanup = (operation: () => void): void => {
      try {
        operation()
      } catch (error) {
        errors.push(error)
      }
    }
    this.purged = true
    for (const item of this.#items) {
      cleanup(() => runInternalLifecycleTeardown(item))
    }
    sealLifecycleMutations(this, 'props generation is disposed')
    if (errors.length) throw new AggregateError(errors, 'Props disposal completed with errors')
  }

  /**
   * get a prop, if not found, create a prop when createIfNone is true
   */
  get(path: PropKey, createIfNone = false) {
    if (createIfNone) this.assertPropsMutationAllowed('props.get')
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
    this.assertPropsMutationAllowed('props.setPropValue')
    this.getProp(path, true)!.setValue(value)
  }

  delete(prop: Prop) {
    this.assertPropsMutationAllowed('props.delete')
    const index = this.#items.indexOf(prop)
    if (index > -1) {
      this.owner.document.markSchemaMutation()
      this.#items.splice(index, 1)
      runInternalLifecycleTeardown(prop)
    }
  }

  deleteKey(key: PropKey) {
    this.assertPropsMutationAllowed('props.deleteKey')
    const removed = this.#items.filter(item => item.key === key)
    if (removed.length === 0) return
    const retained = this.#items.filter(item => item.key !== key)
    this.#validateItems(retained)
    this.owner.document.markSchemaMutation()
    this.#items = retained
    const errors: unknown[] = []
    for (const item of removed) {
      try {
        runInternalLifecycleTeardown(item)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, `Props key "${String(key)}" cleanup failed`)
  }

  @action
  add(key: PropKey, value?: PropValue | UNSET) {
    this.assertPropsMutationAllowed('props.add')
    const prop = new Prop(this, key, value)
    this.#validateItems([...this.#items, prop])
    this.owner.document.markSchemaMutation()
    this.#items.push(prop)
    return prop
  }

  has(key: PropKey) {
    return this.maps.has(key)
  }

  forEach(fn: (item: Prop, key: PropKey) => void) {
    for (const item of this.#items) {
      withoutProjectMutationAuthority(this.owner.document.project, () => fn(item, item.key))
    }
  }

  map<E>(fn: (item: Prop, key: PropKey) => E): E[] | null {
    return this.#items.map(item => {
      return withoutProjectMutationAuthority(this.owner.document.project, () => fn(item, item.key))
    })
  }

  filter(fn: (item: Prop, key: PropKey) => boolean) {
    return this.#items.filter(item => {
      return withoutProjectMutationAuthority(this.owner.document.project, () => fn(item, item.key))
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
