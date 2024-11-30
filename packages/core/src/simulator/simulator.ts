import type { IReactionDisposer, IReactionOptions, IReactionPublic } from 'mobx'
import type { Designer, LocateEvent, LocationChildrenDetail, LocationData, NodeInstance } from '../designer'
import type { Node } from '../document'
import type { Component, ComponentInstance, Snippet } from '../meta'
import type { Project } from '../project'
import type { SimulatorRenderer } from './simulator-render'

import { action, autorun, computed, observable, reaction } from 'mobx'
import {
  DESIGNER_EVENT,
  DragObjectType,
  LocationDetailType,
  clipboard,
  isDragAnyObject,
  isLocationData,
  isShaken,
} from '../designer'
import { getClosestClickableNode, getClosestNode } from '../document'
import { createEventBus } from '../utils'
import { Viewport } from './viewport'

export interface DropContainer {
  container: Node
  instance: ComponentInstance
}

export type DesignMode = 'design' | 'preview' | 'live'

export interface SimulatorProps {
  designMode?: DesignMode

  [key: string]: any
}

export class Simulator {
  readonly emitter = createEventBus('Simulator')

  isSimulator = true

  readonly project: Project

  readonly designer: Designer

  readonly viewport = new Viewport()

  private _iframe?: HTMLElement

  autoRender = true

  @computed
  get designMode(): DesignMode {
    return this.get('designMode') || 'design'
  }

  @observable.ref accessor _props: SimulatorProps = {}

  @observable.ref private accessor _contentWindow: Window | undefined

  get contentWindow() {
    return this._contentWindow
  }

  @observable.ref private accessor _contentDocument: Document | undefined

  get contentDocument() {
    return this._contentDocument
  }

  @observable.ref private accessor _components: Record<string, Component> = {}

  /**
   * material to component map
   */
  @computed
  get components() {
    return this._components
  }

  @observable private accessor instancesMap: {
    [docId: string]: Map<string, ComponentInstance>
  } = {}

  private _sensorAvailable = true

  get sensorAvailable(): boolean {
    return this._sensorAvailable
  }

  private _renderer?: SimulatorRenderer

  get renderer() {
    return this._renderer
  }

  private sensing = false

  constructor(designer: Designer) {
    this.designer = designer
    this.project = designer.project
  }

  @action
  setProps(props: SimulatorProps) {
    this._props = props
  }

  @action
  set(key: string, value: any) {
    this._props = {
      ...this._props,
      [key]: value,
    }
  }

  get(key: string): any {
    return this._props[key]
  }

  reaction(
    expression: (reaction: IReactionPublic) => unknown,
    effect: (value: unknown, prev: unknown, reaction: IReactionPublic) => void,
    opts?: IReactionOptions<unknown, boolean>,
  ): IReactionDisposer {
    return reaction(expression, effect, opts)
  }

  autorun(
    effect: (reaction: IReactionPublic) => void,
    options?: IReactionOptions<unknown, boolean>,
  ): IReactionDisposer {
    return autorun(effect, options)
  }

  @action
  purge() {
    this._components = {}
    this._renderer = undefined
    this._contentDocument = undefined
    this._contentWindow = undefined

    for (const docId in this.instancesMap) {
      this.instancesMap[docId].clear()
    }
    this.instancesMap = {}
  }

  /**
   * mount the viewport element
   */
  @action
  mountViewport(viewport: HTMLElement) {
    this._iframe = viewport
    this._contentDocument = viewport.ownerDocument
    this._contentWindow = viewport.ownerDocument.defaultView!
    this.viewport.mount(viewport)
  }

  /**
   * force to rerender the viewport
   */
  rerender() {
    return this._renderer?.rerender()
  }

  getComponent(componentName: string) {
    return this._components[componentName]
  }

  postEvent(eventName: string, ...data: any[]) {
    this.emitter.emit(eventName, ...data)
  }

  linkSnippet(ref: HTMLElement, snippet: Snippet) {
    return this.designer.dragon.from(ref, () => ({
      type: DragObjectType.NodeData,
      data: snippet.schema,
    }))
  }

  setupEvents() {
    this.setupDragAndClick()
    this.setupDetecting()
    clipboard.injectCopyPaster(this._contentDocument!)
  }

  setupDragAndClick() {
    const { designer } = this
    const doc = this.contentDocument!

    doc.addEventListener(
      'mousedown',
      (downEvent: MouseEvent) => {
        const documentModel = this.project.currentDocument
        if (!documentModel) {
          return
        }
        const { selection } = this.designer
        let isMulti = false
        if (this.designMode === 'design') {
          isMulti = downEvent.metaKey || downEvent.ctrlKey
        } else if (!downEvent.metaKey) {
          return
        }
        const nodeInst = this.getNodeInstanceFromElement(downEvent.target as Element)
        const { rootNode } = documentModel
        const node = getClosestClickableNode(nodeInst?.node || rootNode, downEvent)
        // 如果找不到可点击的节点，直接返回
        if (!node) {
          return
        }

        // 触发 onMouseDownHook 钩子
        const onMouseDownHook = node.componentMeta.advanced.callbacks?.onMouseDownHook
        if (onMouseDownHook) {
          onMouseDownHook(downEvent, node)
        }
        // stop response document focus event
        // TODO: ?? 阻止了 linkSnippet 事件 - mousedown 事件
        // downEvent.stopPropagation()
        // TODO: ?? 阻止了 linkSnippet 事件 - dragstart 事件
        // downEvent.preventDefault()
        const isLeftButton = downEvent.which === 1 || downEvent.button === 0
        const checkSelect = (e: MouseEvent) => {
          doc.removeEventListener('mouseup', checkSelect, true)
          // 鼠标是否移动 ? - 鼠标抖动应该也需要支持选中事件，偶尔点击不能选中，磁帖块移除 shaken 检测
          if (!isShaken(downEvent, e)) {
            const { id } = node
            if (isMulti && rootNode && !node.contains(rootNode) && selection.has(id)) {
              selection.remove(id)
            } else {
              if (rootNode) {
                selection.select(node.contains(rootNode) ? rootNode.id : id)
              }

              // dirty code should refector
              const selected = node?.componentMeta?.componentName || ''
              this.designer.postEvent(DESIGNER_EVENT.SIMULATOR_SELECT, {
                selected,
              })
            }
          }
        }

        if (isLeftButton && rootNode && !node.contains(rootNode)) {
          let nodes: Node[] = [node]
          let ignoreUpSelected = false
          if (isMulti) {
            // multi select mode, directily add
            if (!selection.has(node.id)) {
              selection.add(node.id)
              ignoreUpSelected = true
            }
            rootNode?.id && selection.remove(rootNode.id)
            // 获得顶层 nodes
            nodes = selection.getTopNodes()
          } else if (selection.containsNode(node, true)) {
            nodes = selection.getTopNodes()
          } else {
            // will clear current selection & select dragment in dragstart
          }
          designer.dragon.boost(
            {
              type: DragObjectType.Node,
              nodes,
            },
            downEvent,
          )
          if (ignoreUpSelected) {
            // multi select mode has add selected, should return
            return
          }
        }

        doc.addEventListener('mouseup', checkSelect, true)
      },
      true,
    )
  }

  setupDetecting() {
    const doc = this.contentDocument!
    const { detecting, dragon } = this.designer
    const hover = (e: MouseEvent) => {
      if (!detecting.enable || this.designMode !== 'design') {
        return
      }
      const nodeInstance = this.getNodeInstanceFromElement(e.target as Element)
      if (nodeInstance?.node) {
        const { node } = nodeInstance
        detecting.capture(node)
      } else {
        detecting.capture(null)
      }
      if (dragon.dragging) {
        e.stopPropagation()
      }
    }
    const leave = () => {
      this.project.currentDocument && detecting.leave(this.project.currentDocument)
    }

    doc.addEventListener('mouseover', hover, true)
    doc.addEventListener('mouseleave', leave, false)

    // TODO: refactor this line, contains click, mousedown, mousemove
    doc.addEventListener(
      'mousemove',
      (e: Event) => {
        if (dragon.dragging) {
          e.stopPropagation()
        }
      },
      true,
    )
  }

  @action
  buildComponentMap(components: Record<string, Component>) {
    this._components = components
  }

  @action
  setInstance(docId: string, id: string, instance: ComponentInstance | null) {
    if (!Object.prototype.hasOwnProperty.call(this.instancesMap, docId)) {
      this.instancesMap[docId] = new Map()
    }
    if (instance == null) {
      this.instancesMap[docId].delete(id)
    } else {
      this.instancesMap[docId].set(id, instance)
    }
  }

  getComponentInstances(node: Node) {
    const docId = node.document.id
    if (!docId) {
      return null
    }

    return this.instancesMap[docId]?.get(node.id) || null
  }

  getClosestNodeInstance(from: ComponentInstance, specId?: string): NodeInstance<ComponentInstance, Node> | null {
    const docId = this.project.currentDocument!.id

    if (specId && this.instancesMap[docId].has(specId)) {
      return {
        docId,
        nodeId: specId,
        instance: this.instancesMap[docId].get(specId)!,
        node: this.project.getDocument(docId)?.getNode(specId) || null,
      }
    }

    let current: Element | null = from
    while (current) {
      if (current.id) {
        // Check if element exists in instancesMap
        if (this.instancesMap[docId].has(current.id)) {
          return {
            docId,
            nodeId: current.id,
            instance: this.instancesMap[docId].get(current.id)!,
            node: this.project.getDocument(docId)?.getNode(current.id) || null,
          }
        }
      }
      current = current.parentElement
    }

    return null
  }

  getNodeInstanceFromElement(target: Element | null): NodeInstance<ComponentInstance, Node> | null {
    if (!target) {
      return null
    }

    return this.getClosestNodeInstance(target)
  }

  /**
   * compute the rect of node's instance
   */
  computeRect(node: Node) {
    const instance = this.getComponentInstances(node)
    if (!instance) {
      return null
    }
    return this.computeComponentInstanceRect(instance)
  }

  computeComponentInstanceRect(instance: ComponentInstance) {
    return instance.getBoundingClientRect()
  }

  /**
   * fix event's prop, canvasX、canvasY and target
   */
  fixEvent(e: LocateEvent): LocateEvent {
    if (e.fixed) {
      return e
    }

    const notMyEvent = e.originalEvent.view?.document !== this.contentDocument
    // fix canvasX canvasY
    if (notMyEvent || !('canvasX' in e) || !('canvasY' in e)) {
      const l = this.viewport.toLocalPoint({
        clientX: e.globalX,
        clientY: e.globalY,
      })
      e.canvasX = l.clientX
      e.canvasY = l.clientY
    }

    // fix target
    if (!e.target || notMyEvent) {
      if (!Number.isNaN(e.canvasX!) && !Number.isNaN(e.canvasY!)) {
        e.target = this.contentDocument?.elementFromPoint(e.canvasX!, e.canvasY!)
      }
    }

    e.fixed = true
    return e
  }

  /**
   * check the rect whether is in the viewport
   */
  isEnter(e: LocateEvent) {
    const rect = this.viewport.bounds
    return e.globalY >= rect.top && e.globalY <= rect.bottom && e.globalX >= rect.left && e.globalX <= rect.right
  }

  deactiveSensor() {
    this.sensing = false
  }

  locate(e: LocateEvent): any {
    const { dragObject } = e

    const nodes = dragObject?.nodes
    // calculate the nodes that can be moved
    const operationalNodes = nodes?.filter(node => {
      const onMoveHook = node?.componentMeta?.advanced?.callbacks?.onMoveHook
      const canMove = onMoveHook && typeof onMoveHook === 'function' ? onMoveHook(node) : true

      let parentContainerNode: Node | null = null
      let parentNode = node?.parent

      while (parentNode) {
        if (parentNode.isContainer()) {
          parentContainerNode = parentNode
          break
        }
        parentNode = parentNode.parent
      }

      const onChildMoveHook = parentContainerNode?.componentMeta?.advanced?.callbacks?.onChildMoveHook
      const childrenCanMove =
        onChildMoveHook && parentContainerNode && typeof onChildMoveHook === 'function'
          ? onChildMoveHook(node!, parentContainerNode)
          : true

      return canMove && childrenCanMove
    })

    if (nodes && (!operationalNodes || operationalNodes.length === 0)) {
      return
    }

    this.sensing = true
    const document = this.project.currentDocument
    if (!document) {
      return null
    }
    const dropContainer = this.getDropContainer(e)
    if (!dropContainer) {
      return null
    }
    const lockedNode = dropContainer?.container
      ? getClosestNode(dropContainer.container, node => node.isLocked())
      : null
    if (lockedNode) {
      return null
    }

    if (isLocationData(dropContainer)) {
      return this.designer.createLocation(dropContainer)
    }

    const { container, instance: containerInstance } = dropContainer

    const edge = this.computeComponentInstanceRect(containerInstance)

    if (!edge) {
      return null
    }

    const { children } = container!

    const detail: LocationChildrenDetail = {
      type: LocationDetailType.Children,
      index: -1,
      edge,
    }

    const locationData: LocationData<Node> = {
      target: container!,
      detail,
      source: `simulator${document.id}`,
      event: e,
    }

    if (e.dragObject && e.dragObject.nodes && e.dragObject.nodes.length && document.rootNode) {
      return this.designer.createLocation({
        target: document.rootNode!,
        detail,
        source: `simulator${document.id}`,
        event: e,
      })
    }

    if (!children || children.size < 1 || !edge) {
      return this.designer.createLocation(locationData)
    }

    return this.designer.createLocation(locationData)
  }

  /**
   * find the suitable drop container
   */
  getDropContainer(e: LocateEvent): DropContainer | null {
    const { target, dragObject } = e
    const isAny = isDragAnyObject(dragObject)
    const document = this.project.currentDocument!
    const { rootNode } = document
    let container: Node | null
    let nodeInstance: NodeInstance<ComponentInstance, Node> | undefined

    if (target) {
      const ref = this.getNodeInstanceFromElement(target)
      if (ref?.node) {
        nodeInstance = ref
        container = ref.node
      } else if (isAny) {
        return null
      } else {
        container = rootNode
      }
    } else if (isAny) {
      return null
    } else {
      container = rootNode
    }

    if (!container?.isParental()) {
      container = container?.parent || rootNode
    }

    // TODO: use spec container to accept specialData
    if (isAny) {
      // will return locationData
      return null
    }

    let instance: ComponentInstance | null | undefined = null
    if (nodeInstance) {
      if (nodeInstance.node === container) {
        instance = nodeInstance.instance
      } else {
        instance = this.getClosestNodeInstance(nodeInstance.instance, container?.id)?.instance
      }
    } else {
      instance = container && this.getComponentInstances(container!)
    }

    let dropContainer: DropContainer = {
      container: container!,
      instance: instance!,
    }

    let res: any
    let upward: DropContainer | null = null
    while (container) {
      res = this.handleAccept(dropContainer, e)
      if (res === true) {
        return dropContainer
      }
      if (!res) {
        if (upward) {
          dropContainer = upward
          container = dropContainer.container
          upward = null
        } else if (container.parent) {
          container = container.parent
          instance = this.getClosestNodeInstance(dropContainer.instance, container.id)?.instance
          dropContainer = {
            container,
            instance: instance!,
          }
        } else {
          return null
        }
      }
    }
    return null
  }

  handleAccept({ container }: DropContainer, e: LocateEvent): boolean {
    const { dragObject } = e
    const document = this.project.currentDocument!
    const { rootNode } = document
    if (container.isRoot() || container.contains(rootNode!)) {
      // return document.checkNesting(rootNode!, dragObject as any)
      return true
    }

    const meta = (container as Node).componentMeta

    if (!meta.isContainer) {
      return false
    }

    // return document.checkNesting(container, dragObject as any)
    return true
  }
}

export const isSimulator = (obj: any): obj is Simulator => {
  return obj && obj.isSimulator
}
