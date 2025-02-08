import type {
  DesignMode,
  JSONObject,
  Node,
  NodeSchema,
  RootSchema,
  Simulator,
  SimulatorRenderer,
} from '@easy-editor/core'
import type { Component } from 'react'
import type { FaultComponentProps } from './components/FaultComponent'
import type { NotFoundComponentProps } from './components/NotFoundComponent'

export type Schema = NodeSchema | RootSchema

export interface RendererState {
  engineRenderError?: boolean
  error?: Error
}

export interface RendererProps {
  /** 符合低代码搭建协议的数据 */
  schema: RootSchema | NodeSchema

  /** 组件依赖的实例 */
  components: Record<string, React.ComponentType>

  /** CSS 类名 */
  className?: string

  /** style */
  style?: React.CSSProperties

  /** id */
  id?: string | number

  /** 当前文档的 id */
  documentId?: string

  /** 主要用于设置渲染模块的全局上下文，里面定义的内容可以在低代码中通过 this 来访问，比如 this.utils */
  appHelper?: RendererAppHelper

  /**
   * 配置规范参见《低代码搭建组件描述协议》https://lowcode-engine.cn/lowcode
   * 主要在搭建场景中使用，用于提升用户搭建体验。
   *
   * > 在生产环境下不需要设置
   */
  componentsMap?: Record<string, any>

  /** 设计模式，可选值：live、design */
  designMode?: DesignMode

  /** 渲染模块是否挂起，当设置为 true 时，渲染模块最外层容器的 shouldComponentUpdate 将始终返回false，在下钻编辑或者多引擎渲染的场景会用到该参数。 */
  suspended?: boolean

  /** 组件获取 ref 时触发的钩子 */
  onCompGetRef?: (schema: NodeSchema, ref: any) => void

  /** 组件 ctx 更新回调 */
  onCompGetCtx?: (schema: NodeSchema, ref: any) => void

  /** 传入的 schema 是否有变更 */
  getSchemaChangedSymbol?: () => boolean

  /** 设置 schema 是否有变更 */
  setSchemaChangedSymbol?: (symbol: boolean) => void

  /** 自定义创建 element 的钩子 */
  customCreateElement?: (Component: any, props: any, children: any) => any

  /** 渲染类型，标识当前模块是以什么类型进行渲染的 */
  rendererName?: 'LowCodeRenderer' | 'PageRenderer' | string

  /** 当找不到组件时，显示的组件 */
  notFoundComponent?: React.ComponentType<NotFoundComponentProps>

  /** 当组件渲染异常时，显示的组件 */
  faultComponent?: React.ComponentType<FaultComponentProps>

  /** 设备信息 */
  device?: 'default' | 'pc' | 'mobile' | string

  /**
   * @default true
   * JSExpression 是否只支持使用 this 来访问上下文变量
   */
  thisRequiredInJSE?: boolean

  /**
   * @default false
   * 当开启组件未找到严格模式时，渲染模块不会默认给一个容器组件
   */
  enableStrictNotFoundMode?: boolean

  /** 获取节点的方法 */
  getNode?: (id: string) => Node

  /** 渲染模块的 host */
  __host?: Simulator

  /** 渲染模块的 container */
  __container?: SimulatorRenderer
}

export interface RenderComponent {
  displayName: string
  defaultProps: RendererProps

  new (
    props: RendererProps,
  ): Component<RendererProps, RendererState> & {
    [x: string]: any
    __getRef: (ref: any) => void
    componentDidMount(): Promise<void> | void
    componentDidUpdate(): Promise<void> | void
    componentWillUnmount(): Promise<void> | void
    componentDidCatch(e: any): Promise<void> | void
    shouldComponentUpdate(nextProps: RendererProps): boolean
    isValidComponent(SetComponent: any): any
    createElement(SetComponent: any, props: any, children?: any): any
    getNotFoundComponent(): any
    getFaultComponent(): any
  }
}

export interface RendererAppHelper {
  /** 全局公共函数 */
  utils?: Record<string, any>

  /** 全局常量 */
  constants?: Record<string, any>

  /** @experimental 内部使用 */
  requestHandlersMap?: Record<string, any>
}

export interface NodeInfo {
  schema?: NodeSchema
  Comp: any
  componentInfo?: any
  componentChildren?: any
}

export interface JSExpression {
  type: string
  value: string
}

export interface DataSourceItem {
  id: string
  isInit?: boolean | JSExpression
  type?: string
  options?: {
    uri: string | JSExpression
    params?: JSONObject | JSExpression
    method?: string | JSExpression
    shouldFetch?: string
    willFetch?: string
    fit?: string
    didFetch?: string
  }
  dataHandler?: JSExpression
}

export interface DataSource {
  list?: DataSourceItem[]
  dataHandler?: JSExpression
}

export interface BaseRendererProps {
  __appHelper?: RendererAppHelper
  __components: Record<string, React.ComponentType>
  __ctx?: Record<string, any>
  __schema: RootSchema
  __designMode?: DesignMode
  __host?: Simulator
  __container?: SimulatorRenderer
  config?: Record<string, any>
  designMode?: DesignMode
  className?: string
  style?: React.CSSProperties
  id?: string | number
  getSchemaChangedSymbol?: () => boolean
  setSchemaChangedSymbol?: (symbol: boolean) => void
  thisRequiredInJSE?: boolean
  documentId?: string
  getNode?: any

  /**
   * 设备类型，默认值：'default'
   */
  device?: 'default' | 'pc' | 'mobile' | string
  componentName?: string
}

export interface BaseRendererContext {
  appHelper: RendererAppHelper
  components: Record<string, React.ComponentType>
  engine: Record<string, any>
  pageContext?: BaseRenderComponent
  compContext?: BaseRenderComponent
}

export type BaseRendererInstance = Component<BaseRendererProps, Record<string, any>, any> & {
  reloadDataSource(): Promise<any>
  __beforeInit(props: BaseRendererProps): void
  __init(props: BaseRendererProps): void
  __afterInit(props: BaseRendererProps): void
  __executeLifeCycleMethod(method: string, args?: any[]): void
  __getComponentView(): React.ComponentType | undefined
  __bindCustomMethods(props: BaseRendererProps): void
  __generateCtx(ctx: Record<string, any>): void
  __parseData(data: any, ctx?: any): any
  __initDataSource(props: BaseRendererProps): void
  __writeCss(props: BaseRendererProps): void
  __render(): void
  __getRef(ref: any): void
  __getSchemaChildrenVirtualDom(schema: NodeSchema | undefined, Comp: any, nodeChildrenMap?: any): any
  __getComponentProps(schema: NodeSchema | undefined, scope: any, Comp: any, componentInfo?: any): any
  __createDom(): any
  __createVirtualDom(schema: any, self: any, parentInfo: NodeInfo, idx: string | number): any
  __createLoopVirtualDom(schema: any, self: any, parentInfo: NodeInfo, idx: number | string): any
  __parseProps(props: any, self: any, path: string, info: NodeInfo): any
  __renderContextProvider(customProps?: object, children?: any): any
  __renderContextConsumer(children: any): any
  __renderContent(children: any): any
  __checkSchema(schema: NodeSchema | undefined, extraComponents?: string | string[]): any
  __renderComp(Comp: any, ctxProps: object): any
  $(id: string, instance?: any): any
  context: BaseRendererContext
}

export interface BaseRenderComponent {
  new (props: BaseRendererProps): BaseRendererInstance
}
