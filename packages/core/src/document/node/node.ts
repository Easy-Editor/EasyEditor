import { action, computed, observable, runInAction } from 'mobx'
import { DESIGNER_EVENT, type SettingTopEntry } from '../../designer'
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
import { isDocumentMutationBoundaryActive } from '../../project/document-mutation-boundary'
import { withoutProjectMutationAuthority } from '../../project/mutation-authority'
import { type NodeSchema, type NpmInfo, TRANSFORM_STAGE } from '../../types'
import { type EventBus, isObject, isRemoteComponent, uniqueId } from '../../utils'
import type { Document } from '../document'
import { type PropValue, type PropsMap, isJSExpression } from '../prop/prop'
import { Props, getConvertedExtraKey } from '../prop/props'
import { NodeChildren } from './node-children'

export interface NodeModelOptions {
  /** Disable executable material reducers and initialChildren hooks. */
  readonly invokeMaterialHooks?: boolean
}

export enum NODE_EVENT {
  ADD = 'node:add',
  REMOVE = 'node:remove',
  VISIBLE_CHANGE = 'node:visible.change',
  LOCK_CHANGE = 'node:lock.change',
  PROP_CHANGE = 'node:prop.change',
}

export class Node<Schema extends NodeSchema = NodeSchema> {
  protected emitter: EventBus

  readonly isNode = true

  readonly id: string

  readonly componentName: string

  protected _children: NodeChildren | null

  @observable.ref accessor #parent: Node | null = null

  get parent() {
    return this.#parent
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
    if (this.#parent) {
      return this.#parent.zLevel + 1
    }
    return 0
  }

  @computed
  get title() {
    const t = this.getExtraProp('title', false)
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

  #purged = false

  #assertNodeMutationAllowed(origin: string): void {
    assertLifecycleMutationAllowed(this, origin)
    this.document.project.assertDocumentMutationAllowed(this.document)
  }

  #assertNodeGenerationActive(origin: string): void {
    assertLifecycleMutationAllowed(this, origin)
    this.document.project.assertDocumentGenerationActive(this.document)
  }

  /**
   * 是否已销毁
   */
  get isPurged() {
    return this.#purged
  }

  #props: Props

  get props(): Props {
    return this.#props
  }

  set props(value: Props) {
    this.#assertNodeMutationAllowed('node.props')
    if (this.#props && isDocumentMutationBoundaryActive(this.document.project, this.document)) {
      throw new Error('Raw Node.props mutation is blocked while a transaction is active')
    }
    if (!(value instanceof Props) || value.owner !== this) {
      throw new Error('A Node can only own its canonical Props identity')
    }
    if (this.#props === value) return
    this.document.markSchemaMutation()
    this.#props = value
  }

  #settingEntry: SettingTopEntry | undefined

  get settingEntry() {
    this.#assertNodeGenerationActive('node.settingEntry')
    if (this.#settingEntry) return this.#settingEntry
    this.#settingEntry = this.document.designer.createSettingEntry([this])
    return this.#settingEntry
  }

  /**
   * 刷新组件配置项
   */
  @action
  refreshSettingEntry() {
    this.#assertNodeMutationAllowed('node.refreshSettingEntry')
    if (this.#settingEntry) {
      this.#settingEntry.purge()
      this.#settingEntry = undefined
    }
    // 重置当前 setting，用于升级版本后配置更新
    const { settingsManager } = this.document.designer
    settingsManager._sessionId = ''
    settingsManager.setup([this])
  }

  constructor(
    readonly document: Document,
    Schema: Schema,
    options: NodeModelOptions = {},
  ) {
    inheritLifecycleMutationGuard(document, this)
    installLifecycleTeardownOperation(this, (visited?: Set<Node>) => this.#purgeInternal(true, visited))
    inheritEngineTeardownOwnership(document.project, this)
    this.emitter = createDesignerEventBus(document.designer, 'Node')
    inheritEngineTeardownOwnership(document.project, this.emitter)
    const { id, componentName, children, props, ...extras } = Schema

    this.id = id || uniqueId('node')
    this.componentName = componentName
    lockReadonlyProperties(this, ['componentName', 'document', 'emitter', 'id'])
    lockPrototypeAccessors(this, ['children', 'parent', 'props'])
    try {
      this.props = new Props(this, props, extras)
      if (options.invokeMaterialHooks !== false) {
        this.props.merge(this.upgradeProps(this.initProps(props || {})), this.upgradeProps(extras))
      }
      this.initBuiltinProps()
      const initialChildren =
        options.invokeMaterialHooks === false ? this.explicitChildren(children) : this.initialChildren(children)
      this._children = new NodeChildren(this, initialChildren, options)
      this._children.internalInitParent()
      lockReadonlyProperties(this, ['_children'])

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
    } catch (error) {
      this.#abortConstruction(error)
    }
  }

  #abortConstruction(error: unknown): never {
    const cleanupErrors: unknown[] = []
    sealLifecycleMutations(this, 'node construction failed')
    sealLifecycleMutations(this.emitter, 'node construction failed')
    try {
      this.#purgeInternal(true)
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    if (cleanupErrors.length) {
      throw new AggregateError([error, ...cleanupErrors], 'Node construction failed and cleanup reported errors')
    }
    throw error
  }

  import(data: Schema, checkId = false, options: NodeModelOptions = {}) {
    this.#assertNodeMutationAllowed('node.import')
    const { componentName, id, children, props, ...extras } = data

    this.props.import(props, extras)
    this._children?.import(children, checkId, options)
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

  /** Deterministic snapshot that never executes material reducers. */
  exportRaw<T = NodeSchema>(): T {
    const { props, extras } = this.props.export(TRANSFORM_STAGE.SERIALIZE)
    const schema: Record<string, unknown> = {
      componentName: this.componentName,
      id: this.id,
      props: props ?? {},
      ...(extras ?? {}),
    }
    if (this.children && this.children.size > 0) {
      schema.children = this.children.children.map(child => child.exportRaw())
    }
    return schema as T
  }

  purge() {
    if (this.#purged) return
    this.#assertNodeMutationAllowed('node.purge')
    if (this.isRoot) {
      this.document.purge()
      return
    }
    if (this.parent) {
      this.document.removeNode(this)
      return
    }

    const errors: unknown[] = []
    if (this.document.getNode(this.id) === this) {
      try {
        this.document.unlinkNode(this)
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      this.#purgeInternal(false)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw new AggregateError(errors, 'Node disposal completed with errors')
  }

  #purgeInternal(teardown: boolean, visited = new Set<Node>()): void {
    if (visited.has(this)) return
    visited.add(this)
    if (this.#purged && !teardown) return
    if (!this.#purged && !teardown) {
      this.#assertNodeMutationAllowed('node.purge')
      this.document.markSchemaMutation()
    }
    const errors: unknown[] = []
    const cleanup = (operation: () => void): void => {
      try {
        operation()
      } catch (error) {
        errors.push(error)
      }
    }
    if (this._children)
      cleanup(() => runInternalLifecycleTeardown<[Set<Node>]>(this._children as NodeChildren, visited))
    if (this.#props) cleanup(() => runInternalLifecycleTeardown(this.#props))
    if (this.#settingEntry) {
      const settingEntry = this.#settingEntry
      try {
        settingEntry.purge()
        if (this.#settingEntry === settingEntry) this.#settingEntry = undefined
      } catch (error) {
        errors.push(error)
      }
    }
    this.#purged = true
    sealLifecycleMutations(this, 'node generation is disposed')
    sealLifecycleMutations(this.emitter, 'node event bus generation is disposed')
    cleanup(() => runInternalLifecycleTeardown(this.emitter))
    if (errors.length) throw new AggregateError(errors, 'Node disposal completed with errors')
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
          return withoutProjectMutationAuthority(this.document.project, () => initialChildren(this) || [])
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

  private explicitChildren(children: NodeSchema | NodeSchema[] | undefined): NodeSchema[] {
    if (children == null) return []
    return Array.isArray(children) ? children : [children]
  }

  /**
   * link to componentMeta.advanced.callbacks.onNodeAdd
   */
  didDropIn(dragNode: Node) {
    const { callbacks } = this.componentMeta.advanced
    if (callbacks?.onNodeAdd) {
      withoutProjectMutationAuthority(this.document.project, () => callbacks.onNodeAdd?.call(this, dragNode, this))
    }
    if (this.#parent) {
      this.#parent.didDropIn(dragNode)
    }
  }

  /**
   * link to componentMeta.advanced.callbacks.onNodeRemove
   */
  didDropOut(dragNode: Node) {
    const { callbacks } = this.componentMeta.advanced
    if (callbacks?.onNodeRemove) {
      withoutProjectMutationAuthority(this.document.project, () => callbacks.onNodeRemove?.call(this, dragNode, this))
    }
    if (this.#parent) {
      this.#parent.didDropOut(dragNode)
    }
  }

  /**
   * link to componentMeta.advanced.callbacks.onSelectHook
   */
  canSelect() {
    const onSelectHook = this.componentMeta?.advanced?.callbacks?.onSelectHook
    const canSelect =
      typeof onSelectHook === 'function'
        ? withoutProjectMutationAuthority(this.document.project, () => onSelectHook(this))
        : true
    return canSelect
  }

  /**
   * link to componentMeta.advanced.callbacks.onClickHook
   */
  canClick(e: MouseEvent) {
    const onClickHook = this.componentMeta?.advanced?.callbacks?.onClickHook
    const canClick =
      typeof onClickHook === 'function'
        ? withoutProjectMutationAuthority(this.document.project, () => onClickHook(e, this))
        : true
    return canClick
  }

  select() {
    this.#assertNodeGenerationActive('node.select')
    this.document.designer.selection.select(this.id)
  }

  hover(flag = true) {
    this.#assertNodeGenerationActive('node.hover')
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
    this.emitter.emit(NODE_EVENT.VISIBLE_CHANGE, !flag)
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
    if (createIfNone) this.#assertNodeMutationAllowed('node.getProp')
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

  mergeProps(props: PropsMap, extras?: PropsMap) {
    this.props.merge(props, extras)
  }

  setProps(props?: PropsMap | Props | null) {
    if (props instanceof Props) {
      if (this.props === props) return
      if (props.owner !== this) throw new Error('A Node cannot adopt foreign Props identity')
      if (isDocumentMutationBoundaryActive(this.document.project, this.document)) {
        throw new Error('Raw Node.props mutation is blocked while a transaction is active')
      }
      runInternalLifecycleTeardown(this.props)
      this.props = props
      return
    }
    this.props.import(props)
  }

  internalSetParent(parent: Node | null, useMutator = false) {
    this.#assertNodeMutationAllowed('node.internalSetParent')
    if (parent) {
      if (parent.document !== this.document) {
        throw new Error('A Node parent must belong to the same Document')
      }
      if (this.document.getNode(this.id) !== this) {
        throw new Error('An unregistered Node cannot be attached to a parent')
      }
      if (!parent.children?.has(this)) {
        throw new Error('A Node parent change must be coordinated by the parent NodeChildren collection')
      }
      const visited = new Set<Node>()
      let ancestor: Node | null = parent
      while (ancestor) {
        if (ancestor === this) throw new Error('A Node parent change cannot introduce a cycle')
        if (visited.has(ancestor)) throw new Error('The target parent ancestry already contains a cycle')
        visited.add(ancestor)
        ancestor = ancestor.parent
      }
    }
    if (this.#parent === parent) {
      return
    }
    this.document.markSchemaMutation()

    const formerParent = this.#parent
    if (formerParent) {
      formerParent.children?.unlinkChild(this)
    }
    if (useMutator) {
      formerParent?.didDropOut(this)
    }

    this.#parent = parent
    if (parent) {
      if (useMutator) {
        parent.didDropIn(this)
      }
    }
  }

  internalUnlinkParent() {
    this.#assertNodeMutationAllowed('node.internalUnlinkParent')
    if (this.#parent?.children?.has(this)) {
      throw new Error('A Node parent must be unlinked from NodeChildren before clearing its parent identity')
    }
    if (!this.#parent) return
    this.document.markSchemaMutation()
    this.#parent = null
  }

  /**
   * unlink this node from its parent and document
   */
  unlink() {
    this.#assertNodeMutationAllowed('node.unlink')
    const errors: unknown[] = []
    const parent = this.parent
    if (parent) {
      try {
        parent.children!.unlinkChild(this)
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      this.internalUnlinkParent()
    } catch (error) {
      errors.push(error)
    }
    try {
      this.document.unlinkNode(this)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw new AggregateError(errors, 'Node unlink completed with errors')
  }

  /**
   * migrate this node to a new parent
   */
  migrate(newParent: Node) {
    this.#assertNodeMutationAllowed('node.migrate')
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
    this.#assertNodeMutationAllowed('node.remove')
    if (!this.parent) {
      this.document.removeNode(this)
      return
    }

    const errors: unknown[] = []
    try {
      this.document.designer.postEvent(DESIGNER_EVENT.NODE_REMOVE, {
        node: this,
        index: this.index,
      })
    } catch (error) {
      errors.push(error)
    }
    try {
      this.parent.children?.internalDelete(this, purge, useMutator)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'Node removal completed with errors')
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

  get isRemote() {
    return this.isRemoteComponent()
  }

  /**
   * 获取用于物料使用计数追踪的 key
   * 对于远程组件返回版本化名称（如 "AreaChart@1.0.0"）
   * 对于本地组件返回原始名称
   */
  get materialUsageKey(): string {
    if (this.isRemote) {
      const version = this.getExtraPropValue('npm.version')
      return `${this.componentName}@${version}`
    }
    return this.componentName
  }

  /**
   * 判断当前节点是否为远程物料组件
   */
  isRemoteComponent() {
    const npm = this.getExtraPropValue('npm') as NpmInfo
    return isRemoteComponent({ npm })
  }

  @computed
  get componentMeta() {
    let componentName = this.componentName
    if (this.isRemote) {
      componentName = this.materialUsageKey
    }

    return this.document.getComponentMeta(componentName)
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
    this.#assertNodeGenerationActive('node.onVisibleChange')
    this.emitter.on(NODE_EVENT.VISIBLE_CHANGE, listener)

    return () => {
      this.emitter.off(NODE_EVENT.VISIBLE_CHANGE, listener)
    }
  }

  onLockChange(listener: (flag: boolean) => void) {
    this.#assertNodeGenerationActive('node.onLockChange')
    this.emitter.on(NODE_EVENT.LOCK_CHANGE, listener)

    return () => {
      this.emitter.off(NODE_EVENT.LOCK_CHANGE, listener)
    }
  }

  onChildrenChange(listener: (info?: { type: string; node: Node }) => void) {
    this.#assertNodeGenerationActive('node.onChildrenChange')
    return this.children?.onChange(listener)
  }

  emitPropChange(prop: any) {
    this.#assertNodeGenerationActive('node.emitPropChange')
    this.emitter.emit(NODE_EVENT.PROP_CHANGE, prop)
  }

  onPropChange(listener: (info: any) => void) {
    this.#assertNodeGenerationActive('node.onPropChange')
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
  if (isNode(node)) {
    if (node.document !== document || document.getNode(node.id) !== node) {
      throw new Error('Cannot use a foreign or unregistered Node identity')
    }
  } else {
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
