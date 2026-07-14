import type { IReactionDisposer, IReactionOptions, IReactionPublic } from 'mobx'
import { action, autorun, computed, observable, reaction } from 'mobx'
import { Config } from '../config'
import { Clipboard } from '../designer/clipboard'
import { DESIGNER_EVENT, type Designer } from '../designer/designer'
import { DragObjectType, type NodeInstance, isDragAnyObject, isShaken } from '../designer/dragon'
import {
  type LocateEvent,
  type LocationChildrenDetail,
  type LocationData,
  LocationDetailType,
  isLocationData,
} from '../designer/location'
import type { Scroller } from '../designer/scroller'
import { type Node, getClosestClickableNode, getClosestNode } from '../document'
import {
  assertLifecycleMutationAllowed,
  inheritLifecycleMutationGuard,
  sealLifecycleMutations,
} from '../lifecycle/mutation-barrier'
import { lockPrototypeAccessors, lockReadonlyProperties } from '../lifecycle/readonly-properties'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import type { Project } from '../project'
import type { ComponentInstance, DataSourceEngine, Snippet } from '../types'
import type { Asset } from '../types/assets'
import { type Disposable, type EventBus, type Hotkey, isDOMNodeVisible, isElementNode } from '../utils'
import type { SimulatorRenderer } from './simulator-renderer'
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
  readonly emitter: EventBus

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

  @computed
  get renderEnv(): string {
    return this.get('renderEnv') || 'default'
  }

  @computed
  get device(): string {
    return this.get('device') || 'default'
  }

  @computed
  get locale(): string {
    return this.get('locale')
  }

  @computed
  get deviceClassName(): string | undefined {
    return this.get('deviceClassName')
  }

  @computed
  get designMode(): DesignMode {
    // renderer 依赖
    return this.get('designMode') || 'design'
  }

  @computed
  get dataSourceEngine(): DataSourceEngine | undefined {
    // renderer 依赖
    return this.engineConfig.get('dataSourceEngine')
  }

  get enableStrictNotFoundMode(): any {
    return this.engineConfig.get('enableStrictNotFoundMode') ?? false
  }

  get excuteLifeCycleInDesignMode(): any {
    return this.engineConfig.get('excuteLifeCycleInDesignMode') ?? false
  }

  get notFoundComponent(): any {
    return this.engineConfig.get('notFoundComponent') ?? null
  }

  get faultComponent(): any {
    return this.engineConfig.get('faultComponent') ?? null
  }

  @computed get componentsAsset(): Asset | undefined {
    return this.get('componentsAsset')
  }

  @computed
  get deviceStyle(): DeviceStyleProps | undefined {
    return this.get('deviceStyle')
  }

  @computed
  get componentsMap() {
    // renderer 依赖
    return this.designer.materials.componentsMap
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

  @observable.ref private accessor _appHelper: any

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

  readonly #lifetimeDisposers = new Set<Disposable>()

  readonly #frameDisposers = new Set<Disposable>()

  #fallbackConfig?: Config

  #fallbackClipboard?: Clipboard

  get currentDocument() {
    return this.project.currentDocument
  }

  private get engineConfig(): Config {
    const engineConfig = (this.editor as typeof this.editor & { engineConfig?: Config }).engineConfig
    if (engineConfig) return engineConfig
    if (!this.#fallbackConfig) {
      this.#fallbackConfig = new Config()
      inheritLifecycleMutationGuard(this, this.#fallbackConfig)
      inheritEngineTeardownOwnership(this, this.#fallbackConfig)
    }
    return this.#fallbackConfig
  }

  private get engineClipboard(): Clipboard {
    const clipboard = this.editor.get<Clipboard>('clipboard')
    if (clipboard) return clipboard
    if (!this.#fallbackClipboard) {
      this.#fallbackClipboard = new Clipboard()
      inheritLifecycleMutationGuard(this, this.#fallbackClipboard)
      inheritEngineTeardownOwnership(this, this.#fallbackClipboard)
    }
    return this.#fallbackClipboard
  }

  constructor(project: Project, designer: Designer) {
    installLifecycleTeardownOperation(this, () => this.#purgeInternal())
    this.designer = designer
    this.project = project
    this.emitter = designer.createEventBus('Simulator')
    inheritEngineTeardownOwnership(this, this.emitter)
    this.viewport = new Viewport(designer)
    this.scroller = this.designer.createScroller(this.viewport)
    lockReadonlyProperties(this, ['designer', 'emitter', 'isSimulator', 'project', 'scroller', 'viewport'])
    lockPrototypeAccessors(this, ['currentDocument', 'editor'])
    this.autoRender = !this.engineConfig.get('disableAutoRender', false)
    this._appHelper = this.engineConfig.get('appHelper')

    this.#lifetimeDisposers.add(
      this.engineConfig.onGot('appHelper', data => {
        // appHelper被config.set修改后触发injectionConsumer.consume回调
        this._appHelper = data
      }),
    )
  }

  @action
  setProps(props: SimulatorProps) {
    assertLifecycleMutationAllowed(this, 'simulator.setProps')
    this._props = props
  }

  @action
  set(key: string, value: any) {
    assertLifecycleMutationAllowed(this, 'simulator.set')
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
    assertLifecycleMutationAllowed(this, 'simulator.connect')
    this._renderer = renderer
    return this.trackLifetime(autorun(effect, options))
  }

  reaction(
    expression: (reaction: IReactionPublic) => unknown,
    effect: (value: unknown, prev: unknown, reaction: IReactionPublic) => void,
    opts?: IReactionOptions<unknown, boolean>,
  ): IReactionDisposer {
    assertLifecycleMutationAllowed(this, 'simulator.reaction')
    return this.trackLifetime(reaction(expression, effect, opts))
  }

  autorun(
    effect: (reaction: IReactionPublic) => void,
    options?: IReactionOptions<unknown, boolean>,
  ): IReactionDisposer {
    assertLifecycleMutationAllowed(this, 'simulator.autorun')
    return this.trackLifetime(autorun(effect, options))
  }

  @action
  purge() {
    assertPublicLifecycleTeardownAllowed(this, 'simulator.purge')
    this.#purgeInternal()
  }

  #purgeInternal() {
    const errors: unknown[] = []
    try {
      this.disposeFrame()
    } catch (error) {
      errors.push(error)
    }
    let rendererDisposed = true
    try {
      this._renderer?.dispose?.()
    } catch (error) {
      rendererDisposed = false
      errors.push(error)
    }
    for (const dispose of [...this.#lifetimeDisposers].reverse()) {
      try {
        dispose()
        this.#lifetimeDisposers.delete(dispose)
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      this.viewport.dispose()
    } catch (error) {
      errors.push(error)
    }
    try {
      runInternalLifecycleTeardown(this.scroller)
    } catch (error) {
      errors.push(error)
    }
    try {
      if (this.#fallbackConfig) runInternalLifecycleTeardown(this.#fallbackConfig)
      this.#fallbackConfig = undefined
    } catch (error) {
      errors.push(error)
    }
    try {
      if (this.#fallbackClipboard) runInternalLifecycleTeardown(this.#fallbackClipboard)
      this.#fallbackClipboard = undefined
    } catch (error) {
      errors.push(error)
    }
    try {
      runInternalLifecycleTeardown(this.emitter)
    } catch (error) {
      errors.push(error)
    }
    if (rendererDisposed) {
      this._renderer = undefined
    }

    for (const docId in this.instancesMap) {
      this.instancesMap[docId].clear()
    }
    this.instancesMap = {}
    if (errors.length) {
      throw new AggregateError(errors, 'Simulator disposal completed with errors')
    }
    sealLifecycleMutations(this, 'simulator generation is disposed')
  }

  dispose() {
    assertPublicLifecycleTeardownAllowed(this, 'simulator.dispose')
    this.#purgeInternal()
  }

  private disposeFrame(): void {
    const errors: unknown[] = []
    for (const dispose of [...this.#frameDisposers].reverse()) {
      try {
        dispose()
        this.#frameDisposers.delete(dispose)
      } catch (error) {
        errors.push(error)
      }
    }
    this.iframe = undefined
    this._contentDocument = undefined
    this._contentWindow = undefined
    if (errors.length) {
      throw new AggregateError(errors, 'Simulator frame disposal completed with errors')
    }
  }

  private trackFrame<T extends Disposable>(disposer: T): T {
    let state: 'active' | 'disposing' | 'disposed' = 'active'
    const tracked = () => {
      if (state !== 'active') return
      state = 'disposing'
      try {
        disposer()
      } catch (error) {
        state = 'active'
        throw error
      }
      state = 'disposed'
      this.#frameDisposers.delete(tracked)
    }
    this.#frameDisposers.add(tracked)
    return tracked as T
  }

  private rollbackFrameAcquisition(checkpoint: ReadonlySet<Disposable>): unknown[] {
    const errors: unknown[] = []
    const acquired = [...this.#frameDisposers].filter(dispose => !checkpoint.has(dispose))
    for (const dispose of acquired.reverse()) {
      try {
        dispose()
        this.#frameDisposers.delete(dispose)
      } catch (error) {
        errors.push(error)
      }
    }
    return errors
  }

  private failFrameAcquisition(checkpoint: ReadonlySet<Disposable>, acquisitionError: unknown): never {
    const rollbackErrors = this.rollbackFrameAcquisition(checkpoint)
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [acquisitionError, ...rollbackErrors],
        'Simulator frame setup failed and rollback was incomplete',
      )
    }
    throw acquisitionError
  }

  private trackLifetime<T extends Disposable>(disposer: T): T {
    let state: 'active' | 'disposing' | 'disposed' = 'active'
    const tracked = () => {
      if (state !== 'active') return
      state = 'disposing'
      try {
        disposer()
      } catch (error) {
        state = 'active'
        throw error
      }
      state = 'disposed'
      this.#lifetimeDisposers.delete(tracked)
    }
    this.#lifetimeDisposers.add(tracked)
    return tracked as T
  }

  /**
   * force to rerender the viewport
   */
  rerender() {
    assertLifecycleMutationAllowed(this, 'simulator.rerender')
    this.renderer?.rerender?.()
  }

  @action
  async mountContentFrame(iframe: HTMLIFrameElement | HTMLElement | null) {
    assertLifecycleMutationAllowed(this, 'simulator.mountContentFrame')
    if (!iframe || this.iframe === iframe) {
      return
    }
    this.disposeFrame()
    let contentWindow: Window
    let contentDocument: Document
    if (typeof HTMLIFrameElement !== 'undefined' && iframe instanceof HTMLIFrameElement) {
      contentWindow = iframe.contentWindow!
      contentDocument = contentWindow.document
    } else {
      contentDocument = iframe.ownerDocument
      contentWindow = contentDocument.defaultView!
    }

    const checkpoint = new Set(this.#frameDisposers)
    try {
      // Register ownership immediately after each successful acquisition. The
      // event helpers register their provisional disposers before their first
      // listener is attached, so an exception cannot strand an unowned
      // listener between two setup calls.
      this.trackFrame(this.viewport.setScrollTarget(contentWindow))
      this.setupFrameEvents(contentDocument)

      // bind hotkey & clipboard
      const hotkey = this.editor.get<Hotkey>('hotkey')
      if (hotkey) {
        this.trackFrame(hotkey.mount(contentWindow))
      }
      this.trackFrame(this.engineClipboard.injectCopyPaster(contentDocument))

      // Publish the frame only after every frame-owned resource is acquired.
      // Renderer startup requires the public frame reference, but its own run
      // contract rolls back renderer resources before throwing.
      this.iframe = iframe
      this._contentDocument = contentDocument
      this._contentWindow = contentWindow
      this._renderer?.run()
    } catch (error) {
      this.iframe = undefined
      this._contentDocument = undefined
      this._contentWindow = undefined
      this.failFrameAcquisition(checkpoint, error)
    }
  }

  postEvent(eventName: string, ...data: any[]) {
    assertLifecycleMutationAllowed(this, 'simulator.postEvent')
    this.emitter.emit(eventName, ...data)
  }

  linkSnippet(ref: HTMLElement, snippet: Snippet) {
    assertLifecycleMutationAllowed(this, 'simulator.linkSnippet')
    return this.designer.dragon.from(ref, () => ({
      type: DragObjectType.NodeData,
      data: snippet.schema,
    }))
  }

  setSuspense(suspended: boolean) {
    return false
  }

  setupEvents(): Disposable[] {
    assertLifecycleMutationAllowed(this, 'simulator.setupEvents')
    const checkpoint = new Set(this.#frameDisposers)
    try {
      return this.setupFrameEvents(this.contentDocument!)
    } catch (error) {
      this.failFrameAcquisition(checkpoint, error)
    }
  }

  setupDragAndClick(): Disposable {
    assertLifecycleMutationAllowed(this, 'simulator.setupDragAndClick')
    const checkpoint = new Set(this.#frameDisposers)
    try {
      return this.setupFrameDragAndClick(this.contentDocument!)
    } catch (error) {
      this.failFrameAcquisition(checkpoint, error)
    }
  }

  private setupFrameEvents(contentDocument: Document): Disposable[] {
    return [this.setupFrameDragAndClick(contentDocument), this.setupFrameDetecting(contentDocument)]
  }

  private setupFrameDragAndClick(doc: Document): Disposable {
    const { designer } = this
    const pendingMouseups = new Set<(event: MouseEvent) => void>()
    let mousedownPending = true

    const onMouseDown = (downEvent: MouseEvent) => {
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

      const isLeftButton = downEvent.button === 0
      const checkSelect = (e: MouseEvent) => {
        doc.removeEventListener('mouseup', checkSelect, true)
        pendingMouseups.delete(checkSelect)

        const isLeftButtonSelect = e.button === 0
        // 鼠标是否移动 ? - 鼠标抖动应该也需要支持选中事件，偶尔点击不能选中，磁帖块移除 shaken 检测
        if (!isShaken(downEvent, e) && isLeftButtonSelect) {
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

      pendingMouseups.add(checkSelect)
      try {
        doc.addEventListener('mouseup', checkSelect, true)
      } catch (error) {
        try {
          doc.removeEventListener('mouseup', checkSelect, true)
          pendingMouseups.delete(checkSelect)
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Simulator mouseup listener setup failed and rollback was incomplete',
          )
        }
        throw error
      }
    }

    const dispose = this.trackFrame(() => {
      const errors: unknown[] = []
      if (mousedownPending) {
        try {
          doc.removeEventListener('mousedown', onMouseDown, true)
          mousedownPending = false
        } catch (error) {
          errors.push(error)
        }
      }
      for (const checkSelect of [...pendingMouseups]) {
        try {
          doc.removeEventListener('mouseup', checkSelect, true)
          pendingMouseups.delete(checkSelect)
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Simulator drag and click listener disposal failed')
      }
    })
    doc.addEventListener('mousedown', onMouseDown, true)
    return dispose
  }

  setupDetecting(): Disposable {
    assertLifecycleMutationAllowed(this, 'simulator.setupDetecting')
    const checkpoint = new Set(this.#frameDisposers)
    try {
      return this.setupFrameDetecting(this.contentDocument!)
    } catch (error) {
      this.failFrameAcquisition(checkpoint, error)
    }
  }

  private setupFrameDetecting(doc: Document): Disposable {
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
    const stopDraggingPropagation = (e: Event) => {
      if (dragon.dragging) {
        e.stopPropagation()
      }
    }

    const listeners = [
      ['mouseover', hover, true],
      ['mouseleave', leave, false],
      // TODO: refactor this line, contains click, mousedown, mousemove
      ['mousemove', stopDraggingPropagation, true],
    ] as const
    const pendingRemovals = new Set<(typeof listeners)[number]>()
    const dispose = this.trackFrame(() => {
      const errors: unknown[] = []
      for (const listener of [...pendingRemovals].reverse()) {
        const [type, callback, options] = listener
        try {
          doc.removeEventListener(type, callback, options)
          pendingRemovals.delete(listener)
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Simulator detecting listener disposal failed')
      }
    })
    for (const listener of listeners) {
      const [type, callback, options] = listener
      // Mark the removal as pending before acquisition. This remains safe when
      // addEventListener throws before installing anything, and also covers a
      // host implementation that installs a listener and then throws.
      pendingRemovals.add(listener)
      doc.addEventListener(type, callback, options)
    }
    return dispose
  }

  @action
  setInstance(docId: string, id: string, instances: ComponentInstance[] | null) {
    assertLifecycleMutationAllowed(this, 'simulator.setInstance')
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
    assertLifecycleMutationAllowed(this, 'simulator.scrollToNode')
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
    assertLifecycleMutationAllowed(this, 'simulator.fixEvent')
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
    assertLifecycleMutationAllowed(this, 'simulator.deactiveSensor')
    this.sensing = false
    this.scroller.cancel()
  }

  locate(e: LocateEvent): any {
    assertLifecycleMutationAllowed(this, 'simulator.locate')
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
