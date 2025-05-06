import type { IReactionDisposer, IReactionOptions, IReactionPublic } from 'mobx'
import type {
  Component,
  ComponentInstance,
  Designer,
  LocateEvent,
  LocationChildrenDetail,
  LocationData,
  NodeInstance,
  Snippet,
} from '../designer'
import type { Node } from '../document'
import type { Project } from '../project'
import type { SimulatorRenderer } from './simulator-renderer'

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
import type { Scroller } from '../designer/scroller'
import { getClosestClickableNode, getClosestNode } from '../document'
import { createEventBus, isDOMNodeVisible, isElementNode } from '../utils'
import { Viewport } from './viewport'

export interface DropContainer {
  container: Node
  instance: ComponentInstance
}

export type DesignMode = 'design' | 'preview' | 'live'

export type Device = 'mobile' | 'iphone' | 'pc' | string

export interface SimulatorProps {
  designMode?: DesignMode
  device?: Device
  deviceClassName?: string
  requestHandlersMap?: any

  // TODO
  // library?: LibraryItem[];
  // utilsMetadata?: UtilsMetadata
  // simulatorUrl?: Asset;
  // theme?: Asset;
  // componentsAsset?: Asset;

  [key: string]: any
}

export interface DeviceStyleProps {
  canvas?: object
  viewport?: object
  content?: object
}

export class Simulator {
  readonly emitter = createEventBus('Simulator')

  isSimulator = true

  readonly project: Project

  readonly designer: Designer

  readonly viewport: Viewport

  readonly scroller: Scroller

  iframe?: HTMLElement

  autoRender = true

  get editor() {
    return this.designer.editor
  }

  @computed get device(): string {
    return this.get('device') || 'default'
  }

  @computed get requestHandlersMap(): any {
    // renderer 依赖
    return this.get('requestHandlersMap') || null
  }

  get enableStrictNotFoundMode(): any {
    return this.editor.get('enableStrictNotFoundMode') ?? false
  }

  get excuteLifeCycleInDesignMode(): any {
    return this.editor.get('excuteLifeCycleInDesignMode') ?? false
  }

  get notFoundComponent(): any {
    return this.editor.get('notFoundComponent') ?? null
  }

  get faultComponent(): any {
    return this.editor.get('faultComponent') ?? null
  }

  @computed
  get designMode(): DesignMode {
    return this.get('designMode') || 'design'
  }

  @computed get deviceStyle(): DeviceStyleProps | undefined {
    return this.get('deviceStyle')
  }

  @computed get componentsMap() {
    // renderer 依赖
    return this.designer.componentMetaManager.componentsMap
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
    [docId: string]: Map<string, ComponentInstance[]>
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

  get currentDocument() {
    return this.project.currentDocument
  }

  constructor(designer: Designer) {
    this.designer = designer
    this.project = designer.project
    this.viewport = new Viewport(designer)
    this.scroller = this.designer.createScroller(this.viewport)
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

  connect(
    renderer: SimulatorRenderer,
    effect: (reaction: IReactionPublic) => void,
    options?: IReactionOptions<unknown, boolean>,
  ) {
    this._renderer = renderer
    return autorun(effect, options)
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
   * force to rerender the viewport
   */
  rerender() {
    this.renderer?.rerender?.()
  }

  @action
  mountContentFrame(iframe: HTMLIFrameElement | HTMLElement | null) {
    if (!iframe || this.iframe === iframe) {
      return
    }
    this.iframe = iframe

    if (iframe instanceof HTMLIFrameElement) {
      this._contentWindow = iframe.contentWindow!
      this._contentDocument = this._contentWindow.document
    } else {
      this._contentDocument = iframe.ownerDocument
      this._contentWindow = iframe.ownerDocument.defaultView!
    }

    // ready & render
    this._renderer?.run()

    // init events, overlays
    this.viewport.setScrollTarget(this._contentWindow)
    this.setupEvents()

    // bind hotkey & clipboard
    clipboard.injectCopyPaster(this._contentDocument!)
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

  setSuspense(suspended: boolean) {
    return false
  }

  setupEvents() {
    this.setupDragAndClick()
    this.setupDetecting()
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
        // const node = getClosestClickableNode(nodeInst?.node || rootNode, downEvent)
        // TODO: 默认不选择根节点，不然点击外部任意位置，都会选中根节点，后面想想有没有其他办法
        const node = getClosestClickableNode(nodeInst?.node, downEvent)
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
  addComponent(name: string, component: Component, override = false) {
    if (this._components[name] && !override) {
      return
    }

    this._components[name] = component
  }

  @action
  setInstance(docId: string, id: string, instances: ComponentInstance[] | null) {
    if (!Object.prototype.hasOwnProperty.call(this.instancesMap, docId)) {
      this.instancesMap[docId] = new Map()
    }
    if (instances == null) {
      this.instancesMap[docId].delete(id)
    } else {
      this.instancesMap[docId].set(id, instances.slice())
    }
  }

  getInstance(docId: string, id: string) {
    return this.instancesMap[docId]?.get(id)?.[0]
  }

  getComponentInstances(node: Node, context?: NodeInstance<ComponentInstance, Node>): ComponentInstance | null {
    const docId = node.document?.id
    if (!docId) {
      return null
    }

    const instances = this.instancesMap[docId]?.get(node.id) || null
    if (!instances || !context) {
      return instances
    }

    return instances.filter(instance => {
      return this.getClosestNodeInstance(instance, context?.nodeId)?.instance === context.instance
    })
  }

  getClosestNodeInstance(from: ComponentInstance, specId?: string): NodeInstance<ComponentInstance> | null {
    return this.renderer?.getClosestNodeInstance(from, specId) || null
  }

  computeRect(node: Node) {
    const instances = this.getComponentInstances(node)
    if (!instances) {
      return null
    }
    return this.computeComponentInstanceRect(instances[0])
  }

  computeComponentInstanceRect(instance: ComponentInstance, selector?: string): DOMRect | undefined {
    const rect = this.renderer?.getClientRects(instance)?.[0]
    return rect
    // const renderer = this.renderer!;
    // const elements = this.findDOMNodes(instance, selector);
    // if (!elements) {
    //   return null;
    // }

    // const elems = elements.slice();
    // let rects: DOMRect[] | undefined;
    // let last: { x: number; y: number; r: number; b: number } | undefined;
    // let _computed = false;
    // while (true) {
    //   if (!rects || rects.length < 1) {
    //     const elem = elems.pop();
    //     if (!elem) {
    //       break;
    //     }
    //     rects = renderer.getClientRects(elem);
    //   }
    //   const rect = rects.pop();
    //   if (!rect) {
    //     break;
    //   }
    //   if (rect.width === 0 && rect.height === 0) {
    //     continue;
    //   }
    //   if (!last) {
    //     last = {
    //       x: rect.left,
    //       y: rect.top,
    //       r: rect.right,
    //       b: rect.bottom,
    //     };
    //     continue;
    //   }
    //   if (rect.left < last.x) {
    //     last.x = rect.left;
    //     _computed = true;
    //   }
    //   if (rect.top < last.y) {
    //     last.y = rect.top;
    //     _computed = true;
    //   }
    //   if (rect.right > last.r) {
    //     last.r = rect.right;
    //     _computed = true;
    //   }
    //   if (rect.bottom > last.b) {
    //     last.b = rect.bottom;
    //     _computed = true;
    //   }
    // }

    // if (last) {
    //   const r: IPublicTypeRect = new DOMRect(last.x, last.y, last.r - last.x, last.b - last.y);
    //   r.elements = elements;
    //   r.computed = _computed;
    //   return r;
    // }

    // return null;
  }

  findDOMNodes(instance: ComponentInstance, selector?: string): Array<Element | Text> | null {
    const elements = this._renderer?.findDOMNodes(instance)
    if (!elements) {
      return null
    }

    if (selector) {
      const matched = getMatched(elements, selector)
      if (!matched) {
        return null
      }
      return [matched]
    }
    return elements
  }

  getNodeInstanceFromElement(target: Element | null): NodeInstance<ComponentInstance, Node> | null {
    if (!target) {
      return null
    }

    const nodeInstance = this.getClosestNodeInstance(target)
    if (!nodeInstance) {
      return null
    }
    const { docId } = nodeInstance
    const doc = this.project.getDocument(docId)!
    const node = doc.getNode(nodeInstance.nodeId)
    return {
      ...nodeInstance,
      node,
    }
  }

  scrollToNode(node: Node, detail?: any) {
    if (this.sensing) {
      // active sensor
      return
    }

    const opt: any = {}
    let scroll = false

    const componentInstance = this.getComponentInstances(detail?.near?.node || node)?.[0]
    if (!componentInstance) return
    const domNode = this.findDOMNodes(componentInstance)?.[0] as Element
    if (!domNode) return
    if (isElementNode(domNode) && !isDOMNodeVisible(domNode, this.viewport)) {
      const { left, top } = domNode.getBoundingClientRect()
      const { scrollTop = 0, scrollLeft = 0 } = this.contentDocument?.documentElement || {}
      opt.left = left + scrollLeft
      opt.top = top + scrollTop
      scroll = true
    }

    if (scroll && this.scroller) {
      this.scroller.scrollTo(opt)
    }
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
    this.scroller.cancel()
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
        if (parentNode.isContainer) {
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
    this.scroller.scrolling(e)
    const document = this.project.currentDocument
    if (!document) {
      return null
    }
    const dropContainer = this.getDropContainer(e)
    if (!dropContainer) {
      return null
    }
    const lockedNode = dropContainer?.container ? getClosestNode(dropContainer.container, node => node.locked) : null
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

    if (!container?.isParental) {
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
      instance = container && this.getComponentInstances(container!)[0]
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
    if (container.isRoot || container.contains(rootNode!)) {
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

const getMatched = (elements: Array<Element | Text>, selector: string): Element | null => {
  let firstQueried: Element | null = null
  for (const elem of elements) {
    if (isElementNode(elem)) {
      if (elem.matches(selector)) {
        return elem
      }

      if (!firstQueried) {
        firstQueried = elem.querySelector(selector)
      }
    }
  }
  return firstQueried
}
