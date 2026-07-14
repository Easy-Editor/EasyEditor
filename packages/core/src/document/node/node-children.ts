import { action, computed, observable } from 'mobx'
import { createDesignerEventBus } from '../../designer/event-bus'
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
import type { EventBus } from '../../utils'
import { NODE_EVENT, type Node, type NodeModelOptions, isNode, isNodeSchema } from './node'

export enum NODE_CHILDREN_EVENT {
  CHANGE = 'nodeChildren:change',
  INSERT = 'nodeChildren:insert',
}

export class NodeChildren {
  private emitter: EventBus

  readonly owner: Node

  getNode() {
    return this.owner
  }

  @observable.shallow accessor #children: Node[] = []

  get children(): readonly Node[] {
    const snapshot = this.#children.slice()
    inheritLifecycleMutationGuard(this, snapshot)
    return Object.freeze(snapshot)
  }

  private assertChildrenMutationAllowed(origin: string): void {
    assertLifecycleMutationAllowed(this, origin)
    this.owner.document.project.assertDocumentMutationAllowed(this.owner.document)
  }

  private assertChildrenGenerationActive(origin: string): void {
    assertLifecycleMutationAllowed(this, origin)
    this.owner.document.project.assertDocumentGenerationActive(this.owner.document)
  }

  @computed
  get size(): number {
    return this.#children.length
  }

  get isEmptyNode(): boolean {
    return this.size < 1
  }

  isEmpty() {
    return this.isEmptyNode
  }

  constructor(owner: Node, data?: NodeSchema[], options: NodeModelOptions = {}) {
    this.owner = owner
    inheritLifecycleMutationGuard(owner, this)
    installLifecycleTeardownOperation(this, (visited?: Set<Node>) => this.#purgeInternal(true, visited))
    inheritEngineTeardownOwnership(owner, this)
    lockReadonlyProperties(this, ['owner'])
    lockPrototypeAccessors(this, ['children'])
    this.emitter = createDesignerEventBus(owner.document.designer, 'NodeChildren')
    inheritEngineTeardownOwnership(owner.document.project, this.emitter)
    lockReadonlyProperties(this, ['emitter'])
    try {
      this.#children = (Array.isArray(data) ? data : []).map(child => {
        return this.owner.document.createNode(child, true, options)
      })
      this.#validateChildren(this.#children)
    } catch (error) {
      const cleanupErrors: unknown[] = []
      const cleanup = (operation: () => void) => {
        try {
          operation()
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      sealLifecycleMutations(this, 'node children construction failed')
      sealLifecycleMutations(this.emitter, 'node children construction failed')
      cleanup(() => runInternalLifecycleTeardown(this.emitter))
      if (cleanupErrors.length) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          'Node children construction failed and cleanup reported errors',
        )
      }
      throw error
    }
  }

  #validateChildren(children: readonly Node[]): void {
    const identities = new Set<Node>()
    const ids = new Set<string>()
    for (const child of children) {
      if (!isNode(child)) throw new TypeError('NodeChildren only accepts Node identities')
      if (child.document !== this.owner.document || this.owner.document.getNode(child.id) !== child) {
        throw new Error('NodeChildren cannot accept a foreign or unregistered Node identity')
      }
      if (identities.has(child) || ids.has(child.id)) {
        throw new Error(`NodeChildren cannot contain duplicate Node identity "${child.id}"`)
      }
      identities.add(child)
      ids.add(child.id)

      const visited = new Set<Node>()
      let ancestor: Node | null = this.owner
      while (ancestor) {
        if (ancestor === child) throw new Error('NodeChildren cannot introduce a parent cycle')
        if (visited.has(ancestor)) throw new Error('NodeChildren owner ancestry already contains a cycle')
        visited.add(ancestor)
        ancestor = ancestor.parent
      }
    }
  }

  export(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE) {
    return this.#children.map(node => {
      const data = node.export(stage)
      return data
    })
  }

  @action
  import(data?: NodeSchema | NodeSchema[], checkId = false, options: NodeModelOptions = {}) {
    this.assertChildrenMutationAllowed('nodeChildren.import')
    this.owner.document.markSchemaMutation()
    data = (data ? (Array.isArray(data) ? data : [data]) : []).filter(d => !!d)

    const originChildren = this.#children.slice()
    this.#children.forEach(child => child.internalSetParent(null))

    const children = new Array<Node>(data.length)
    for (let i = 0, l = data.length; i < l; i++) {
      const child = originChildren[i]
      const item = data[i]

      let node: Node | undefined | null
      if (isNodeSchema(item) && !checkId && child && child.componentName === item.componentName) {
        node = child
        node.import(item, checkId, options)
      } else {
        node = this.owner.document?.createNode(item, checkId, options)
      }
      children[i] = node
    }

    this.#validateChildren(children)
    this.#children = children
    this.internalInitParent()
    this.emitter.emit(NODE_CHILDREN_EVENT.CHANGE)
  }

  @action
  remove(purge = true, useMutator = true) {
    this.assertChildrenMutationAllowed('nodeChildren.remove')
    // child.remove() unlinks itself from this observable array. Iterate a
    // stable snapshot so adjacent siblings cannot be skipped as indexes shift.
    const children = [...this.#children]
    const errors: unknown[] = []
    children.forEach(child => {
      try {
        child.remove(purge, useMutator)
      } catch (error) {
        errors.push(error)
      }
    })
    if (this.#children.length > 0) {
      errors.push(new Error('Node children removal left one or more linked children'))
    }
    if (errors.length) throw new AggregateError(errors, 'Node children removal completed with errors')
  }

  private purged = false

  @action
  purge() {
    if (this.purged) return
    this.assertChildrenMutationAllowed('nodeChildren.purge')
    throw new Error('Cannot nodeChildren.purge; cleanup must be coordinated by its owning Node')
  }

  #purgeInternal(teardown: boolean, visited = new Set<Node>()): void {
    if (this.purged && !teardown) return
    if (!this.purged && !teardown) {
      this.assertChildrenMutationAllowed('nodeChildren.purge')
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
    sealLifecycleMutations(this, 'node children generation is disposed')
    for (const child of this.#children) cleanup(() => runInternalLifecycleTeardown<[Set<Node>]>(child, visited))
    sealLifecycleMutations(this.emitter, 'node children event bus generation is disposed')
    cleanup(() => runInternalLifecycleTeardown(this.emitter))
    if (errors.length) throw new AggregateError(errors, 'Node children disposal completed with errors')
  }

  internalInitParent() {
    this.assertChildrenMutationAllowed('nodeChildren.internalInitParent')
    for (const child of this.#children) {
      child.internalSetParent(this.owner)
    }
  }

  @action
  internalUnlinkChild(node: Node) {
    this.assertChildrenMutationAllowed('nodeChildren.internalUnlinkChild')
    const i = this.#children.indexOf(node)
    if (i < 0) {
      return false
    }

    this.owner.document.markSchemaMutation()
    this.#children.splice(i, 1)
    node.internalUnlinkParent()
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
    this.assertChildrenMutationAllowed('nodeChildren.internalDelete')
    const errors: unknown[] = []
    if (node.isParental) {
      try {
        node.children?.remove(purge, useMutator)
      } catch (error) {
        errors.push(error)
      }
    }

    const index = this.#children.map(d => d.id).indexOf(node.id)
    const { document } = node
    const designer = document.designer
    const formerParent = node.parent
    try {
      node.unlink()
    } catch (error) {
      errors.push(error)
    }
    if (useMutator) {
      try {
        formerParent?.didDropOut(node)
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      document.designer.selection.remove(node.id)
    } catch (error) {
      errors.push(error)
    }
    if (purge) {
      try {
        runInternalLifecycleTeardown(node)
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      designer.postEvent(NODE_EVENT.REMOVE, { index, node })
    } catch (error) {
      errors.push(error)
    }
    try {
      this.emitter.emit(NODE_CHILDREN_EVENT.CHANGE, {
        type: 'delete',
        node,
      })
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw new AggregateError(errors, 'Node removal completed with errors')
    return false
  }

  get(index: number) {
    if (index < 0 || index >= this.#children.length) {
      return null
    }

    return this.#children[index]
  }

  has(node: Node) {
    return this.#children.indexOf(node) > -1
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
    this.assertChildrenMutationAllowed('nodeChildren.internalInsert')
    const children = this.#children
    const i = at === null || at === -1 ? this.#children.length : at!

    const index = this.#children.indexOf(node)

    if (node.parent) {
      const designer = node.document?.designer
      designer.postEvent(NODE_EVENT.REMOVE, {
        index: node.index,
        node,
      })
    }

    // node is not in the children
    if (index < 0) {
      const candidate = children.slice()
      candidate.splice(i < candidate.length ? i : candidate.length, 0, node)
      this.#validateChildren(candidate)
      this.owner.document.markSchemaMutation()
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

      this.owner.document.markSchemaMutation()
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
    this.assertChildrenMutationAllowed('nodeChildren.mergeChildren')
    const runCallback = <T>(callback: () => T): T =>
      withoutProjectMutationAuthority(this.owner.document.project, callback)
    let changed = false
    if (remover) {
      const willRemove = this.#children.filter((node, index) => runCallback(() => remover(node, index)))
      if (willRemove.length > 0) {
        willRemove.forEach(node => {
          const i = this.#children.map(d => d.id).indexOf(node.id)
          if (i > -1) {
            this.#children.splice(i, 1)
            node.remove(false)
          }
        })
        changed = true
      }
    }
    if (adder) {
      const items = runCallback(() => adder(Object.freeze([...this.#children]) as Node[]))
      if (items && items.length > 0) {
        items.forEach(child => {
          const node = this.owner.document?.createNode(child)
          const candidate = [...this.#children, node]
          this.#validateChildren(candidate)
          this.#children.push(node)
          node.internalSetParent(this.owner)
          const designer = node.document?.designer
          designer.postEvent(NODE_EVENT.ADD, { node })
        })
        changed = true
      }
    }
    if (sorter) {
      this.#children.sort((first, second) => runCallback(() => sorter(first, second)))
      changed = true
    }
    if (changed) {
      this.owner.document.markSchemaMutation()
      this.emitter.emit(NODE_CHILDREN_EVENT.CHANGE)
    }
  }

  indexOf(node: Node): number {
    return this.#children.map(d => d.id).indexOf(node.id)
  }

  find(f: (value: Node, index: number, obj: Node[]) => unknown) {
    const snapshot = this.children
    return snapshot.find((value, index) =>
      withoutProjectMutationAuthority(this.owner.document.project, () => f(value, index, snapshot as Node[])),
    )
  }

  forEach(fn: (node: Node, index: number) => void): void {
    this.#children.forEach((item: Node, index: number) => {
      withoutProjectMutationAuthority(this.owner.document.project, () => fn(item, index))
    })
  }

  reverse(): readonly Node[] {
    this.assertChildrenMutationAllowed('nodeChildren.reverse')
    if (this.#children.length > 1) this.owner.document.markSchemaMutation()
    this.#children.reverse()
    return this.children
  }

  map(fn: (node: Node, index: number) => Node): Node[] {
    return this.#children.map((item: Node, index: number): Node => {
      return withoutProjectMutationAuthority(this.owner.document.project, () => fn(item, index))
    })
  }

  every(fn: (node: Node, index: number) => boolean): boolean {
    return this.#children.every((item: Node, index: number) => {
      return withoutProjectMutationAuthority(this.owner.document.project, () => fn(item, index))
    })
  }

  some(fn: (node: Node, index: number) => boolean): boolean {
    return this.#children.some((item: Node, index: number) => {
      return withoutProjectMutationAuthority(this.owner.document.project, () => fn(item, index))
    })
  }

  filter(fn: (node: Node, index: number) => boolean): Node[] {
    return this.#children.filter((item: Node, index: number) => {
      return withoutProjectMutationAuthority(this.owner.document.project, () => fn(item, index))
    })
  }

  reduce(fn: (acc: any, cur: Node) => any, initialValue: any) {
    return this.#children.reduce((acc: any, cur: Node) => {
      return withoutProjectMutationAuthority(this.owner.document.project, () => fn(acc, cur))
    }, initialValue)
  }

  onChange(listener: (info?: { type: string; node: Node }) => void) {
    this.assertChildrenGenerationActive('nodeChildren.onChange')
    this.emitter.on(NODE_CHILDREN_EVENT.CHANGE, listener)
    return () => {
      this.emitter.off(NODE_CHILDREN_EVENT.CHANGE, listener)
    }
  }

  onInsert(listener: (node: Node) => void) {
    this.assertChildrenGenerationActive('nodeChildren.onInsert')
    this.emitter.on(NODE_CHILDREN_EVENT.INSERT, listener)
    return () => {
      this.emitter.off(NODE_CHILDREN_EVENT.INSERT, listener)
    }
  }
}
