import type { Designer, DropLocation } from '../designer'
import type { ComponentsMap } from '../meta'
import type { Project } from '../project'
import type { Simulator } from '../simulator'
import type { NodeSchema } from './node/node'

import { action, observable } from 'mobx'
import { DESIGNER_EVENT } from '../designer'
import { TRANSFORM_STAGE } from '../types'
import { createEventBus, uniqueId } from '../utils'
import { History } from './history'
import { NODE_EVENT, Node, insertChild, insertChildren } from './node/node'

export interface DocumentSchema {
  id?: string

  name?: string

  rootNode: NodeSchema

  // TODO: 是否需要将一些 rootNode 上的东西迁移到这边
  [key: string]: any
}

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

  @observable.shallow private accessor nodes = new Set<Node>()

  get name() {
    return (this.rootNode?.getExtraProp('name', false)?.getValue() as string) || this.id
  }

  set name(name: string) {
    this.rootNode?.getExtraProp('name', true)?.setValue(name)
  }

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

  set dropLocation(loc: DropLocation | null) {
    this._dropLocation = loc
    this.designer.postEvent(DESIGNER_EVENT.DOCUMENT_DROP_LOCATION_CHANGE, { document: this, location: loc })
  }

  get dropLocation() {
    return this._dropLocation
  }

  get schema(): DocumentSchema {
    return this.export(TRANSFORM_STAGE.SERIALIZE)
  }

  constructor(project: Project, schema?: DocumentSchema) {
    this.id = schema?.id ?? uniqueId('doc')
    this.project = project
    this.designer = project.designer
    this.history = new History(
      () => this.export(TRANSFORM_STAGE.SERIALIZE),
      schema => {
        this.import(schema, true)
        this.simulator?.rerender()
      },
      this,
    )

    if (schema) {
      this.name = schema?.name ?? ''
      if (schema?.rootNode) {
        this.rootNode = this.createNode(schema.rootNode)
        this._blank = false
      }
    }
  }

  @action
  import(schema?: DocumentSchema, checkId = false) {
    this.nodes.forEach(node => {
      if (node.isRoot()) return
      this.internalRemoveNode(node, true)
    })
    this.remove()

    this.id = schema?.id ?? uniqueId('doc')
    if (schema) {
      this.name = schema?.name ?? ''
      if (schema?.rootNode) {
        this.rootNode?.import(schema.rootNode, checkId)
        this.rootNode = this.createNode(schema.rootNode)
        this._blank = false
      }
    } else {
      this._blank = true
    }
  }

  export(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE) {
    const schema: DocumentSchema = {
      id: this.id,
      name: this.name,
      rootNode: this.rootNode!.export(stage),
    }

    return schema
  }

  @action
  remove() {
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
    if (schema.id) {
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

    if (node.isRoot()) {
      this.rootNode = null
    }

    node.remove(true, useMutator)
  }

  @action
  unlinkNode(node: Node) {
    this.nodes.delete(node)
    this._nodesMap.delete(node.id)
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

  @action
  open() {
    const originState = this._opened
    this._opened = true
    // only emit when document is suspense
    if (originState === false) {
      this.designer.postEvent(DOCUMENT_EVENT.OPEN, this)
    }
    if (this._opened) {
      this.project.checkExclusive(this)
    } else {
      this.setOpened(false)
    }

    return this
  }

  @action
  close(): void {
    this.setOpened(false)
    this._opened = false
  }

  /**
   * use open a document and suspense other documents
   */
  @action
  private setOpened(flag: boolean) {
    if (!this._opened && !flag) {
      return
    }

    this._opened = flag
    // this.simulator?.setSuspense(flag);
    if (!flag) {
      this.project.checkExclusive(this)
    }
  }

  suspense() {
    this.setOpened(false)
  }

  activate() {
    this.setOpened(true)
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
