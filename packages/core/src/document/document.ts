import { action, observable } from 'mobx'
import { DESIGNER_EVENT, type Designer, type DropLocation } from '../designer'
import { sealLifecycleMutations } from '../lifecycle/mutation-barrier'
import { createMutationGuardedMapView } from '../lifecycle/mutation-guarded-map'
import { runInternalLifecycleTeardown } from '../lifecycle/teardown-boundary'
import { releaseMaterialUsageDuringTeardown } from '../materials/teardown'
import type { Project } from '../project'
import type { Simulator } from '../simulator'
import { type ComponentsMap, type NodeSchema, type RootSchema, TRANSFORM_STAGE } from '../types'
import { type EventBus, uniqueId } from '../utils'
import { History } from './history'
import { NODE_EVENT, Node, type NodeModelOptions, insertChild, insertChildren } from './node/node'
import { installDocumentTeardown } from './teardown'

export enum DOCUMENT_EVENT {
  ADD = 'document:add',
  REMOVE = 'document:remove',
  OPEN_CHANGE = 'document:open.change',
  OPEN = 'document:open',
}

export class Document {
  readonly isDocument = true

  private schemaMutationVersion = 0

  get mutationVersion(): number {
    return this.schemaMutationVersion
  }

  /** Internal monotonic clock for every attempted schema write, including ABA and rollback. */
  markSchemaMutation(): void {
    this.project.assertDocumentMutationAllowed(this)
    this.schemaMutationVersion += 1
  }

  private emitter: EventBus

  #id = ''

  get id(): string {
    return this.#id
  }

  set id(value: string) {
    this.project.assertProjectMutationAllowed()
    this.#id = value
  }

  /** document is open or not */
  @observable.ref private accessor openedState = false

  get _opened(): boolean {
    return this.openedState
  }

  /** document is suspended or not */
  @observable.ref private accessor suspendedState = false

  get _suspended(): boolean {
    return this.suspendedState
  }

  /**
   * 是否为非激活状态
   */
  get suspended() {
    return this.suspendedState || !this.openedState
  }

  /**
   * 与 suspended 相反，是否为激活状态，这个函数可能用的更多一点
   */
  get active() {
    return !this.suspended
  }

  /** document is blank or not */
  private _blank = true

  /** document root node */
  #rootNode: Node | null = null

  get rootNode(): Node | null {
    return this.#rootNode
  }

  set rootNode(value: Node | null) {
    this.project.assertDocumentMutationAllowed(this)
    this.#rootNode = value
  }

  get root() {
    return this.rootNode
  }

  getRoot() {
    return this.rootNode
  }

  #nodesMap = new Map<Node['id'], Node>()

  private readonly restrictedNodesMapView: Map<Node['id'], Node>

  get nodesMap() {
    return this.project.allowsDirectModelMutation() ? this.#nodesMap : this.restrictedNodesMapView
  }

  get simulator(): Simulator | null {
    return this.project.simulator
  }

  /** 对应 document 的 path */
  get fileName(): string {
    return this.rootNode?.getExtraProp('fileName', false)?.getAsString() || this.id
  }

  set fileName(fileName: string) {
    this.rootNode?.getExtraProp('fileName', true)?.setValue(fileName)
  }

  @observable.shallow private accessor nodes = new Set<Node>()

  // get name() {
  //   return (this.rootNode?.getExtraProp('name', false)?.getValue() as string) || this.id
  // }

  // set name(name: string) {
  //   this.rootNode?.getExtraProp('name', true)?.setValue(name)
  // }

  get opened() {
    return this.openedState
  }

  isBlank() {
    return !!(this._blank && !this.isModified())
  }

  readonly history: History

  getHistory() {
    return this.history
  }

  readonly project: Project

  readonly designer: Designer

  @observable.ref private accessor _dropLocation: DropLocation | null = null

  @action
  set dropLocation(loc: DropLocation | null) {
    this.project.assertDocumentGenerationActive(this)
    this._dropLocation = loc
    this.designer.postEvent(DESIGNER_EVENT.DOCUMENT_DROP_LOCATION_CHANGE, { document: this, location: loc })
  }

  get dropLocation() {
    return this._dropLocation
  }

  get schema(): RootSchema {
    return this.export(TRANSFORM_STAGE.SERIALIZE)
  }

  constructor(project: Project, schema?: RootSchema) {
    this.project = project
    this.designer = project.designer
    this.emitter = this.designer.createEventBus('Document')
    this.id = schema?.docId ?? uniqueId('doc')
    this.restrictedNodesMapView = createMutationGuardedMapView(this.#nodesMap, () => this.markSchemaMutation())

    if (schema) {
      this.rootNode = this.createNode(schema)
      this._blank = false
    }

    this.history = new History(
      () => (this.rootNode ? this.exportRaw() : null),
      schema => {
        this.import(schema, true, { invokeMaterialHooks: false })
        this.simulator?.rerender()
      },
      this,
    )
    installDocumentTeardown(this, {
      purge: () => this.#purgeInternal(true),
      remove: () => this.#removeInternal(true),
      retire: () => sealLifecycleMutations(this, 'document generation is disposed'),
    })
  }

  @action
  import(schema?: RootSchema, checkId = false, options: NodeModelOptions = {}) {
    this.markSchemaMutation()
    const preparedSchema = schema ? this.project.prepareDocumentSchema(schema) : undefined

    this.nodes.forEach(node => {
      if (node.isRoot) return
      this.internalRemoveNode(node, true)
    })

    if (preparedSchema) {
      this.rootNode?.import(preparedSchema, checkId, options)
      this._blank = false
    } else {
      this._blank = true
    }
  }

  export(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE) {
    this.project.assertDocumentGenerationActive(this)
    return this.rootNode!.export<RootSchema>(stage)
  }

  /** Pure raw snapshot for history, transactions, and capability boundaries. */
  exportRaw(): RootSchema {
    this.project.assertDocumentGenerationActive(this)
    return this.rootNode!.exportRaw<RootSchema>()
  }

  @action
  remove() {
    this.#removeInternal(false)
  }

  #removeInternal(teardown: boolean): void {
    if (!teardown) this.project.assertDocumentLifecycleMutationAllowed(this)
    const errors: unknown[] = []
    try {
      runInternalLifecycleTeardown(this.history)
    } catch (error) {
      errors.push(error)
    }
    try {
      this.#purgeInternal(teardown)
    } catch (error) {
      errors.push(error)
    }
    try {
      this.project.internalUnlinkDocument(this)
    } catch (error) {
      errors.push(error)
    }
    sealLifecycleMutations(this, 'document generation is disposed')
    if (!teardown) {
      try {
        this.designer.postEvent(DOCUMENT_EVENT.REMOVE, { id: this.id })
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Document removal completed with errors')
  }

  @action
  purge() {
    // A project-owned Document cannot be left without a root while retaining
    // its identity. Keep the legacy entry point as a complete terminal remove.
    this.#removeInternal(false)
  }

  #purgeInternal(teardown: boolean): void {
    if (teardown) this.schemaMutationVersion += 1
    else {
      this.project.assertDocumentLifecycleMutationAllowed(this)
      this.markSchemaMutation()
    }
    // 追踪物料使用：批量减少所有节点的使用计数
    for (const node of this.nodes) {
      if (node.componentName) {
        if (teardown) releaseMaterialUsageDuringTeardown(this.designer.materials, node.materialUsageKey)
        else this.designer.materials.decrementUsage(node.materialUsageKey)
      }
    }

    this.rootNode?.purge()
    this.nodes.clear()
    this.#nodesMap.clear()
    this.rootNode = null
  }

  @action
  createNode(schema: NodeSchema, checkId = true, options: NodeModelOptions = {}) {
    this.markSchemaMutation()
    if (schema?.id && this.hasNode(schema.id)) {
      schema.id = undefined
    }

    let node: Node | null = null
    let isNewNode = false

    if (schema?.id) {
      node = this.getNode(schema.id)
      if (node && node.componentName === schema.componentName) {
        if (node.parent) {
          node.internalSetParent(null, false)
        }
        node.import(schema, checkId, options)
      } else if (node) {
        node = null
      }
    }

    if (!node) {
      node = new Node(this, schema, options)
      isNewNode = true
    }

    this.nodes.add(node)
    this.#nodesMap.set(node.id, node)
    this.emitter.emit(NODE_EVENT.ADD, node)

    // 追踪物料使用：仅对新创建的节点增加使用计数
    if (isNewNode && node.componentName) {
      this.designer.materials.incrementUsage(node.materialUsageKey)
    }

    return node
  }

  getNode(id: string) {
    return this.#nodesMap.get(id) || null
  }

  getNodeCount(): number {
    return this.#nodesMap.size
  }

  hasNode(id: string) {
    const node = this.getNode(id)
    return node ? !node.isPurged : false
  }

  removeNode(idOrNode: string | Node) {
    let node: Node | null

    if (typeof idOrNode === 'string') {
      node = this.getNode(idOrNode)
    } else {
      node = idOrNode
    }

    if (!node) {
      return
    }

    this.internalRemoveNode(node)
  }

  @action
  private internalRemoveNode(node: Node, useMutator = false) {
    this.project.assertDocumentMutationAllowed(this)
    if (!this.nodes.has(node)) {
      return
    }

    if (node.isRoot) {
      this.rootNode = null
    }

    node.remove(true, useMutator)
  }

  @action
  unlinkNode(node: Node) {
    this.markSchemaMutation()
    // 追踪物料使用：减少使用计数
    if (node.componentName) {
      this.designer.materials.decrementUsage(node.materialUsageKey)
    }

    this.nodes.delete(node)
    this.#nodesMap.delete(node.id)
  }

  migrateNode(node: Node, newParent: Node) {
    this.project.assertDocumentMutationAllowed(this)
    if (node.parent === newParent) {
      return
    }

    if (node.parent) {
      node.parent?.children?.internalUnlinkChild(node)
      node.internalUnlinkParent()
    }
    newParent.insertAfter(node)
  }

  batchRemoveNode(idOrNodeList: (string | Node)[]) {
    for (const item of idOrNodeList) {
      this.removeNode(item)
    }
  }

  insertNode(parent: Node, thing: Node | NodeSchema, at?: number, copy?: boolean) {
    return insertChild(parent, thing, at, copy)
  }

  /**
   * insert multiple nodes
   */
  insertNodes(parent: Node, nodes: Node[] | NodeSchema[], at?: number, copy?: boolean) {
    return insertChildren(parent, nodes, at, copy)
  }

  /**
   * 切换激活，只有打开的才能激活
   * 不激活，打开之后切换到另外一个时发生，比如 tab 视图，切换到另外一个标签页
   */
  @action
  private setSuspense(flag: boolean) {
    this.project.assertDocumentLifecycleMutationAllowed(this)
    if (!this.openedState && !flag) {
      return
    }
    this.suspendedState = flag
    this.simulator?.setSuspense(flag)
    if (!flag) {
      this.project.checkExclusive(this)
    }
  }

  suspense() {
    this.project.assertDocumentLifecycleMutationAllowed(this)
    this.setSuspense(true)
  }

  activate() {
    this.project.assertDocumentLifecycleMutationAllowed(this)
    this.setSuspense(false)
  }

  @action
  open() {
    this.project.assertDocumentLifecycleMutationAllowed(this)
    const originState = this.openedState
    this.openedState = true
    // only emit when document is suspense
    if (originState === false) {
      this.designer.postEvent(DOCUMENT_EVENT.OPEN, this)
    }
    if (this.suspendedState) {
      this.setSuspense(false)
    } else {
      this.project.checkExclusive(this)
    }
    return this
  }

  @action
  close() {
    this.project.assertDocumentLifecycleMutationAllowed(this)
    this.setSuspense(true)
    this.openedState = false
  }

  /**
   * check if there is unsaved change for document
   */
  isModified() {
    return this.history.isSavePoint()
  }

  /**
   * get components map of all the nodes in this document
   * @param extraComps - extra components that will be added to the components map, use for custom components
   */
  getComponentsMap(extraComps?: string[]) {
    const componentsMap: ComponentsMap = []
    // use map to avoid duplicate
    const existedMap: Record<string, boolean> = {}

    for (const node of this.#nodesMap.values()) {
      const { componentName } = node || {}
      if (!existedMap[node.materialUsageKey]) {
        existedMap[node.materialUsageKey] = true
        if (node.componentMeta?.npm?.package) {
          componentsMap.push({
            ...node.componentMeta.npm,
            componentName,
          })
        } else {
          componentsMap.push({
            devMode: 'lowCode',
            componentName,
          })
        }
      }
    }

    // combine extra components
    if (Array.isArray(extraComps)) {
      extraComps.forEach(componentName => {
        if (componentName && !existedMap[componentName]) {
          const meta = this.getComponentMeta(componentName)
          if (meta?.npm?.package) {
            componentsMap.push({
              ...meta?.npm,
              componentName,
            })
          } else {
            componentsMap.push({
              devMode: 'lowCode',
              componentName,
            })
          }
        }
      })
    }

    return componentsMap
  }

  getComponentMeta(componentName: string) {
    return this.designer.materials.getComponentMeta(componentName)
  }

  toData(extraComps?: string[]) {
    const node = this.export(TRANSFORM_STAGE.SAVE)
    const data = {
      componentsMap: this.getComponentsMap(extraComps),
      // utils: this.getUtilsMap(),
      componentsTree: [node],
    }
    return data
  }

  onReady(listener: () => void) {
    this.project.assertDocumentGenerationActive(this)
    const dispose = this.designer.onEvent(DOCUMENT_EVENT.OPEN, listener)

    return () => {
      dispose()
    }
  }

  onNodeAdd(listener: (node: Node) => void) {
    this.project.assertDocumentGenerationActive(this)
    const dispose = this.designer.onEvent(NODE_EVENT.ADD, listener)

    return () => {
      dispose()
    }
  }

  onNodeRemove(listener: (id: string) => void) {
    this.project.assertDocumentGenerationActive(this)
    const dispose = this.designer.onEvent(NODE_EVENT.REMOVE, listener)

    return () => {
      dispose()
    }
  }
}

export function isDocument(obj: any): obj is Document {
  return obj && obj.isDocument
}
