import {
  type SimulatorRenderer as ISimulatorRenderer,
  type NodeInstance,
  type Simulator,
  isElementNode,
} from '@easy-editor/core/instance'
import type { RendererProps } from '@easy-editor/renderer-core'
import { type MemoryHistory, createMemoryHistory } from 'history'
import { isPlainObject } from 'lodash-es'
import { action, computed, observable, runInAction } from 'mobx'
import { type ReactInstance, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { SimulatorRendererView } from './RendererView'
import { DocumentInstance, REACT_KEY, SYMBOL_VDID, SYMBOL_VNID, cacheReactKey } from './document-instance'
import { buildComponents, getClientRects, reactFindDOMNodes, withQueryParams } from './utils'

type RenderLifecycleState = 'idle' | 'starting' | 'running' | 'disposing'

const FALLBACK_CONTAINER_OWNER = Symbol.for('@easy-editor/react-renderer-dashboard/fallback-owner')
const RENDER_CONTAINER_LEASE = Symbol.for('@easy-editor/react-renderer-dashboard/container-lease')

interface RenderResourceScope {
  readonly generation: number
  leasedContainer?: Element
  root?: Root
  ownedFallbackContainer?: HTMLElement
}

const hasOwnMarker = (target: object, marker: symbol): boolean =>
  Object.getOwnPropertyDescriptor(target, marker) !== undefined

const hasCommittedOutcome = (error: unknown): error is { readonly committed: true } => {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return false
  const descriptor = Object.getOwnPropertyDescriptor(error, 'committed')
  return !!descriptor && 'value' in descriptor && descriptor.value === true
}

export class SimulatorRendererContainer implements ISimulatorRenderer {
  readonly isSimulatorRenderer = true

  private _dataSourceEngine: any

  private disposeFunctions: Array<() => void> = []

  history: MemoryHistory

  @observable.ref private accessor _documentInstances: DocumentInstance[] = []
  get documentInstances() {
    return this._documentInstances
  }

  @observable private accessor _layout: any = null

  @computed get layout(): any {
    return this._layout
  }

  set layout(value: any) {
    this._layout = value
  }

  private _libraryMap: { [key: string]: string } = {}

  private _components: Record<string, React.ComponentType> | null = {}
  get components(): Record<string, React.ComponentType> {
    return this._components || {}
  }

  @observable.ref private accessor _appContext: NonNullable<RendererProps['appHelper']> = {}
  @computed get context() {
    return this._appContext
  }

  @observable.ref private accessor _designMode: NonNullable<RendererProps['designMode']> = 'design'
  @computed get designMode() {
    return this._designMode
  }

  @observable.ref private accessor _device: NonNullable<RendererProps['device']> = 'default'
  @computed get device() {
    return this._device
  }

  @observable.ref private accessor _componentsMap: NonNullable<RendererProps['componentsMap']> = {}
  @computed get componentsMap() {
    return this._componentsMap
  }

  /**
   * 是否为画布自动渲染
   */
  autoRender = true

  /**
   * 画布是否自动监听事件来重绘节点
   */
  autoRepaintNode = true

  #renderState: RenderLifecycleState = 'idle'

  #renderGeneration = 0

  #renderResources?: RenderResourceScope

  private _host?: Simulator

  get host(): Simulator {
    if (!this._host) {
      throw new Error('SimulatorRendererContainer must be mounted before use')
    }
    return this._host
  }

  mount(host: Simulator) {
    if (this.#renderState === 'disposing') {
      throw new Error('SimulatorRendererContainer cannot mount while disposal is in progress')
    }
    if (this._host === host) {
      if (this.#renderState !== 'idle' || !this.#renderResources) {
        return
      }
      this.dispose()
    }
    if (this._host || this.#renderResources || this.disposeFunctions.length > 0 || this.documentInstances.length > 0) {
      this.dispose()
    }
    this._host = host
    try {
      this.init()
    } catch (error) {
      try {
        this.dispose()
      } catch (disposeError) {
        throw new AggregateError([error, disposeError], 'Simulator renderer mount rollback completed with errors')
      }
      throw error
    }
  }

  @action
  init() {
    this.autoRender = this.host.autoRender
    this.autoRepaintNode = true

    const history = createMemoryHistory({ initialEntries: ['/'] })
    this.history = history
    this.disposeFunctions.push(
      history.listen(({ location }) => {
        const docId = location.pathname.slice(1)
        docId && this.host.project.open(docId)
      }),
    )

    const createAppContext = (): NonNullable<RendererProps['appHelper']> => {
      const appHelper = this.host.appHelper || {}
      return {
        ...appHelper,
        utils: {
          ...appHelper.utils,
          router: {
            navigate: (path: string, param?: object & { replace?: boolean }) => {
              if (param?.replace) {
                history.replace(withQueryParams(path, param))
              } else {
                history.push(withQueryParams(path, param))
              }
            },
          },
        },
        constants: { ...appHelper.constants },
        dataSourceEngine: this._dataSourceEngine,
      }
    }

    this._dataSourceEngine = this.host.dataSourceEngine
    this._appContext = createAppContext()

    this.disposeFunctions.push(
      this.host.connect(this, () => {
        // 用于添加到mobx依赖
        this.host.designer.materials.componentsMap

        runInAction(() => {
          // sync layout config
          this._layout = this.host.project.get('config')?.layout

          // todo: split with others, not all should recompute
          // if (this._libraryMap !== host.libraryMap) {
          //   this._libraryMap = host.libraryMap || {}
          // }
          if (this._componentsMap !== this.host.designer.materials.componentsMap) {
            this._componentsMap = this.host.designer.materials.componentsMap
            this.buildComponents()
          }

          // sync designMode
          this._designMode = this.host.designMode

          // sync dataSourceEngine
          this._dataSourceEngine = this.host.dataSourceEngine
          this._appContext = createAppContext()

          // sync device
          this._device = this.host.device
        })
      }),
    )
    const documentInstanceMap = new Map<string, DocumentInstance>()
    this.disposeFunctions.push(
      this.host.autorun(() => {
        const staleDocumentInstances: DocumentInstance[] = []
        runInAction(() => {
          const nextDocumentInstanceMap = new Map<string, DocumentInstance>()
          this._documentInstances = this.host.project.documents.map(document => {
            const cachedInstance = documentInstanceMap.get(document.id)
            if (cachedInstance?.document === document) {
              nextDocumentInstanceMap.set(document.id, cachedInstance)
              return cachedInstance
            }

            if (cachedInstance) {
              staleDocumentInstances.push(cachedInstance)
            }
            const nextInstance = new DocumentInstance(this, document)
            nextDocumentInstanceMap.set(document.id, nextInstance)
            return nextInstance
          })

          for (const [documentId, documentInstance] of documentInstanceMap) {
            if (!nextDocumentInstanceMap.has(documentId)) {
              staleDocumentInstances.push(documentInstance)
            }
          }

          documentInstanceMap.clear()
          for (const [documentId, documentInstance] of nextDocumentInstanceMap) {
            documentInstanceMap.set(documentId, documentInstance)
          }
        })

        staleDocumentInstances.forEach(documentInstance => documentInstance.dispose())

        const path = this.host.project.currentDocument
          ? documentInstanceMap.get(this.host.project.currentDocument.id)!.path
          : '/'

        if (this.history.location.pathname !== path) {
          this.history.replace(path)
        }
      }),
    )
  }

  private buildComponents() {
    // 远程组件已通过 materials.createComponentMeta 注册到 componentsMap，无需额外合并
    this._components = buildComponents(this._libraryMap, this._componentsMap)
  }

  /**
   * 加载资源
   */
  // load(asset: Asset): Promise<any> {
  //   return loader.load(asset)
  // }

  // async loadAsyncLibrary(asyncLibraryMap: Record<string, any>) {
  //   await loader.loadAsyncLibrary(asyncLibraryMap)
  //   this.buildComponents()
  // }

  getComponent(componentName: string) {
    const paths = componentName.split('.')
    const subs: string[] = []

    while (true) {
      const component = this._components?.[componentName]
      if (component) {
        // return getSubComponent(component, subs)
        return component
      }

      const sub = paths.pop()
      if (!sub) {
        return null
      }
      subs.unshift(sub)
      componentName = paths.join('.')
    }
  }

  getClosestNodeInstance(from: ReactInstance, nodeId?: string): NodeInstance<ReactInstance> | null {
    return getClosestNodeInstance(from, nodeId)
  }

  findDOMNodes(instance: ReactInstance): Array<Element | Text> | null {
    return reactFindDOMNodes(instance)
  }

  getClientRects(element: Element | Text) {
    return getClientRects(element)
  }

  // createComponent(schema: ProjectSchema): Component | null {
  //   const _schema: ProjectSchema = {
  //     ...schema,
  //   }

  //   const componentsTreeSchema = _schema.componentsTree[0]

  //   if (componentsTreeSchema.componentName === 'Component' && componentsTreeSchema.css) {
  //     const doc = window.document
  //     const s = doc.createElement('style')
  //     s.setAttribute('type', 'text/css')
  //     s.setAttribute('id', `Component-${componentsTreeSchema.id || ''}`)
  //     s.appendChild(doc.createTextNode(componentsTreeSchema.css || ''))
  //     doc.getElementsByTagName('head')[0].appendChild(s)
  //   }

  //   const renderer = this

  //   class LowCodeComp extends Component<any, any> {
  //     render() {
  //       const extraProps = getLowCodeComponentProps(this.props)
  //       return (
  //         <DashboardRenderer
  //           {...extraProps} // 防止覆盖下面内置属性
  //           // 使用 _schema 为了使低代码组件在页面设计中使用变量，同 react 组件使用效果一致
  //           schema={componentsTreeSchema}
  //           components={renderer.components}
  //           designMode=''
  //           messages={_schema.i18n || {}}
  //           device={renderer.device}
  //           appHelper={renderer.context}
  //           rendererName='LowCodeRenderer'
  //           faultComponent={renderer.host.faultComponent}
  //           faultComponentMap={renderer.host.faultComponentMap}
  //           customCreateElement={(Comp: any, props: any, children: any) => {
  //             const { __id, __designMode, ...viewProps } = props

  //             // mock _leaf，减少性能开销
  //             const _leaf = {
  //               isEmpty: () => false,
  //               isMock: true,
  //             }
  //             viewProps._leaf = _leaf

  //             return createElement(Comp, viewProps, children)
  //           }}
  //         />
  //       )
  //     }
  //   }

  //   return LowCodeComp
  // }

  run() {
    if (this.#renderState !== 'idle') {
      return
    }

    const retainedResources = this.#renderResources
    if (retainedResources) {
      this.#renderState = 'disposing'
      const cleanupErrors = this.#releaseRenderResources(retainedResources)
      this.#renderState = 'idle'
      if (cleanupErrors.length) {
        throw new AggregateError(cleanupErrors, 'Simulator renderer retained-resource cleanup completed with errors')
      }
    }

    const host = this.host
    const generation = ++this.#renderGeneration
    const resources: RenderResourceScope = { generation }
    this.#renderResources = resources
    this.#renderState = 'starting'

    try {
      const container = this.#acquireRenderContainer(host, resources)
      const root = createRoot(container)
      resources.root = root
      root.render(
        createElement(SimulatorRendererView, {
          simulatorRenderer: this,
        }),
      )

      if (this.#renderGeneration !== resources.generation || this.#renderResources !== resources) {
        return
      }

      this.#renderState = 'running'
      try {
        return host.project.setRendererReady(this)
      } catch (error) {
        if (!hasCommittedOutcome(error)) throw error
        return Object.freeze({
          committed: true as const,
          observerErrors: Object.freeze([error]),
          status: 'committed_with_observer_errors' as const,
        })
      }
    } catch (error) {
      if (this.#renderGeneration === resources.generation) {
        this.#renderState = 'disposing'
      }
      const cleanupErrors = this.#releaseRenderResources(resources)
      if (this.#renderGeneration === resources.generation) {
        this.#renderState = 'idle'
      }
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], 'Simulator renderer startup rollback completed with errors')
      }
      throw error
    }
  }

  #acquireRenderContainer(host: Simulator, resources: RenderResourceScope): Element {
    if (host.iframe) {
      this.#claimRenderContainer(host.iframe, resources)
      return host.iframe
    }

    const containerId = 'easy-editor'
    const existingContainer = document.getElementById(containerId)
    if (
      existingContainer &&
      !hasOwnMarker(existingContainer, FALLBACK_CONTAINER_OWNER) &&
      !hasOwnMarker(existingContainer, RENDER_CONTAINER_LEASE)
    ) {
      this.#claimRenderContainer(existingContainer, resources)
      return existingContainer
    }

    const ownedContainer = document.createElement('div')
    resources.ownedFallbackContainer = ownedContainer
    Object.defineProperty(ownedContainer, FALLBACK_CONTAINER_OWNER, {
      configurable: false,
      enumerable: false,
      value: resources,
      writable: false,
    })
    if (!existingContainer) {
      ownedContainer.id = containerId
    }
    document.body.appendChild(ownedContainer)
    this.#claimRenderContainer(ownedContainer, resources)
    return ownedContainer
  }

  #claimRenderContainer(container: Element, resources: RenderResourceScope): void {
    const existingLease = Object.getOwnPropertyDescriptor(container, RENDER_CONTAINER_LEASE)
    if (existingLease) {
      const owner = 'value' in existingLease ? existingLease.value : undefined
      if (owner !== resources) {
        throw new Error('Simulator render container is already leased by another renderer')
      }
    } else {
      Object.defineProperty(container, RENDER_CONTAINER_LEASE, {
        configurable: true,
        enumerable: false,
        value: resources,
        writable: false,
      })
    }
    resources.leasedContainer = container
  }

  #releaseRenderResources(resources: RenderResourceScope): unknown[] {
    const errors: unknown[] = []
    const root = resources.root
    if (root) {
      try {
        root.unmount()
        if (resources.root === root) {
          resources.root = undefined
        }
      } catch (error) {
        errors.push(error)
      }
    }

    const leasedContainer = resources.leasedContainer
    if (!resources.root && leasedContainer) {
      const lease = Object.getOwnPropertyDescriptor(leasedContainer, RENDER_CONTAINER_LEASE)
      if (!lease || !('value' in lease) || lease.value !== resources) {
        resources.leasedContainer = undefined
      } else {
        try {
          if (!Reflect.deleteProperty(leasedContainer, RENDER_CONTAINER_LEASE)) {
            throw new Error('Simulator render container lease could not be released')
          }
          if (resources.leasedContainer === leasedContainer) {
            resources.leasedContainer = undefined
          }
        } catch (error) {
          errors.push(error)
        }
      }
    }

    const ownedFallbackContainer = resources.ownedFallbackContainer
    if (ownedFallbackContainer) {
      try {
        ownedFallbackContainer.remove()
        if (resources.ownedFallbackContainer === ownedFallbackContainer) {
          resources.ownedFallbackContainer = undefined
        }
      } catch (error) {
        errors.push(error)
      }
    }

    if (
      !resources.root &&
      !resources.leasedContainer &&
      !resources.ownedFallbackContainer &&
      this.#renderResources === resources
    ) {
      this.#renderResources = undefined
    }

    return errors
  }

  /**
   * 刷新渲染器
   */
  @action
  rerender() {
    this.autoRender = true
    // TODO: 不太优雅
    this._appContext = { ...this._appContext }
  }

  stopAutoRepaintNode() {
    this.autoRepaintNode = false
  }

  enableAutoRepaintNode() {
    this.autoRepaintNode = true
  }

  dispose() {
    if (this.#renderState === 'disposing') {
      return
    }

    const errors: unknown[] = []
    ++this.#renderGeneration
    this.#renderState = 'disposing'

    const disposeFunctions = this.disposeFunctions.splice(0).reverse()
    const failedDisposeFunctions: Array<() => void> = []
    for (const dispose of disposeFunctions) {
      try {
        dispose()
      } catch (error) {
        failedDisposeFunctions.unshift(dispose)
        errors.push(error)
      }
    }
    this.disposeFunctions = [...failedDisposeFunctions, ...this.disposeFunctions]

    const renderResources = this.#renderResources
    if (renderResources) {
      errors.push(...this.#releaseRenderResources(renderResources))
    }

    const documentInstances = [...this.documentInstances].reverse()
    const failedDocumentInstances: DocumentInstance[] = []
    for (const documentInstance of documentInstances) {
      try {
        documentInstance.dispose()
      } catch (error) {
        failedDocumentInstances.unshift(documentInstance)
        errors.push(error)
      }
    }

    try {
      runInAction(() => {
        this._documentInstances = failedDocumentInstances
        this._layout = null
        this._libraryMap = {}
        this._componentsMap = {}
        this._components = null
        this._appContext = {}
        this._dataSourceEngine = undefined
      })
    } catch (error) {
      errors.push(error)
    }
    this._host = undefined
    this.autoRepaintNode = true
    this.#renderState = 'idle'

    if (errors.length) {
      throw new AggregateError(errors, 'Simulator renderer disposal completed with errors')
    }
  }
}

export const getReactInternalFiber = (el: any) => {
  return el._reactInternals || el._reactInternalFiber
}

const getClosestNodeInstance = (from: ReactInstance, specId?: string): NodeInstance<ReactInstance> | null => {
  let el: any = from
  if (el) {
    if (isElementNode(el)) {
      el = cacheReactKey(el)
    } else {
      return getNodeInstance(getReactInternalFiber(el), specId)
    }
  }
  while (el) {
    if (SYMBOL_VNID in el) {
      const nodeId = el[SYMBOL_VNID]
      const docId = el[SYMBOL_VDID]
      if (!specId || specId === nodeId) {
        return {
          docId,
          nodeId,
          instance: el,
        }
      }
    }
    // get fiberNode from element
    if (el[REACT_KEY]) {
      return getNodeInstance(el[REACT_KEY], specId)
    }
    el = el.parentElement
  }
  return null
}

const getNodeInstance = (fiberNode: any, specId?: string): NodeInstance<ReactInstance> | null => {
  const instance = fiberNode?.stateNode
  if (instance && SYMBOL_VNID in instance) {
    const nodeId = instance[SYMBOL_VNID]
    const docId = instance[SYMBOL_VDID]
    if (!specId || specId === nodeId) {
      return {
        docId,
        nodeId,
        instance,
      }
    }
  }
  if (!instance && !fiberNode?.return) return null
  return getNodeInstance(fiberNode?.return)
}

const getLowCodeComponentProps = (props: any) => {
  if (!props || !isPlainObject(props)) {
    return props
  }
  const newProps: any = {}
  Object.keys(props).forEach(k => {
    if (['children', 'componentId', '__designMode', '_componentName', '_leaf'].includes(k)) {
      return
    }
    newProps[k] = props[k]
  })
  newProps.componentName = props._componentName
  return newProps
}
