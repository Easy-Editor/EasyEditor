import { action, observable } from 'mobx'
import { type ComponentsMap, DESIGNER_EVENT, type Designer, type DropLocation } from '../designer'
import type { Project } from '../project'
import type { Simulator } from '../simulator'
import { type NodeSchema, type RootSchema, TRANSFORM_STAGE } from '../types'
import { createEventBus, uniqueId } from '../utils'
import { History } from './history'
import { NODE_EVENT, Node, insertChild, insertChildren } from './node/node'

export enum DOCUMENT_EVENT {
  ADD = 'document:add',
  REMOVE = 'document:remove',
  OPEN_CHANGE = 'document:open.change',
  OPEN = 'document:open',
}

export class Document {
  readonly isDocument = true

  private emitter = createEventBus('Document')

  id: string

  /** document is open or not */
  @observable.ref accessor _opened = false

  /** document is suspended or not */
  @observable.ref accessor _suspended = false

  /**
   * 是否为非激活状态
   */
  get suspended() {
    return this._suspended || !this._opened
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
  rootNode: Node | null = null

  get root() {
    return this.rootNode
  }

  getRoot() {
    return this.rootNode
  }

  private _nodesMap = new Map<Node['id'], Node>()

  get nodesMap() {
    return this._nodesMap
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
    return this._opened
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
    this.id = schema?.docId ?? uniqueId('doc')
    this.history = new History(
      () => this.export(TRANSFORM_STAGE.SERIALIZE),
      schema => {
        this.import(schema, true)
        this.simulator?.rerender()
      },
      this,
    )

    if (schema) {
      this.rootNode = this.createNode(schema)
      this._blank = false
    }
  }

  @action
  import(schema?: RootSchema, checkId = false) {
    this.nodes.forEach(node => {
      if (node.isRoot) return
      this.internalRemoveNode(node, true)
    })

    if (schema) {
      this.rootNode?.import(schema, checkId)
      this._blank = false
    } else {
      this._blank = true
    }
  }

  export(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE) {
    return this.rootNode!.export<RootSchema>(stage)
  }

  @action
  remove() {
    this.history.destroy()
    this.designer.postEvent(DOCUMENT_EVENT.REMOVE, { id: this.id })
    this.purge()
    this.project.removeDocument(this)
  }

  @action
  purge() {
    this.rootNode?.purge()
    this.nodes.clear()
    this._nodesMap.clear()
    this.rootNode = null
  }

  @action
  createNode(schema: NodeSchema, checkId = true) {
    if (schema?.id && this.hasNode(schema.id)) {
      schema.id = undefined
    }

    let node: Node | null = null
    if (schema?.id) {
      node = this.getNode(schema.id)
      if (node && node.componentName === schema.componentName) {
        if (node.parent) {
          node.internalSetParent(null, false)
        }
        node.import(schema, checkId)
      } else if (node) {
        node = null
      }
    }

    if (!node) {
      node = new Node(this, schema)
    }

    this.nodes.add(node)
    this._nodesMap.set(node.id, node)
    this.emitter.emit(NODE_EVENT.ADD, node)

    return node
  }

  getNode(id: string) {
    return this._nodesMap.get(id) || null
  }

  getNodeCount(): number {
    return this._nodesMap.size
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
    this.nodes.delete(node)
    this._nodesMap.delete(node.id)
  }

  migrateNode(node: Node, newParent: Node) {
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
    if (!this._opened && !flag) {
      return
    }
    this._suspended = flag
    this.simulator?.setSuspense(flag)
    if (!flag) {
      this.project.checkExclusive(this)
    }
  }

  suspense() {
    this.setSuspense(true)
  }

  activate() {
    this.setSuspense(false)
  }

  @action
  open() {
    const originState = this._opened
    this._opened = true
    // only emit when document is suspense
    if (originState === false) {
      this.designer.postEvent(DOCUMENT_EVENT.OPEN, this)
    }
    if (this._suspended) {
      this.setSuspense(false)
    } else {
      this.project.checkExclusive(this)
    }
    return this
  }

  @action
  close() {
    this.setSuspense(true)
    this._opened = false
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

    for (const node of this._nodesMap.values()) {
      const { componentName } = node || {}
      if (!existedMap[componentName]) {
        existedMap[componentName] = true
        componentsMap.push({
          devMode: 'lowCode',
          componentName,
        })
      }
    }

    // combine extra components
    if (Array.isArray(extraComps)) {
      extraComps.forEach(componentName => {
        if (componentName && !existedMap[componentName]) {
          componentsMap.push({
            devMode: 'lowCode',
            componentName,
          })
        }
      })
    }

    return componentsMap
  }

  getComponent(componentName: string) {
    return this.simulator!.getComponent(componentName)
  }

  getComponentMeta(componentName: string) {
    return this.designer.componentMetaManager.getComponentMeta(componentName)
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
    const dispose = this.designer.onEvent(DOCUMENT_EVENT.OPEN, listener)

    return () => {
      dispose()
    }
  }

  onNodeAdd(listener: (node: Node) => void) {
    const dispose = this.designer.onEvent(NODE_EVENT.ADD, listener)

    return () => {
      dispose()
    }
  }

  onNodeRemove(listener: (id: string) => void) {
    const dispose = this.designer.onEvent(NODE_EVENT.REMOVE, listener)

    return () => {
      dispose()
    }
  }
}

export function isDocument(obj: any): obj is Document {
  return obj && obj.isDocument
}
