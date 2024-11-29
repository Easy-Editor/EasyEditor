import type { EventBus } from '../../utils'
import type { Document } from '../document'
import type { CompositeValue, PropValue } from '../prop/prop'

import { action, computed, observable, runInAction } from 'mobx'
import { DESIGNER_EVENT } from '../..'
import { TRANSFORM_STAGE } from '../../types'
import { createEventBus, uniqueId } from '../../utils'
import { isObject } from '../prop/prop'
import { Props, type PropsSchema, getConvertedExtraKey } from '../prop/props'
import { NodeChildren } from './node-children'

export interface NodeSchema {
  id?: string

  /** title */
  title?: string

  componentName: string

  /** sub nodes */
  children?: NodeSchema[]

  /** props */
  props?: PropsSchema

  /** render condition */
  condition?: CompositeValue

  /** loop data */
  loop?: CompositeValue

  /** hidden */
  isHidden?: boolean

  /** locked */
  isLocked?: boolean

  [key: string]: any
}

export enum NODE_EVENT {
  ADD = 'node:add',
  REMOVE = 'node:remove',
  VISIBLE_CHANGE = 'node:visible.change',
  LOCK_CHANGE = 'node:lock.change',
  PROP_CHANGE = 'node:prop.change',
}

export class Node {
  protected emitter: EventBus

  readonly isNode = true

  readonly id: string

  readonly componentName: string

  protected _children: NodeChildren | null

  @observable.ref private accessor _parent: Node | null = null

  get parent() {
    return this._parent
  }

  get children() {
    return this._children
  }

  get childrenNodes() {
    return this._children ? this._children.children : []
  }

  /**
   * if the node is the root node or not linked, return -1
   */
  @computed get index() {
    if (!this.parent) {
      return -1
    }

    return this.parent!.children!.indexOf(this)
  }

  /**
   * z-index level of this node
   */
  @computed get zLevel(): number {
    if (this._parent) {
      return this._parent.zLevel + 1
    }
    return 0
  }

  @computed get title() {
    const t = this.getExtraProp('title')
    if (t) {
      const v = t.getAsString()
      if (v) {
        return v
      }
    }
    return this.componentMeta.title
  }

  get icon() {
    return this.componentMeta.icon
  }

  private purged = false

  /**
   * 是否已销毁
   */
  get isPurged() {
    return this.purged
  }

  props: Props

  getChildren() {
    return this.children
  }

  getComponentName() {
    return this.componentName
  }

  getParent() {
    return this.parent
  }

  getId() {
    return this.id
  }

  getIndex() {
    return this.index
  }

  getNode() {
    return this
  }

  getRoot() {
    return this.document.rootNode
  }

  getProps() {
    return this.props
  }

  constructor(
    readonly document: Document,
    nodeSchema: NodeSchema,
  ) {
    const { id, componentName, children, props, ...extras } = nodeSchema

    this.emitter = createEventBus('Node')
    this.id = id || uniqueId('node')
    this.componentName = componentName
    this._children = new NodeChildren(this, this.initialChildren(children))
    this._children.internalInitParent()
    this.props = new Props(this, props, extras)
    this.props.merge(this.upgradeProps(this.initProps(props || {})), this.upgradeProps(extras))
    this.initBuiltinProps()

    this.onVisibleChange((visible: boolean) => {
      this.document.designer.postEvent(DESIGNER_EVENT.NODE_VISIBLE_CHANGE, this, visible)
    })
    this.onChildrenChange(info => {
      this.document.designer.postEvent(DESIGNER_EVENT.NODE_CHILDREN_CHANGE, {
        type: info?.type,
        node: this,
      })
    })
  }

  purge() {
    if (this.purged) {
      return
    }
    this.purged = true
    this.props.purge()
  }

  private initBuiltinProps() {
    this.props.has(getConvertedExtraKey('isHidden')) || this.props.add(getConvertedExtraKey('isHidden'), false)
    this.props.has(getConvertedExtraKey('isLocked')) || this.props.add(getConvertedExtraKey('isLocked'), false)
    this.props.has(getConvertedExtraKey('title')) || this.props.add(getConvertedExtraKey('title'), '')
    this.props.has(getConvertedExtraKey('loop')) || this.props.add(getConvertedExtraKey('loop'), undefined)
    this.props.has(getConvertedExtraKey('condition')) || this.props.add(getConvertedExtraKey('condition'), true)
  }

  private initProps(props: PropsSchema) {
    return this.document.designer.transformProps(props, this, TRANSFORM_STAGE.INIT)
  }

  private upgradeProps(props: PropsSchema) {
    return this.document.designer.transformProps(props, this, TRANSFORM_STAGE.UPGRADE)
  }

  private initialChildren(children: NodeSchema | NodeSchema[] | undefined): NodeSchema[] {
    const { initialChildren } = this.componentMeta.advanced

    if (children == null) {
      if (initialChildren) {
        if (typeof initialChildren === 'function') {
          return initialChildren(this) || []
        }
        return initialChildren
      }
      return []
    }

    if (Array.isArray(children)) {
      return children
    }

    return [children]
  }

  isContainer(): boolean {
    return this.isContainerNode
  }

  get isContainerNode() {
    return this.componentMeta.isContainer
  }

  isRoot() {
    return this.isRootNode
  }

  get isRootNode() {
    return this.document.rootNode === this
  }

  /**
   * whether child nodes are included
   */
  isParental() {
    return this.isParentalNode
  }

  get isParentalNode(): boolean {
    return !this.isLeafNode
  }

  /**
   * whether this node is a leaf node
   * TODO: 这种方式判断是否是叶子节点，感觉不太对
   */
  isLeaf() {
    return this.isLeafNode
  }

  get isLeafNode(): boolean {
    return this._children ? this._children.isEmpty() : true
  }

  didDropIn(dragNode: Node) {
    const { callbacks } = this.componentMeta.advanced
    if (callbacks?.onNodeAdd) {
      callbacks?.onNodeAdd.call(this, dragNode, this)
    }
    if (this._parent) {
      this._parent.didDropIn(dragNode)
    }
  }

  didDropOut(dragNode: Node) {
    const { callbacks } = this.componentMeta.advanced
    if (callbacks?.onNodeRemove) {
      callbacks?.onNodeRemove.call(this, dragNode, this)
    }
    if (this._parent) {
      this._parent.didDropOut(dragNode)
    }
  }

  hide(flag = true) {
    this.setExtraProp('isHidden', flag)
    this.emitter.emit(NODE_EVENT.VISIBLE_CHANGE, flag)
  }

  isHidden() {
    return this.getExtraPropValue('isHidden') as boolean
  }

  lock(flag = true) {
    this.setExtraProp('isLocked', flag)
    this.emitter.emit(NODE_EVENT.LOCK_CHANGE, flag)
  }

  isLocked() {
    return this.getExtraPropValue('isLocked') as boolean
  }

  getProp(path: string, createIfNone = true) {
    return this.props.query(path, createIfNone) || null
  }

  getExtraProp(key: string, createIfNone = true) {
    return this.getProp(getConvertedExtraKey(key), createIfNone)
  }

  setExtraProp(key: string, value: PropValue) {
    this.getProp(getConvertedExtraKey(key), true)?.setValue(value)
  }

  getPropValue(path: string) {
    return this.getProp(path, false)?.value
  }

  setPropValue(path: string, value: PropValue) {
    this.getProp(path, true)!.setValue(value)
  }

  getExtraPropValue(key: string) {
    return this.getPropValue(getConvertedExtraKey(key))
  }

  setExtraPropValue(key: string, value: PropValue) {
    this.setPropValue(getConvertedExtraKey(key), value)
  }

  clearPropValue(path: string): void {
    this.getProp(path, false)?.unset()
  }

  internalSetParent(parent: Node | null, useMutator = false) {
    if (this._parent === parent) {
      return
    }

    if (this._parent) {
      this._parent.children?.unlinkChild(this)
    }
    if (useMutator) {
      this._parent?.didDropOut(this)
    }

    if (parent) {
      this._parent = parent

      if (useMutator) {
        parent.didDropIn(this)
      }
    }
  }

  internalUnlinkParent() {
    this._parent = null
  }

  /**
   * unlink this node from its parent
   */
  unlink() {
    if (this.parent) {
      this.parent.children!.unlinkChild(this)
    }
    this.internalUnlinkParent()
    this.document.unlinkNode(this)
  }

  /**
   * insert a node at a specific position
   * @param node
   */
  insert(node: Node, ref?: Node, useMutator = true) {
    this.insertAfter(node, ref, useMutator)
  }

  /**
   * insert a node before a reference node(in current node's children)
   */
  insertBefore(node: Node, ref?: Node, useMutator = true) {
    const nodeInstance = ensureNode(node, this.document)
    this.children?.internalInsert(nodeInstance, ref ? ref.index : null, useMutator)
  }

  /**
   * insert a node after a reference node(in current node's children)
   */
  insertAfter(node: Node, ref?: Node, useMutator = true) {
    const nodeInstance = ensureNode(node, this.document)
    this.children?.internalInsert(nodeInstance, ref ? (ref.index || 0) + 1 : null, useMutator)
  }

  @action
  remove(purge = true, useMutator = true) {
    if (this.parent) {
      this.document.designer.postEvent(DESIGNER_EVENT.NODE_REMOVE, {
        node: this,
        index: this.index,
      })
      this.parent.children?.internalDelete(this, purge, useMutator)
    }
  }

  removeChild(node: Node) {
    this.children?.delete(node)
  }

  /**
   * if the node is linked in the document tree
   */
  @computed get isLinked() {
    let current: Node | null = this

    while (current) {
      if (current.isRoot()) {
        return true
      }
      current = current.parent
    }

    return false
  }

  canSelect() {
    const onSelectHook = this.componentMeta?.advanced?.callbacks?.onSelectHook
    const canSelect = typeof onSelectHook === 'function' ? onSelectHook(this) : true
    return canSelect
  }

  canClick(e: MouseEvent) {
    const onClickHook = this.componentMeta?.advanced?.callbacks?.onClickHook
    const canClick = typeof onClickHook === 'function' ? onClickHook(e, this) : true
    return canClick
  }

  select() {
    this.document.designer.selection.select(this.id)
  }

  hover(flag = true) {
    if (flag) {
      this.document.designer.detecting.capture(this)
    } else {
      this.document.designer.detecting.release(this)
    }
  }

  hasCondition() {
    const v = this.getExtraProp('condition', false)?.getValue()
    return v != null && v !== '' && v !== true
  }

  /**
   * has loop when 1. loop is validArray with length > 1 ; OR  2. loop is variable object
   * @return boolean, has loop config or not
   */
  hasLoop() {
    const value = this.getExtraProp('loop', false)?.getValue()
    if (value === undefined || value === null) {
      return false
    }

    if (Array.isArray(value)) {
      return true
    }
    return false
  }

  isValidComponent() {
    const allComponents = this.document.designer.componentMetaManager.componentsMap
    if (allComponents && allComponents[this.componentName]) {
      return true
    }
    return false
  }

  @computed get componentMeta() {
    return this.document.getComponentMeta(this.componentName)
  }

  @computed get propsData() {
    return this.props.export(TRANSFORM_STAGE.SERIALIZE).props || null
  }

  wrapWith(schema: NodeSchema) {
    const wrappedNode = this.replaceWith({ ...schema, children: [this.export()] })
    return wrappedNode?.children!.get(0)
  }

  replaceWith(schema: NodeSchema, migrate = false) {
    // reuse the same id? or replaceSelection
    schema = Object.assign({}, migrate ? this.export() : {}, schema)
    return this.parent?.replaceChild(this, schema)
  }

  replaceChild(node: Node, data: NodeSchema): Node | null {
    if (this.children?.has(node)) {
      const selected = this.document.designer.selection.has(node.id)

      data.id = undefined
      const newNode = this.document.createNode(data)

      if (!isNode(newNode)) {
        return null
      }

      this.insertBefore(newNode, node, false)
      node.remove(false)

      if (selected) {
        this.document.designer.selection.select(newNode.id)
      }
      return newNode
    }
    return node
  }

  /**
   * check if this node contains another node
   */
  contains(node: Node): boolean {
    return contains(this, node)
  }

  /**
   * get the parent node at a specific depth
   */
  getZLevelTop(zLevel: number) {
    return getZLevelTop(this, zLevel)
  }

  /**
   * compare the position of this node and another node
   *
   *  - 16 thisNode contains otherNode
   *  - 8  thisNode contained_by otherNode
   *  - 2  thisNode before or after otherNode
   *  - 0  thisNode same as otherNode
   */
  comparePosition(otherNode: Node) {
    return comparePosition(this, otherNode)
  }

  /**
   * get next sibling node
   */
  get nextSibling(): Node | null | undefined {
    if (!this.parent) {
      return null
    }
    const { index } = this
    if (typeof index !== 'number') {
      return null
    }
    if (index < 0) {
      return null
    }
    return this.parent.children?.get(index + 1)
  }

  /**
   * get previous sibling node
   */
  get prevSibling(): Node | null | undefined {
    if (!this.parent) {
      return null
    }
    const { index } = this
    if (typeof index !== 'number') {
      return null
    }
    if (index < 1) {
      return null
    }
    return this.parent.children?.get(index - 1)
  }

  /**
   * get node schema
   */
  get schema(): NodeSchema {
    return this.export(TRANSFORM_STAGE.SAVE)
  }

  set schema(data: NodeSchema) {
    runInAction(() => this.import(data))
  }

  import(data: NodeSchema, checkId = false) {
    const { componentName, id, children, props, ...extras } = data

    this.props.import(props, extras)
    if (this.isParental()) {
      this._children?.import(children, checkId)
    }
  }

  toData() {
    return this.export()
  }

  export(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE) {
    const baseSchema: NodeSchema = {
      componentName: this.componentName,
    }

    if (stage !== TRANSFORM_STAGE.CLONE) {
      baseSchema.id = this.id
    }
    if (stage === TRANSFORM_STAGE.RENDER) {
      baseSchema.docId = this.document.id
    }

    const { props, extras } = this.props.export()

    const schema: NodeSchema = {
      ...baseSchema,
      props: props ? this.document.designer.transformProps(props, this, stage) : undefined,
      ...(extras ? this.document.designer.transformProps(extras, this, stage) : {}),
    }

    if (this.isParental() && this.children && this.children.size > 0) {
      schema.children = this.children.export(stage)
    }

    return schema
  }

  mergeChildren(
    remover: (node: Node, idx: number) => any,
    adder: (children: Node[]) => NodeSchema[] | null,
    sorter: (firstNode: Node, secondNode: Node) => any,
  ) {
    this.children?.mergeChildren(remover, adder, sorter)
  }

  getRect() {
    if (this.isRoot()) {
      return this.document.simulator?.viewport.contentBounds || null
    }
    return this.document.simulator?.computeRect(this) || null
  }

  toString() {
    return this.id
  }

  onVisibleChange(listener: (flag: boolean) => void) {
    this.emitter.on(NODE_EVENT.VISIBLE_CHANGE, listener)

    return () => {
      this.emitter.off(NODE_EVENT.VISIBLE_CHANGE, listener)
    }
  }

  onLockChange(listener: (flag: boolean) => void) {
    this.emitter.on(NODE_EVENT.LOCK_CHANGE, listener)

    return () => {
      this.emitter.off(NODE_EVENT.LOCK_CHANGE, listener)
    }
  }

  onChildrenChange(listener: (info?: { type: string; node: Node }) => void) {
    return this.children?.onChange(listener)
  }

  emitPropChange(prop: any) {
    this.emitter.emit(NODE_EVENT.PROP_CHANGE, prop)
  }

  onPropChange(listener: (info: any) => void) {
    this.emitter.on(NODE_EVENT.PROP_CHANGE, listener)
    return () => {
      this.emitter.off(NODE_EVENT.PROP_CHANGE, listener)
    }
  }
}

export const isNode = (node: any): node is Node => {
  return node && node.isNode
}

export const isNodeSchema = (data: any): data is NodeSchema => {
  if (!isObject(data)) {
    return false
  }
  return 'componentName' in data && !data.isNode
}

export const getZLevelTop = (child: Node, zLevel: number): Node | null => {
  let l = child.zLevel
  if (l < zLevel || zLevel < 0) {
    return null
  }
  if (l === zLevel) {
    return child
  }
  let r: any = child
  while (r && l-- > zLevel) {
    r = r.parent
  }
  return r
}

/**
 * check if node1 contains node2
 */
export const contains = (node1: Node, node2: Node): boolean => {
  if (node1 === node2) {
    return true
  }

  if (!node1.isParental() || !node2.parent) {
    return false
  }

  const p = getZLevelTop(node2, node1.zLevel)
  if (!p) {
    return false
  }

  return node1 === p
}

// 16 node1 contains node2
// 8  node1 contained_by node2
// 2  node1 before or after node2
// 0  node1 same as node2
export enum PositionNO {
  Contains = 16,
  ContainedBy = 8,
  BeforeOrAfter = 2,
  TheSame = 0,
}

/**
 * compare the position of two nodes
 */
export const comparePosition = (node1: Node, node2: Node): PositionNO => {
  if (node1 === node2) {
    return PositionNO.TheSame
  }
  const l1 = node1.zLevel
  const l2 = node2.zLevel
  if (l1 === l2) {
    return PositionNO.BeforeOrAfter
  }

  let p: any
  if (l1 < l2) {
    p = getZLevelTop(node2, l1)
    if (p && p === node1) {
      return PositionNO.Contains
    }
    return PositionNO.BeforeOrAfter
  }

  p = getZLevelTop(node1, l2)
  if (p && p === node2) {
    return PositionNO.ContainedBy
  }

  return PositionNO.BeforeOrAfter
}

export const insertChild = (
  container: Node,
  thing: Node | NodeSchema,
  at?: number | null,
  copy?: boolean,
): Node | null => {
  let node: Node | null | undefined
  let nodeSchema: NodeSchema
  if (isNode(thing) && copy) {
    nodeSchema = thing.export()
    node = container.document?.createNode(nodeSchema)
  } else if (isNode(thing)) {
    node = thing
  } else if (isNodeSchema(thing)) {
    node = container.document?.createNode(thing)
  }

  if (isNode(node)) {
    container.children?.insert(node, at)
    return node
  }

  return null
}

export const insertChildren = (
  container: Node,
  nodes: Node[] | NodeSchema[],
  at?: number | null,
  copy?: boolean,
): Node[] => {
  let index = at
  let node: any
  const results: Node[] = []
  while ((node = nodes.pop())) {
    node = insertChild(container, node, index, copy)
    results.push(node)
    index = node.index
  }
  return results
}

export const getClosestNode = (node: Node | null, until: (n: Node) => boolean): Node | undefined => {
  if (!node) {
    return undefined
  }
  if (until(node)) {
    return node
  } else {
    return getClosestNode(node.parent, until)
  }
}

export const getClosestClickableNode = (currentNode: Node | undefined | null, event: MouseEvent) => {
  let node = currentNode
  while (node) {
    // check if the current node is clickable
    let canClick = node.canClick(event)
    const lockedNode = getClosestNode(node, n => {
      // if the current node is locked, start searching from the parent node
      return !!(node?.isLocked ? n.parent?.isLocked : n.isLocked)
    })
    if (lockedNode && lockedNode.getId() !== node.getId()) {
      canClick = false
    }
    if (canClick) {
      break
    }
    // for unclickable nodes, continue searching up
    node = node.parent
  }
  return node
}

export const ensureNode = (node: any, document: Document): Node => {
  let nodeInstance = node
  if (!isNode(node)) {
    if (node.getComponentName) {
      nodeInstance = document.createNode({
        componentName: node.getComponentName(),
      })
    } else {
      nodeInstance = document.createNode(node)
    }
  }
  return nodeInstance
}
