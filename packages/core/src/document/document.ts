import { action, observable } from 'mobx'
import { DESIGNER_EVENT, type Designer, type DropLocation } from '../designer'
import { clearDesignerDropLocationDuringDocumentTeardown } from '../designer/drop-location-boundary'
import { createDesignerEventBus } from '../designer/event-bus'
import {
  assertLifecycleMutationAllowed,
  inheritLifecycleMutationGuard,
  sealLifecycleMutations,
} from '../lifecycle/mutation-barrier'
import { createMutationGuardedMapView } from '../lifecycle/mutation-guarded-map'
import { lockPrototypeAccessors, lockReadonlyProperties } from '../lifecycle/readonly-properties'
import { inheritEngineTeardownOwnership, runInternalLifecycleTeardown } from '../lifecycle/teardown-boundary'
import { releaseMaterialUsageDuringTeardown } from '../materials/teardown'
import type { Project } from '../project'
import { isDocumentMutationBoundaryActive } from '../project/document-mutation-boundary'
import { ProjectMutationCommittedError } from '../project/mutation-authority'
import type { Simulator } from '../simulator'
import { type ComponentsMap, type NodeSchema, type RootSchema, TRANSFORM_STAGE } from '../types'
import { type EventBus, uniqueId } from '../utils'
import { History } from './history'
import { NODE_EVENT, Node, type NodeModelOptions, insertChild, insertChildren, isNode } from './node/node'
import {
  completePendingDocumentTeardown,
  installDocumentTeardown,
  retainPendingDocumentTeardown,
  unlinkDocumentDuringTeardown,
} from './teardown'

export enum DOCUMENT_EVENT {
  ADD = 'document:add',
  REMOVE = 'document:remove',
  OPEN_CHANGE = 'document:open.change',
  OPEN = 'document:open',
}

export class Document {
  readonly isDocument = true

  #schemaMutationVersion = 0

  #removalState: 'active' | 'removed' | 'removing' = 'active'

  #removeEventPublished = false

  #modelSnapshotCaptured = false

  readonly #pendingModelTeardowns = new Set<Node>()

  get mutationVersion(): number {
    return this.#schemaMutationVersion
  }

  /** Internal monotonic clock for every attempted schema write, including ABA and rollback. */
  markSchemaMutation(): void {
    this.project.assertDocumentMutationAllowed(this)
    this.#schemaMutationVersion += 1
  }

  private emitter: EventBus

  #id = ''

  get id(): string {
    return this.#id
  }

  set id(value: string) {
    assertLifecycleMutationAllowed(this, 'document.id')
    this.project.assertProjectMutationAllowed()
    this.#id = value
  }

  /** document is open or not */
  @observable.ref accessor #openedState = false

  get _opened(): boolean {
    return this.#openedState
  }

  /** document is suspended or not */
  @observable.ref accessor #suspendedState = false

  get _suspended(): boolean {
    return this.#suspendedState
  }

  /**
   * 是否为非激活状态
   */
  get suspended() {
    return this.#suspendedState || !this.#openedState
  }

  /**
   * 与 suspended 相反，是否为激活状态，这个函数可能用的更多一点
   */
  get active() {
    return !this.suspended
  }

  /** document is blank or not */
  #blank = true

  /** document root node */
  #rootNode: Node | null = null

  get rootNode(): Node | null {
    return this.#rootNode
  }

  set rootNode(value: Node | null) {
    assertLifecycleMutationAllowed(this, 'document.rootNode')
    if (isDocumentMutationBoundaryActive(this.project, this)) {
      throw new Error('Raw Document.rootNode mutation is blocked while a transaction is active')
    }
    this.project.assertDocumentMutationAllowed(this)
    if (this.#rootNode === value) return
    if (value !== null) {
      if (!isNode(value) || value.document !== this || this.getNode(value.id) !== value || value.parent !== null) {
        throw new Error('Document.rootNode only accepts a registered, detached Node owned by this Document')
      }
    }
    this.markSchemaMutation()
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
    return this.restrictedNodesMapView
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

  readonly #nodes = observable.set<Node>([], { deep: false })

  // get name() {
  //   return (this.rootNode?.getExtraProp('name', false)?.getValue() as string) || this.id
  // }

  // set name(name: string) {
  //   this.rootNode?.getExtraProp('name', true)?.setValue(name)
  // }

  get opened() {
    return this.#openedState
  }

  isBlank() {
    return !!(this.#blank && !this.isModified())
  }

  readonly history: History

  getHistory() {
    return this.history
  }

  readonly project: Project

  readonly designer: Designer

  @observable.ref accessor #dropLocation: DropLocation | null = null

  @action
  set dropLocation(loc: DropLocation | null) {
    this.project.assertDocumentGenerationActive(this)
    if (loc && (loc.document !== this || this.getNode(loc.target.id) !== loc.target)) {
      throw new Error('Document.dropLocation only accepts an active location owned by this Document')
    }
    this.#dropLocation = loc
    this.designer.postEvent(DESIGNER_EVENT.DOCUMENT_DROP_LOCATION_CHANGE, { document: this, location: loc })
  }

  get dropLocation() {
    return this.#dropLocation
  }

  get schema(): RootSchema {
    return this.export(TRANSFORM_STAGE.SERIALIZE)
  }

  constructor(project: Project, schema?: RootSchema) {
    this.project = project
    this.designer = project.designer
    lockReadonlyProperties(this, ['designer', 'isDocument', 'project'])
    lockPrototypeAccessors(this, ['id', 'mutationVersion', 'nodesMap', 'root', 'rootNode', 'simulator'])
    this.emitter = createDesignerEventBus(this.designer, 'Document')
    inheritEngineTeardownOwnership(project, this.emitter)
    lockReadonlyProperties(this, ['emitter'])
    this.id = schema?.docId ?? uniqueId('doc')
    inheritLifecycleMutationGuard(this, this.#nodesMap)
    this.restrictedNodesMapView = createMutationGuardedMapView(this.#nodesMap, () => {
      if (isDocumentMutationBoundaryActive(this.project, this)) {
        throw new Error('Raw Document.nodesMap mutation is blocked while a transaction is active')
      }
      this.markSchemaMutation()
    })
    inheritLifecycleMutationGuard(this, this.restrictedNodesMapView)
    lockReadonlyProperties(this, ['restrictedNodesMapView'])

    try {
      if (schema) {
        this.rootNode = this.createNode(schema)
        this.#blank = false
      }
    } catch (error) {
      const cleanupErrors: unknown[] = []
      sealLifecycleMutations(this, 'document construction failed')
      sealLifecycleMutations(this.emitter, 'document construction failed')
      try {
        this.#purgeInternal(true)
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      try {
        runInternalLifecycleTeardown(this.emitter)
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], 'Document construction failed and cleanup reported errors')
      }
      throw error
    }

    this.history = new History(
      () => (this.rootNode ? this.exportRaw() : null),
      schema => {
        this.import(schema, true, { invokeMaterialHooks: false })
      },
      this,
      () => this.simulator?.rerender(),
    )
    installDocumentTeardown(this, {
      clearDropLocation: () => {
        this.#dropLocation = null
      },
      purge: () => this.#purgeInternal(true),
      remove: () => this.#removeInternal(true),
      retire: () => sealLifecycleMutations(this, 'document generation is disposed'),
    })
    lockReadonlyProperties(this, ['history'])
  }

  @action
  import(schema?: RootSchema, checkId = false, options: NodeModelOptions = {}) {
    // Reject untrusted raw model ingress before inspecting executable schema
    // values, while keeping validation ahead of the mutation clock.
    this.project.assertDocumentMutationAllowed(this)
    const preparedSchema = schema ? this.project.prepareDocumentSchema(schema) : undefined
    this.markSchemaMutation()
    const cleanupErrors: unknown[] = []

    for (const node of [...this.#nodes]) {
      if (node.isRoot) continue
      try {
        this.internalRemoveNode(node, true)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }

    try {
      if (preparedSchema) {
        this.rootNode?.import(preparedSchema, checkId, options)
        this.#blank = false
      } else {
        this.#blank = true
      }
    } catch (error) {
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], 'Document import failed after cleanup reported errors')
      }
      throw error
    }
    if (cleanupErrors.length) throw new ProjectMutationCommittedError(cleanupErrors, undefined)
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
    if (!teardown) {
      if (this.#removalState === 'removed') return
      if (this.#removalState === 'removing') {
        const error = new Error('Cannot remove the Document while its removal is already in progress')
        error.name = 'LifecycleReentrancyError'
        throw error
      }
      this.project.assertDocumentLifecycleMutationAllowed(this)
      this.markSchemaMutation()
      this.#removalState = 'removing'
    }

    const errors: unknown[] = []
    clearDesignerDropLocationDuringDocumentTeardown(this.designer, this)
    this.#dropLocation = null
    // Revoke the public generation before cleanup invokes any user-controlled
    // disposer or EventEmitter removeListener callback.
    sealLifecycleMutations(this, 'document generation is disposed')
    sealLifecycleMutations(this.emitter, 'document event bus generation is disposed')

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
      runInternalLifecycleTeardown(this.emitter)
    } catch (error) {
      errors.push(error)
    }
    try {
      if (this.project.getDocument(this.id) === this) unlinkDocumentDuringTeardown(this.project, this)
    } catch (error) {
      errors.push(error)
    }
    if (!teardown && !this.#removeEventPublished) {
      this.#removeEventPublished = true
      try {
        this.designer.postEvent(DOCUMENT_EVENT.REMOVE, { id: this.id })
      } catch (error) {
        errors.push(error)
      }
    }
    this.#removalState = 'removed'
    if (errors.length) retainPendingDocumentTeardown(this.project, this)
    else completePendingDocumentTeardown(this.project, this)
    if (errors.length) throw new AggregateError(errors, 'Document removal completed with errors')
  }

  @action
  purge() {
    // A project-owned Document cannot be left without a root while retaining
    // its identity. Keep the legacy entry point as a complete terminal remove.
    this.#removeInternal(false)
  }

  #purgeInternal(teardown: boolean): void {
    const errors: unknown[] = []
    if (!this.#modelSnapshotCaptured) {
      if (teardown) this.#schemaMutationVersion += 1
      const snapshot = [...this.#nodes]
      // The Document owns every registered identity, including detached and
      // corrupt cyclic graphs. Node teardown receives one shared visited set,
      // so retaining all identities is complete without double-disposal.
      snapshot.forEach(node => this.#pendingModelTeardowns.add(node))

      for (const node of snapshot) {
        if (!node.componentName) continue
        try {
          if (teardown) releaseMaterialUsageDuringTeardown(this.designer.materials, node.materialUsageKey)
          else this.designer.materials.decrementUsage(node.materialUsageKey)
        } catch (error) {
          errors.push(error)
        }
      }
      this.#modelSnapshotCaptured = true
    }

    const visited = new Set<Node>()
    for (const node of [...this.#pendingModelTeardowns]) {
      if (visited.has(node)) {
        this.#pendingModelTeardowns.delete(node)
        continue
      }
      try {
        runInternalLifecycleTeardown<[Set<Node>]>(node, visited)
        this.#pendingModelTeardowns.delete(node)
      } catch (error) {
        errors.push(error)
      }
    }

    // Public identity is always terminal even when private cleanup must retry.
    this.#nodes.clear()
    this.#nodesMap.clear()
    this.#rootNode = null
    if (errors.length) throw new AggregateError(errors, 'Document model disposal completed with errors')
  }

  @action
  createNode(schema: NodeSchema, checkId = true, options: NodeModelOptions = {}) {
    this.markSchemaMutation()
    const normalizedSchema = schema?.id && this.hasNode(schema.id) ? { ...schema, id: undefined } : schema
    const nodesBefore = new Set(this.#nodes)

    let node: Node | null = null
    let isNewNode = false
    try {
      if (normalizedSchema?.id) {
        node = this.getNode(normalizedSchema.id)
        if (node && node.componentName === normalizedSchema.componentName) {
          if (node.parent) {
            node.internalSetParent(null, false)
          }
          node.import(normalizedSchema, checkId, options)
        } else if (node) {
          node = null
        }
      }

      if (!node) {
        node = new Node(this, normalizedSchema, options)
        isNewNode = true
      }

      this.#nodes.add(node)
      this.#nodesMap.set(node.id, node)

      // Every registered new identity owns exactly one material usage slot.
      // Acquire it before publishing the ADD event so failure rollback can
      // release the complete set without guessing which increments happened.
      if (isNewNode && node.componentName) {
        this.designer.materials.incrementUsage(node.materialUsageKey)
      }
      this.emitter.emit(NODE_EVENT.ADD, node)

      return node
    } catch (error) {
      const cleanupErrors = this.#rollbackConstructedNodes(nodesBefore)
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], 'Node creation failed and rollback reported errors')
      }
      throw error
    }
  }

  #rollbackConstructedNodes(nodesBefore: ReadonlySet<Node>): unknown[] {
    const cleanupErrors: unknown[] = []
    const createdNodes = [...this.#nodes].filter(node => !nodesBefore.has(node))
    for (const node of createdNodes) {
      this.#nodes.delete(node)
      if (this.#nodesMap.get(node.id) === node) this.#nodesMap.delete(node.id)
      if (node.componentName) {
        try {
          releaseMaterialUsageDuringTeardown(this.designer.materials, node.materialUsageKey)
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
    }
    const visited = new Set<Node>()
    for (const node of createdNodes) {
      try {
        runInternalLifecycleTeardown<[Set<Node>]>(node, visited)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    return cleanupErrors
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
    if (!this.#nodes.has(node)) {
      return
    }

    if (node.isRoot) {
      throw new Error('Cannot remove the document root node; remove the Document instead')
    }

    if (node.parent) {
      node.remove(true, useMutator)
      return
    }

    const errors: unknown[] = []
    try {
      this.unlinkNode(node)
    } catch (error) {
      errors.push(error)
    }
    try {
      runInternalLifecycleTeardown(node)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw new AggregateError(errors, 'Detached node removal completed with errors')
  }

  @action
  unlinkNode(node: Node) {
    this.markSchemaMutation()
    const errors: unknown[] = []
    this.#nodes.delete(node)
    this.#nodesMap.delete(node.id)
    // Identity unlink is the invariant. Usage observers and node listeners may
    // fail after their state change, but cannot keep a zombie registered.
    if (node.componentName) {
      try {
        this.designer.materials.decrementUsage(node.materialUsageKey)
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      this.emitter.emit(NODE_EVENT.REMOVE, node.id)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw new AggregateError(errors, 'Node identity unlink completed with errors')
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
    this.#assertOwnedInsertionParent(parent)
    this.#assertInsertableNodeIdentity(thing, copy)
    return insertChild(parent, thing, at, copy)
  }

  /**
   * insert multiple nodes
   */
  insertNodes(parent: Node, nodes: Node[] | NodeSchema[], at?: number, copy?: boolean) {
    this.#assertOwnedInsertionParent(parent)
    if (Array.isArray(nodes)) {
      nodes.forEach(node => this.#assertInsertableNodeIdentity(node, copy))
    }
    return insertChildren(parent, nodes, at, copy)
  }

  #assertOwnedInsertionParent(parent: Node): void {
    if (!isNode(parent) || parent.document !== this || this.getNode(parent.id) !== parent || parent.isPurged) {
      throw new Error('Document insertion requires a canonical parent Node owned by this Document')
    }
    this.project.assertDocumentGenerationActive(this)
  }

  #assertInsertableNodeIdentity(thing: Node | NodeSchema, copy?: boolean): void {
    if (!isNode(thing)) return

    const sourceDocument = thing.document
    const sourceProject = sourceDocument?.project
    if (
      !sourceDocument ||
      sourceProject !== this.project ||
      sourceDocument.designer !== this.designer ||
      this.project.getDocument(sourceDocument.id) !== sourceDocument ||
      sourceDocument.getNode(thing.id) !== thing ||
      thing.isPurged ||
      (!copy && sourceDocument !== this)
    ) {
      throw new Error(
        copy
          ? 'Document insertion can only copy a canonical Node identity owned by this Project'
          : 'Document insertion can only move a canonical Node identity owned by this Document',
      )
    }
    this.project.assertDocumentGenerationActive(sourceDocument)
  }

  /**
   * 切换激活，只有打开的才能激活
   * 不激活，打开之后切换到另外一个时发生，比如 tab 视图，切换到另外一个标签页
   */
  @action
  private setSuspense(flag: boolean) {
    this.project.assertDocumentLifecycleMutationAllowed(this)
    if (!this.#openedState && !flag) {
      return
    }
    this.#suspendedState = flag
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
    const originState = this.#openedState
    this.#openedState = true
    // only emit when document is suspense
    if (originState === false) {
      this.designer.postEvent(DOCUMENT_EVENT.OPEN, this)
      this.emitter.emit(DOCUMENT_EVENT.OPEN)
    }
    if (this.#suspendedState) {
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
    this.#openedState = false
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
            devMode: 'proCode',
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
              devMode: 'proCode',
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
    return this.emitter.on(DOCUMENT_EVENT.OPEN, listener)
  }

  onNodeAdd(listener: (node: Node) => void) {
    this.project.assertDocumentGenerationActive(this)
    return this.emitter.on(NODE_EVENT.ADD, listener)
  }

  onNodeRemove(listener: (id: string) => void) {
    this.project.assertDocumentGenerationActive(this)
    return this.emitter.on(NODE_EVENT.REMOVE, listener)
  }
}

export function isDocument(obj: any): obj is Document {
  return obj && obj.isDocument
}
