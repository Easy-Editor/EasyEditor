import { action, computed, observable, runInAction } from 'mobx'
import { DESIGNER_EVENT, type SettingTopEntry } from '../../designer'
import { type NodeSchema, TRANSFORM_STAGE } from '../../types'
import { createEventBus, isObject, uniqueId } from '../../utils'
import type { Document } from '../document'
import { type PropValue, type PropsMap, isJSExpression } from '../prop/prop'
import { Props, getConvertedExtraKey } from '../prop/props'
import { NodeChildren } from './node-children'

export enum NODE_EVENT {
  ADD = 'node:add',
  REMOVE = 'node:remove',
  VISIBLE_CHANGE = 'node:visible.change',
  LOCK_CHANGE = 'node:lock.change',
  PROP_CHANGE = 'node:prop.change',
}

export class Node<Schema extends NodeSchema = NodeSchema> {
  protected emitter = createEventBus('Node')

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
  @computed
  get index() {
    if (!this.parent) {
      return -1
    }

    return this.parent!.children!.indexOf(this)
  }

  /**
   * z-index level of this node
   */
  @computed
  get zLevel(): number {
    if (this._parent) {
      return this._parent.zLevel + 1
    }
    return 0
  }

  @computed
  get title() {
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

  _settingEntry: SettingTopEntry

  get settingEntry() {
    if (this._settingEntry) return this._settingEntry
    this._settingEntry = this.document.designer.createSettingEntry([this])
    return this._settingEntry
  }

  constructor(
    readonly document: Document,
    Schema: Schema,
  ) {
    const { id, componentName, children, props, ...extras } = Schema

    this.id = id || uniqueId('node')
    this.componentName = componentName
    this._children = new NodeChildren(this, this.initialChildren(children))
    this.props = new Props(this, props, extras)
    this.props.merge(this.upgradeProps(this.initProps(props || {})), this.upgradeProps(extras))
    this.initBuiltinProps()

    this.onVisibleChange(visible => {
      this.document.designer.postEvent(DESIGNER_EVENT.NODE_VISIBLE_CHANGE, this, visible)
    })
    this.onLockChange(locked => {
      this.document.designer.postEvent(DESIGNER_EVENT.NODE_LOCK_CHANGE, this, locked)
    })
    this.onChildrenChange(info => {
      this.document.designer.postEvent(DESIGNER_EVENT.NODE_CHILDREN_CHANGE, {
        type: info?.type,
        node: this,
      })
    })
  }

  import(data: Schema, checkId = false) {
    const { componentName, id, children, props, ...extras } = data

    this.props.import(props, extras)
    this._children?.import(children, checkId)
  }

  export<T = NodeSchema>(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE): T {
    const baseSchema: any = {
      componentName: this.componentName,
    }

    if (stage !== TRANSFORM_STAGE.CLONE) {
      baseSchema.id = this.id
    }
    if (stage === TRANSFORM_STAGE.RENDER) {
      baseSchema.docId = this.document.id
    }

    const { props, extras } = this.props.export()

    const schema: any = {
      ...baseSchema,
      props: props ? this.document.designer.transformProps(props, this, stage) : undefined,
      ...(extras ? this.document.designer.transformProps(extras, this, stage) : {}),
    }

    if (this.isParental && this.children && this.children.size > 0) {
      schema.children = this.children.export(stage)
    }

    return schema
  }

  purge() {
    if (this.purged) {
      return
    }
    this.purged = true
    this.props.purge()
  }

  toData() {
    return this.export()
  }

  /**
   * get node schema
   */
  get schema(): Schema {
    return this.export(TRANSFORM_STAGE.SAVE)
  }

  set schema(data: Schema) {
    runInAction(() => this.import(data))
  }

  initBuiltinProps() {
    this.props.has(getConvertedExtraKey('hidden')) || this.props.add(getConvertedExtraKey('hidden'), false)
    this.props.has(getConvertedExtraKey('locked')) || this.props.add(getConvertedExtraKey('locked'), false)
    this.props.has(getConvertedExtraKey('title')) || this.props.add(getConvertedExtraKey('title'), '')
    this.props.has(getConvertedExtraKey('loop')) || this.props.add(getConvertedExtraKey('loop'), undefined)
    this.props.has(getConvertedExtraKey('condition')) || this.props.add(getConvertedExtraKey('condition'), true)
  }

  private initProps(props: PropsMap) {
    return this.document.designer.transformProps(props, this, TRANSFORM_STAGE.INIT)
  }

  private upgradeProps(props: PropsMap) {
    return this.document.designer.transformProps(props, this, TRANSFORM_STAGE.UPGRADE)
  }

  /**
   * relate to componentMeta.advanced.initialChildren
   */
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

  /**
   * link to componentMeta.advanced.callbacks.onNodeAdd
   */
  didDropIn(dragNode: Node) {
    const { callbacks } = this.componentMeta.advanced
    if (callbacks?.onNodeAdd) {
      callbacks?.onNodeAdd.call(this, dragNode, this)
    }
    if (this._parent) {
      this._parent.didDropIn(dragNode)
    }
  }

  /**
   * link to componentMeta.advanced.callbacks.onNodeRemove
   */
  didDropOut(dragNode: Node) {
    const { callbacks } = this.componentMeta.advanced
    if (callbacks?.onNodeRemove) {
      callbacks?.onNodeRemove.call(this, dragNode, this)
    }
    if (this._parent) {
      this._parent.didDropOut(dragNode)
    }
  }

  /**
   * link to componentMeta.advanced.callbacks.onSelectHook
   */
  canSelect() {
    const onSelectHook = this.componentMeta?.advanced?.callbacks?.onSelectHook
    const canSelect = typeof onSelectHook === 'function' ? onSelectHook(this) : true
    return canSelect
  }

  /**
   * link to componentMeta.advanced.callbacks.onClickHook
   */
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

  get isContainer(): boolean {
    return this.componentMeta.isContainer
  }

  get isRoot() {
    return this.document.rootNode === this
  }

  /**
   * whether child nodes are included
   */
  get isParental() {
    return !this.isLeaf
  }

  /**
   * whether this node is a leaf node
   */
  get isLeaf() {
    return this._children ? this._children.isEmpty() : true
  }

  toString() {
    return this.id
  }

  hide(flag = true) {
    this.setExtraProp('hidden', flag)
    this.emitter.emit(NODE_EVENT.VISIBLE_CHANGE, flag)
  }

  get hidden() {
    return this.getExtraPropValue('hidden') as boolean
  }

  get isHidden() {
    return this.hidden
  }

  lock(flag = true) {
    this.setExtraProp('locked', flag)
    this.emitter.emit(NODE_EVENT.LOCK_CHANGE, flag)
  }

  get locked() {
    return this.getExtraPropValue('locked') as boolean
  }

  get isLocked() {
    return this.locked
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
    if (isJSExpression(value)) {
      return true
    }
    return false
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

  clearExtraPropValue(key: string): void {
    this.getProp(getConvertedExtraKey(key), false)?.unset()
  }

  clearPropValue(path: string): void {
    this.getProp(path, false)?.unset()
  }

  mergeProps(props: PropsMap) {
    this.props.merge(props)
  }

  setProps(props?: PropsMap | Props | null) {
    if (props instanceof Props) {
      this.props = props
      return
    }
    this.props.import(props)
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
   * unlink this node from its parent and document
   */
  unlink() {
    if (this.parent) {
      this.parent.children!.unlinkChild(this)
    }
    this.internalUnlinkParent()
    this.document.unlinkNode(this)
  }

  /**
   * migrate this node to a new parent
   */
  migrate(newParent: Node) {
    this.document.migrateNode(this, newParent)
  }

  /**
   * if the node is linked in the document tree
   */
  @computed
  get isLinked() {
    let current: Node | null = this

    while (current) {
      if (current.isRoot) {
        return true
      }
      current = current.parent
    }

    return false
  }

  /**
   * insert a node at a specific position or a reference node
   */
  insert(node: Node, ref?: Node | number, useMutator = true) {
    if (ref !== undefined && typeof ref === 'number') {
      const nodeInstance = ensureNode(node, this.document)
      this.children?.internalInsert(nodeInstance, ref, useMutator)
    } else {
      this.insertAfter(node, ref as Node, useMutator)
    }
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

  isValidComponent() {
    const allComponents = this.document.designer.materials.componentsMap
    if (allComponents && allComponents[this.componentName]) {
      return true
    }
    return false
  }

  /**
   * 判断当前节点是否为远程物料组件
   */
  isRemoteMaterial() {
    return this.componentMeta.isRemoteMaterial()
  }

  @computed
  get componentMeta() {
    return this.document.getComponentMeta(this.componentName)
  }

  @computed
  get propsData() {
    return this.props.export(TRANSFORM_STAGE.SERIALIZE).props || null
  }

  getRect() {
    if (this.isRoot) {
      return this.document.simulator?.viewport.contentBounds || null
    }
    return this.document.simulator?.computeRect(this) || null
  }

  getDOMNode() {
    return this.document.simulator?.getComponentInstances(this)
  }

  /**
   * use schema to update this node
   */
  wrapWith(schema: Schema) {
    const wrappedNode = this.replaceWith({ ...schema, children: [this.export()] })
    return wrappedNode?.children!.get(0)
  }

  /**
   * replace this node with a new node
   */
  replaceWith(schema: Schema, migrate = false) {
    // reuse the same id? or replaceSelection
    schema = Object.assign({}, migrate ? this.export() : {}, schema)
    return this.parent?.replaceChild(this, schema)
  }

  /**
   * replace a child node with a new node
   */
  replaceChild(node: Node, data: Schema): Node | null {
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

  mergeChildren(
    remover: (node: Node, idx: number) => any,
    adder: (children: Node[]) => Schema[] | null,
    sorter: (firstNode: Node, secondNode: Node) => any,
  ) {
    this.children?.mergeChildren(remover, adder, sorter)
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

/**
 * get the top node of the same zLevel
 */
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

  if (!node1.isParental || !node2.parent) {
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
  let Schema: NodeSchema
  if (isNode(thing) && copy) {
    Schema = thing.export()
    node = container.document?.createNode(Schema)
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

/**
 * get the closest node that satisfies the condition
 */
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

/**
 * get the closest clickable node
 */
export const getClosestClickableNode = (currentNode: Node | undefined | null, event: MouseEvent) => {
  let node = currentNode
  while (node) {
    // check if the current node is clickable
    let canClick = node.canClick(event)
    const lockedNode = getClosestNode(node, n => {
      // if the current node is locked, start searching from the parent node
      return !n.locked
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

/**
 * ensure the node is a Node instance
 */
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
