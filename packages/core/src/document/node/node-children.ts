import type { NodeSchema } from '../../types'
import type { Node } from './node'

import { action, computed, observable } from 'mobx'
import { TRANSFORM_STAGE } from '../../types'
import { createEventBus } from '../../utils'
import { NODE_EVENT, isNodeSchema } from './node'

export enum NODE_CHILDREN_EVENT {
  CHANGE = 'nodeChildren:change',
  INSERT = 'nodeChildren:insert',
}

export class NodeChildren {
  private emitter = createEventBus('NodeChildren')

  readonly owner: Node

  getNode() {
    return this.owner
  }

  @observable.shallow accessor children: Node[] = []

  @computed
  get size(): number {
    return this.children.length
  }

  get isEmptyNode(): boolean {
    return this.size < 1
  }

  isEmpty() {
    return this.isEmptyNode
  }

  constructor(owner: Node, data?: NodeSchema[]) {
    this.owner = owner
    this.children = (Array.isArray(data) ? data : []).map(child => {
      return this.owner.document.createNode(child)
    })
    this.internalInitParent()
  }

  export(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE) {
    return this.children.map(node => {
      const data = node.export(stage)
      return data
    })
  }

  @action
  import(data?: NodeSchema | NodeSchema[], checkId = false) {
    data = (data ? (Array.isArray(data) ? data : [data]) : []).filter(d => !!d)

    const originChildren = this.children.slice()
    this.children.forEach(child => child.internalSetParent(null))

    const children = new Array<Node>(data.length)
    for (let i = 0, l = data.length; i < l; i++) {
      const child = originChildren[i]
      const item = data[i]

      let node: Node | undefined | null
      if (isNodeSchema(item) && !checkId && child && child.componentName === item.componentName) {
        node = child
        node.import(item)
      } else {
        node = this.owner.document?.createNode(item, checkId)
      }
      children[i] = node
    }

    this.children = children
    this.internalInitParent()
    this.emitter.emit(NODE_CHILDREN_EVENT.CHANGE)
  }

  @action
  remove(purge = true, useMutator = true) {
    this.children.forEach(child => {
      child.remove(purge, useMutator)
    })
    this.children.length = 0
  }

  private purged = false

  @action
  purge() {
    if (this.purged) {
      return
    }
    this.purged = true
    this.children.forEach(child => {
      child.purge()
    })
  }

  internalInitParent() {
    for (const child of this.children) {
      child.internalSetParent(this.owner)
    }
  }

  @action
  internalUnlinkChild(node: Node) {
    const i = this.children.indexOf(node)
    if (i < 0) {
      return false
    }

    this.children.splice(i, 1)
    return true
  }

  unlinkChild(node: Node) {
    this.internalUnlinkChild(node)
    this.emitter.emit(NODE_CHILDREN_EVENT.CHANGE, {
      type: 'unlink',
      node,
    })
  }

  delete(node: Node) {
    return this.internalDelete(node)
  }

  @action
  internalDelete(node: Node, purge = false, useMutator = true): boolean {
    if (node.isParental) {
      node.children?.remove(purge, useMutator)
    }

    const index = this.children.map(d => d.id).indexOf(node.id)
    if (purge) {
      // should set parent null
      node.internalSetParent(null, useMutator)
      try {
        node.purge()
      } catch (err) {
        console.error(err)
      }
    }

    const { document } = node
    const designer = document.designer
    designer.postEvent(NODE_EVENT.REMOVE, { index, node })
    document.unlinkNode(node)
    document.designer.selection.remove(node.id)
    node.unlink()
    this.emitter.emit(NODE_CHILDREN_EVENT.CHANGE, {
      type: 'delete',
      node,
    })

    if (index > -1 && !purge) {
      this.children.splice(index, 1)
    }
    return false
  }

  get(index: number) {
    if (index < 0 || index >= this.children.length) {
      return null
    }

    return this.children[index]
  }

  has(node: Node) {
    return this.children.indexOf(node) > -1
  }

  insert(node: Node, at?: number | null): void {
    this.internalInsert(node, at, true)
  }

  /**
   * insert a node into the children
   * @param node
   * @param at if at is null or -1, insert the node to the end of the children
   */
  @action
  internalInsert(node: Node, at?: number | null, useMutator = true): void {
    const { children } = this
    const i = at === null || at === -1 ? this.children.length : at!

    const index = this.children.indexOf(node)

    if (node.parent) {
      const designer = node.document?.designer
      designer.postEvent(NODE_EVENT.REMOVE, {
        index: node.index,
        node,
      })
    }

    // node is not in the children
    if (index < 0) {
      if (i < children.length) {
        children.splice(i, 0, node)
      } else {
        children.push(node)
      }
      node.internalSetParent(this.owner, useMutator)
    } else {
      if (i === index) {
        return
      }

      children.splice(index, 1)
      children.splice(i, 0, node)
    }

    this.emitter.emit(NODE_CHILDREN_EVENT.CHANGE, {
      type: 'insert',
      node,
    })
    this.emitter.emit(NODE_CHILDREN_EVENT.INSERT, node)
    const designer = this.owner.document.designer
    designer.postEvent(NODE_EVENT.ADD, { node })
  }

  @action
  mergeChildren(
    remover: (node: Node, idx: number) => boolean,
    adder: (children: Node[]) => NodeSchema[] | null,
    sorter: (firstNode: Node, secondNode: Node) => number,
  ): any {
    let changed = false
    if (remover) {
      const willRemove = this.children.filter(remover)
      if (willRemove.length > 0) {
        willRemove.forEach(node => {
          const i = this.children.map(d => d.id).indexOf(node.id)
          if (i > -1) {
            this.children.splice(i, 1)
            node.remove(false)
          }
        })
        changed = true
      }
    }
    if (adder) {
      const items = adder(this.children)
      if (items && items.length > 0) {
        items.forEach(child => {
          const node = this.owner.document?.createNode(child)
          this.children.push(node)
          node.internalSetParent(this.owner)
          const designer = node.document?.designer
          designer.postEvent(NODE_EVENT.ADD, { node })
        })
        changed = true
      }
    }
    if (sorter) {
      this.children = this.children.sort(sorter)
      changed = true
    }
    if (changed) {
      this.emitter.emit(NODE_CHILDREN_EVENT.CHANGE)
    }
  }

  indexOf(node: Node): number {
    return this.children.map(d => d.id).indexOf(node.id)
  }

  find(f: (value: Node, index: number, obj: Node[]) => unknown) {
    return this.children.find(f)
  }

  forEach(fn: (node: Node, index: number) => void): void {
    this.children.forEach((item: Node, index: number) => {
      fn(item, index)
    })
  }

  reverse(): Node[] {
    return this.children.reverse()
  }

  map(fn: (node: Node, index: number) => Node): Node[] {
    return this.children.map((item: Node, index: number): Node => {
      return fn(item, index)
    })
  }

  every(fn: (node: Node, index: number) => boolean): boolean {
    return this.children.every((item: Node, index: number) => {
      return fn(item, index)
    })
  }

  some(fn: (node: Node, index: number) => boolean): boolean {
    return this.children.some((item: Node, index: number) => {
      return fn(item, index)
    })
  }

  filter(fn: (node: Node, index: number) => boolean): Node[] {
    return this.children.filter((item: Node, index: number) => {
      return fn(item, index)
    })
  }

  reduce(fn: (acc: any, cur: Node) => any, initialValue: any) {
    return this.children.reduce((acc: any, cur: Node) => {
      return fn(acc, cur)
    }, initialValue)
  }

  onChange(listener: (info?: { type: string; node: Node }) => void) {
    this.emitter.on(NODE_CHILDREN_EVENT.CHANGE, listener)
    return () => {
      this.emitter.off(NODE_CHILDREN_EVENT.CHANGE, listener)
    }
  }

  onInsert(listener: (node: Node) => void) {
    this.emitter.on(NODE_CHILDREN_EVENT.INSERT, listener)
    return () => {
      this.emitter.off(NODE_CHILDREN_EVENT.INSERT, listener)
    }
  }
}
