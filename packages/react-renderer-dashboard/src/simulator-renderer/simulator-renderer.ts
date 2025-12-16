import {
  type SimulatorRenderer as ISimulatorRenderer,
  type NodeInstance,
  type Simulator,
  isElementNode,
} from '@easy-editor/core'
import type { RendererProps } from '@easy-editor/renderer-core'
import { type MemoryHistory, createMemoryHistory } from 'history'
import { isPlainObject } from 'lodash-es'
import { action, computed, observable, runInAction, untracked } from 'mobx'
import { type ReactInstance, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SimulatorRendererView } from './RendererView'
import { DocumentInstance, REACT_KEY, SYMBOL_VDID, SYMBOL_VNID, cacheReactKey } from './document-instance'
import { buildComponents, getClientRects, reactFindDOMNodes, withQueryParams } from './utils'

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

  private _running = false

  host: Simulator

  mount(host: Simulator) {
    this.host = host
    this.init()
  }

  @action
  init() {
    this.autoRender = this.host.autoRender

    this.disposeFunctions.push(
      this.host.connect(this, () => {
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
          this._appContext = {
            ...this._appContext,
            dataSourceEngine: this._dataSourceEngine,
          }

          // sync device
          this._device = this.host.device
        })
      }),
    )
    const documentInstanceMap = new Map<string, DocumentInstance>()
    this.disposeFunctions.push(
      this.host.autorun(() => {
        runInAction(() => {
          this._documentInstances = this.host.project.documents.map(doc => {
            let inst = documentInstanceMap.get(doc.id)
            if (!inst) {
              inst = new DocumentInstance(this, doc)
              documentInstanceMap.set(doc.id, inst)
            }
            return inst
          })
        })

        const path = this.host.project.currentDocument
          ? documentInstanceMap.get(this.host.project.currentDocument.id)!.path
          : '/'

        if (this.history.location.pathname !== path) {
          this.history.push(path, { replace: true })
        }
      }),
    )

    const history = createMemoryHistory({ initialEntries: ['/'] })
    this.history = history
    history.listen(({ location }) => {
      const docId = location.pathname.slice(1)
      docId && this.host.project.open(docId)
    })

    this._appContext = {
      utils: {
        // ...getProjectUtils(this._libraryMap, host.get('utilsMetadata')),
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
      constants: {},
      dataSourceEngine: this._dataSourceEngine,
    }
  }

  private buildComponents() {
    this._components = buildComponents(this._libraryMap, this._componentsMap)
    // this._components = {
    //   ...builtinComponents,
    //   ...this._components,
    // }
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
    if (this._running) {
      return
    }
    this._running = true
    let container = this.host.iframe
    if (!container) {
      const containerId = 'easy-editor'
      container = document.getElementById(containerId)!
      if (!container) {
        container = document.createElement('div')
        document.body.appendChild(container)
        container.id = containerId
      }
    }

    createRoot(container).render(
      createElement(SimulatorRendererView, {
        simulatorRenderer: this,
      }),
    )

    this.host.project.setRendererReady(this)
  }

  /**
   * 刷新渲染器
   */
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
    this.disposeFunctions.forEach(fn => fn())
    this.documentInstances.forEach(docInst => docInst.dispose())
    untracked(() => {
      this._componentsMap = {}
      this._components = null
      this._appContext = {}
    })
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

export const simulatorRenderer = new SimulatorRendererContainer()
