import {
  type CompositeValue,
  type JSONValue,
  type NodeData,
  type NodeSchema,
  type RootSchema,
  isJSExpression,
  isJSFunction,
} from '@easy-editor/core'
import { forEach, isEmpty } from 'lodash-es'
import { Component } from 'react'
import { adapter } from './adapter'
import { RendererContext } from './context'
import { type ComponentConstruct, type ComponentHocInfo, compWrapper, leafWrapper } from './hoc'
import type { BaseRenderComponent, BaseRendererContext, BaseRendererProps, NodeInfo } from './types'
import {
  checkPropTypes,
  classnames,
  getFileCssName,
  getValue,
  isSchema,
  isUseLoop,
  logger,
  parseData,
  parseExpression,
  transformArrayToMap,
  transformStringToFunction,
} from './utils'

/**
 * execute method in schema.lifeCycles with context
 */
export function executeLifeCycleMethod(context: any, schema: RootSchema, method: string, args: any): any {
  if (!context || !isSchema(schema) || !method) {
    return
  }
  const lifeCycleMethods = getValue(schema, 'lifeCycles', {})
  let fn = lifeCycleMethods[method]

  if (!fn) {
    return
  }

  // TODO: cache
  if (isJSExpression(fn) || isJSFunction(fn)) {
    fn = parseExpression(fn, context, true)
  }

  if (typeof fn !== 'function') {
    logger.error(`生命周期${method}类型不符`, fn)
    return
  }

  try {
    return fn.apply(context, args)
  } catch (e) {
    logger.error(`[${schema.componentName}]生命周期${method}出错`, e)
  }
}

/**
 * get children from a node schema
 */
export function getSchemaChildren(schema: NodeSchema | undefined) {
  if (!schema) {
    return
  }

  return schema.children
}

export function baseRendererFactory(): BaseRenderComponent {
  const { BaseRenderer: customBaseRenderer } = adapter.getRenderers()

  if (customBaseRenderer) {
    return customBaseRenderer as unknown as BaseRenderComponent
  }

  const DEFAULT_LOOP_ARG_ITEM = 'item'
  const DEFAULT_LOOP_ARG_INDEX = 'index'
  // const scopeIdx = 0

  return class BaseRenderer extends Component<BaseRendererProps, BaseRendererProps> {
    [key: string]: any

    static displayName = 'BaseRenderer'

    static defaultProps = {
      __schema: {},
    }

    static contextType = RendererContext
    declare context: BaseRendererContext

    dataSourceMap: Record<string, any> = {}

    __namespace = 'base'
    __compScopes: Record<string, any> = {}
    __instanceMap: Record<string, any> = {}
    __dataHelper: any

    /**
     * keep track of customMethods added to this context
     *
     * @type {any}
     */
    __customMethodsList: any[] = []
    __parseExpression: any
    __ref: any

    /**
     * reference of style element contains schema.css
     *
     * @type {any}
     */
    __styleElement: any

    constructor(props: BaseRendererProps) {
      super(props)
      this.__parseExpression = (str: string, self: any) => {
        return parseExpression({ str, self, logScope: props.componentName })
      }
      this.__beforeInit(props)
      this.__init(props)
      this.__afterInit(props)
      logger.log(`constructor - ${props?.__schema?.fileName}`)
    }

    __beforeInit(props: BaseRendererProps) {}

    __init(props: BaseRendererProps) {
      this.__compScopes = {}
      this.__instanceMap = {}
      this.__bindCustomMethods(props)
    }

    __afterInit(props: BaseRendererProps) {}

    static getDerivedStateFromProps(props: BaseRendererProps, state: any) {
      const result = executeLifeCycleMethod(this, props?.__schema, 'getDerivedStateFromProps', [props, state])
      return result === undefined ? null : result
    }

    async getSnapshotBeforeUpdate(...args: any[]) {
      this.__executeLifeCycleMethod('getSnapshotBeforeUpdate', args)
      logger.log(`getSnapshotBeforeUpdate - ${this.props?.__schema?.componentName}`)
    }

    async componentDidMount(...args: any[]) {
      this.reloadDataSource()
      this.__executeLifeCycleMethod('componentDidMount', args)
      logger.log(`componentDidMount - ${this.props?.__schema?.componentName}`)
    }

    async componentDidUpdate(...args: any[]) {
      this.__executeLifeCycleMethod('componentDidUpdate', args)
      logger.log(`componentDidUpdate - ${this.props.__schema.componentName}`)
    }

    async componentWillUnmount(...args: any[]) {
      this.__executeLifeCycleMethod('componentWillUnmount', args)
      logger.log(`componentWillUnmount - ${this.props?.__schema?.componentName}`)
    }

    async componentDidCatch(...args: any[]) {
      this.__executeLifeCycleMethod('componentDidCatch', args)
      logger.warn(args)
    }

    reloadDataSource = () =>
      new Promise((resolve, reject) => {
        logger.log('reload data source')
        if (!this.__dataHelper) {
          return resolve({})
        }
        this.__dataHelper
          .getInitData()
          .then((res: any) => {
            if (isEmpty(res)) {
              this.forceUpdate()
              return resolve({})
            }
            this.setState(res, resolve as () => void)
          })
          .catch((err: Error) => {
            reject(err)
          })
      })

    shouldComponentUpdate() {
      if (this.props.getSchemaChangedSymbol?.() && this.props.__container?.rerender) {
        this.props.__container?.rerender()
        return false
      }
      return true
    }

    forceUpdate() {
      if (this.shouldComponentUpdate()) {
        super.forceUpdate()
      }
    }

    /**
     * execute method in schema.lifeCycles
     */
    __executeLifeCycleMethod = (method: string, args?: any) => {
      const { engine } = this.context
      if (!engine.props.enableStrictNotFoundMode) {
        return
      }

      executeLifeCycleMethod(this, this.props.__schema, method, args)
    }

    /**
     * this method is for legacy purpose only, which used _ prefix instead of __ as private for some historical reasons
     */
    __getComponentView = () => {
      const { __components, __schema } = this.props
      if (!__components) {
        return
      }
      return __components[__schema.componentName]
    }

    __bindCustomMethods = (props: BaseRendererProps) => {
      const { __schema } = props
      const customMethodsList = Object.keys(__schema.methods || {}) || []
      ;(this.__customMethodsList || []).forEach((item: any) => {
        if (!customMethodsList.includes(item)) {
          delete this[item]
        }
      })
      this.__customMethodsList = customMethodsList
      forEach(__schema.methods, (val: any, key: string) => {
        let value = val
        if (isJSExpression(value) || isJSFunction(value)) {
          value = this.__parseExpression(value, this)
        }
        if (typeof value !== 'function') {
          logger.error(`custom method ${key} can not be parsed to a valid function`, value)
          return
        }
        this[key] = value.bind(this)
      })
    }

    __generateCtx = (ctx: Record<string, any>) => {
      const { pageContext, compContext } = this.context
      const obj = {
        page: pageContext,
        component: compContext,
        ...ctx,
      }
      forEach(obj, (val: any, key: string) => {
        this[key] = val
      })
    }

    __parseData = (data: any, ctx?: Record<string, any>) => {
      const { __ctx, componentName } = this.props
      return parseData(data, ctx || __ctx || this, { logScope: componentName })
    }

    __initDataSource = (props: BaseRendererProps) => {
      if (!props) {
        return
      }
      // TODO: 数据源引擎方案
      // const schema = props.__schema || {}
      // const defaultDataSource: DataSource = {
      //   list: [],
      // }
      // const dataSource = schema.dataSource || defaultDataSource
      // // requestHandlersMap 存在才走数据源引擎方案
      // // TODO: 下面if else 抽成独立函数
      // const useDataSourceEngine = !!props.__appHelper?.requestHandlersMap
      // if (useDataSourceEngine) {
      //   this.__dataHelper = {
      //     updateConfig: (updateDataSource: any) => {
      //       const { dataSourceMap, reloadDataSource } = createDataSourceEngine(
      //         updateDataSource ?? {},
      //         this,
      //         props.__appHelper.requestHandlersMap
      //           ? { requestHandlersMap: props.__appHelper.requestHandlersMap }
      //           : undefined,
      //       )

      //       this.reloadDataSource = () =>
      //         new Promise(resolve => {
      //           logger.log('reload data source')
      //           reloadDataSource().then(() => {
      //             resolve({})
      //           })
      //         })
      //       return dataSourceMap
      //     },
      //   }
      //   this.dataSourceMap = this.__dataHelper.updateConfig(dataSource)
      // } else {
      //   const appHelper = props.__appHelper
      //   this.__dataHelper = new DataHelper(this, dataSource, appHelper, (config: any) => this.__parseData(config))
      //   this.dataSourceMap = this.__dataHelper.dataSourceMap
      //   this.reloadDataSource = () =>
      //     new Promise((resolve, reject) => {
      //       logger.log('reload data source')
      //       if (!this.__dataHelper) {
      //         return resolve({})
      //       }
      //       this.__dataHelper
      //         .getInitData()
      //         .then((res: any) => {
      //           if (isEmpty(res)) {
      //             return resolve({})
      //           }
      //           this.setState(res, resolve as () => void)
      //         })
      //         .catch((err: Error) => {
      //           reject(err)
      //         })
      //     })
      // }
    }

    /**
     * write props.__schema.css to document as a style element,
     * which will be added once and only once.
     * @PRIVATE
     */
    __writeCss = (props: BaseRendererProps) => {
      const css = getValue(props.__schema, 'css', '')
      logger.log('create this.styleElement with css', css)
      let style = this.__styleElement
      if (!this.__styleElement) {
        style = document.createElement('style')
        style.type = 'text/css'
        style.setAttribute('from', 'style-sheet')

        const head = document.head || document.getElementsByTagName('head')[0]
        head.appendChild(style)
        this.__styleElement = style
        logger.log('this.styleElement is created', this.__styleElement)
      }

      if (style.innerHTML === css) {
        return
      }

      style.innerHTML = css
    }

    __render = () => {
      const schema = this.props.__schema
      this.__executeLifeCycleMethod('render')
      this.__writeCss(this.props)

      const { engine } = this.context
      if (engine) {
        engine.props?.onCompGetCtx?.(schema, this)
        // 画布场景才需要每次渲染bind自定义方法
        if (this.__designModeIsDesign) {
          this.__bindCustomMethods(this.props)
          this.dataSourceMap = this.__dataHelper?.updateConfig(schema.dataSource)
        }
      }
    }

    __getRef = (ref: any) => {
      const { engine } = this.context
      const { __schema } = this.props
      // ref && engine?.props?.onCompGetRef(__schema, ref)
      // TODO: 只在 ref 存在执行，会影响 documentInstance 的卸载
      engine.props?.onCompGetRef?.(__schema, ref)
      this.__ref = ref
    }

    __createDom = () => {
      const { __schema, __ctx } = this.props
      // merge defaultProps
      const scopeProps = {
        ...__schema.defaultProps,
        ...this.props,
      }
      const scope: any = {
        props: scopeProps,
      }
      scope.__proto__ = __ctx || this

      const _children = getSchemaChildren(__schema)
      const Comp = this.__getComponentView()

      if (!Comp) {
        logger.log(`${__schema.componentName} is invalid!`)
      }

      const parentNodeInfo = {
        schema: __schema,
        Comp: this.__getHOCWrappedComponent(Comp, {
          schema: __schema,
          scope,
        }),
      } as NodeInfo
      return this.__createVirtualDom(_children, scope, parentNodeInfo)
    }

    /**
     * 将模型结构转换成react Element
     * @param originalSchema schema
     * @param originalScope scope
     * @param parentInfo 父组件的信息，包含schema和Comp
     * @param idx 为循环渲染的循环Index
     */
    __createVirtualDom = (
      originalSchema: NodeData | NodeData[] | undefined,
      originalScope: any,
      parentInfo: NodeInfo,
      idx: string | number = '',
    ): any => {
      if (originalSchema === null || originalSchema === undefined) {
        return null
      }

      const scope = originalScope
      const schema = originalSchema
      const { engine } = this.context || {}

      if (!engine) {
        logger.log('this.context.engine is invalid!')
        return null
      }

      try {
        const { __appHelper: appHelper, __components: components = {} } = this.props || {}

        if (isJSExpression(schema)) {
          return this.__parseExpression(schema, scope)
        }

        if (typeof schema === 'string') {
          return schema
        }

        if (typeof schema === 'number' || typeof schema === 'boolean') {
          return String(schema)
        }

        if (Array.isArray(schema)) {
          if (schema.length === 1) {
            return this.__createVirtualDom(schema[0], scope, parentInfo)
          }
          return schema.map((item, idy) =>
            this.__createVirtualDom(item, scope, parentInfo, (item as NodeSchema)?.__ctx?.lceKey ? '' : String(idy)),
          )
        }

        if (schema.$$typeof) {
          return schema
        }

        if (!schema.componentName) {
          logger.error('The componentName in the schema is invalid, please check the schema: ', schema)
          return
        }

        if (!isSchema(schema)) {
          return null
        }

        let Comp = components[schema.componentName] || this.props.__container?.components?.[schema.componentName]

        // 容器类组件的上下文通过props传递，避免context传递带来的嵌套问题
        const otherProps: any = isSchema(schema)
          ? {
              __schema: schema,
              __appHelper: appHelper,
              __components: components,
            }
          : {}

        if (!Comp) {
          logger.error(
            `${schema.componentName} component is not found in components list! component list is:`,
            components || this.props.__container?.components,
          )

          return engine.createElement(
            engine.getNotFoundComponent(),
            {
              componentName: schema.componentName,
              componentId: schema.id,
              enableStrictNotFoundMode: engine.props.enableStrictNotFoundMode,
              ref: (ref: any) => {
                ref && engine.props?.onCompGetRef?.(schema, ref)
              },
            },
            this.__getSchemaChildrenVirtualDom(schema, scope, Comp),
          )
        }

        if (schema.loop != null) {
          const loop = this.__parseData(schema.loop, scope)
          if (Array.isArray(loop) && loop.length === 0) return null
          const useLoop = isUseLoop(loop, this.__designModeIsDesign)
          if (useLoop) {
            return this.__createLoopVirtualDom(
              {
                ...schema,
                loop,
              },
              scope,
              parentInfo,
              idx,
            )
          }
        }

        const condition = schema.condition == null ? true : this.__parseData(schema.condition, scope)

        // DesignMode 为 design 情况下，需要进入 leaf Hoc，进行相关事件注册
        const displayInHook = this.__designModeIsDesign
        if (!condition && !displayInHook) {
          return null
        }

        // TODO: scope
        // let scopeKey = ''
        // // 判断组件是否需要生成scope，且只生成一次，挂在this.__compScopes上
        // if (Comp.generateScope) {
        //   const key = this.__parseExpression(schema.props?.key, scope)
        //   if (key) {
        //     // 如果组件自己设置key则使用组件自己的key
        //     scopeKey = key
        //   } else if (schema.__ctx) {
        //     // 需要判断循环的情况
        //     scopeKey = schema.__ctx.lceKey + (idx !== undefined ? `_${idx}` : '')
        //   } else {
        //     // 在生产环境schema没有__ctx上下文，需要手动生成一个lceKey
        //     schema.__ctx = {
        //       lceKey: `lce${++scopeIdx}`,
        //     }
        //     scopeKey = schema.__ctx.lceKey
        //   }
        //   if (!this.__compScopes[scopeKey]) {
        //     this.__compScopes[scopeKey] = Comp.generateScope(this, schema)
        //   }
        // }
        // // 如果组件有设置scope，需要为组件生成一个新的scope上下文
        // if (scopeKey && this.__compScopes[scopeKey]) {
        //   const compSelf = { ...this.__compScopes[scopeKey] }
        //   compSelf.__proto__ = scope
        //   scope = compSelf
        // }

        if (engine.props?.designMode) {
          otherProps.__designMode = engine.props.designMode
        }
        if (this.__designModeIsDesign) {
          otherProps.__tag = Math.random()
        }

        const componentInfo: any = {}
        const props: any =
          this.__getComponentProps(schema, scope, Comp, {
            ...componentInfo,
            props: transformArrayToMap(componentInfo.props, 'name'),
          }) || {}

        Comp = this.__getHOCWrappedComponent(Comp, {
          schema,
          componentInfo,
          baseRenderer: this,
          scope,
        })

        otherProps.ref = (ref: any) => {
          this.$(schema.id || props.ref, ref) // 收集ref
          const refProps = props.ref
          if (refProps && typeof refProps === 'string') {
            this[refProps] = ref
          }
          ref && engine.props?.onCompGetRef?.(schema, ref)
        }

        // scope需要传入到组件上
        // if (scopeKey && this.__compScopes[scopeKey]) {
        //   props.__scope = this.__compScopes[scopeKey]
        // }
        if (schema?.__ctx?.lceKey) {
          if (!isSchema(schema)) {
            engine.props?.onCompGetCtx?.(schema, scope)
          }
          props.key = props.key || `${schema.__ctx.lceKey}_${schema.__ctx.idx || 0}_${idx !== undefined ? idx : ''}`
        } else if ((typeof idx === 'number' || typeof idx === 'string') && !props.key) {
          // 仅当循环场景走这里
          props.key = idx
        }

        props.__id = schema.id
        if (!props.key) {
          props.key = props.__id
        }

        return engine.createElement(
          Comp,
          {
            ...props,
            ...otherProps,
            // TODO: 看看这里需要怎么处理简洁
            __inner__: {
              hidden: schema.hidden,
              condition,
            },
          },
          this.__getSchemaChildrenVirtualDom(schema, scope, Comp, condition),
        )
      } catch (e) {
        return engine.createElement(engine.getFaultComponent(), {
          error: e,
          schema,
          self: scope,
          parentInfo,
          idx,
        })
      }
    }

    /**
     * get Component HOCs
     *
     * @readonly
     * @type {ComponentConstruct[]}
     */
    get __componentHOCs(): ComponentConstruct[] {
      if (this.__designModeIsDesign) {
        return [leafWrapper, compWrapper]
      }
      return [compWrapper]
    }

    __getSchemaChildrenVirtualDom = (schema: NodeSchema | undefined, scope: any, Comp: any, condition = true) => {
      let children = condition ? getSchemaChildren(schema) : null

      const result: any = []
      if (children) {
        if (!Array.isArray(children)) {
          children = [children]
        }

        children.forEach((child: any) => {
          const childVirtualDom = this.__createVirtualDom(
            isJSExpression(child) ? this.__parseExpression(child, scope) : child,
            scope,
            {
              schema,
              Comp,
            },
          )

          result.push(childVirtualDom)
        })
      }

      if (result && result.length > 0) {
        return result
      }
      return null
    }

    __getComponentProps = (schema: NodeSchema | undefined, scope: any, Comp: any, componentInfo?: any) => {
      if (!schema) {
        return {}
      }
      return (
        this.__parseProps(schema?.props, scope, '', {
          schema,
          Comp,
          componentInfo: {
            ...(componentInfo || {}),
            props: transformArrayToMap((componentInfo || {}).props, 'name'),
          },
        }) || {}
      )
    }

    __createLoopVirtualDom = (schema: NodeSchema, scope: any, parentInfo: NodeInfo, idx: number | string) => {
      // TODO
      // if (isSchema(schema)) {
      //   logger.warn('file type not support Loop')
      //   return null
      // }
      if (!Array.isArray(schema.loop)) {
        return null
      }
      const itemArg = (schema.loopArgs && schema.loopArgs[0]) || DEFAULT_LOOP_ARG_ITEM
      const indexArg = (schema.loopArgs && schema.loopArgs[1]) || DEFAULT_LOOP_ARG_INDEX
      const { loop } = schema
      return loop.map((item: JSONValue | CompositeValue, i: number) => {
        const loopSelf: any = {
          [itemArg]: item,
          [indexArg]: i,
        }
        loopSelf.__proto__ = scope
        return this.__createVirtualDom(
          {
            ...schema,
            loop: undefined,
            props: {
              ...schema.props,
              // 循环下 key 不能为常量，这样会造成 key 值重复，渲染异常
              key: isJSExpression(schema.props?.key) ? schema.props?.key : null,
            },
          },
          loopSelf,
          parentInfo,
          idx ? `${idx}_${i}` : i,
        )
      })
    }

    get __designModeIsDesign() {
      const { engine } = this.context || {}
      return engine?.props?.designMode === 'design'
    }

    __parseProps = (originalProps: any, scope: any, path: string, info: NodeInfo): any => {
      let props = originalProps
      const { schema, Comp, componentInfo = {} } = info
      const propInfo = getValue(componentInfo.props, path)
      // FIXME: 将这行逻辑外置，解耦，线上环境不要验证参数，调试环境可以有，通过传参自定义
      const propType = propInfo?.extra?.propType

      const checkProps = (value: any) => {
        if (!propType) {
          return value
        }
        return checkPropTypes(value, path, propType, componentInfo.name) ? value : undefined
      }

      const parseReactNode = (data: any, params: any) => {
        if (isEmpty(params)) {
          const virtualDom = this.__createVirtualDom(data, scope, { schema, Comp } as NodeInfo)
          return checkProps(virtualDom)
        }
        return checkProps((...argValues: any[]) => {
          const args: any = {}
          if (Array.isArray(params) && params.length) {
            params.forEach((item, idx) => {
              if (typeof item === 'string') {
                args[item] = argValues[idx]
              } else if (item && typeof item === 'object') {
                args[item.name] = argValues[idx]
              }
            })
          }
          args.__proto__ = scope
          return scope.__createVirtualDom(data, args, { schema, Comp } as NodeInfo)
        })
      }

      if (isJSExpression(props)) {
        props = this.__parseExpression(props, scope)
        // 只有当变量解析出来为模型结构的时候才会继续解析
        if (!isSchema(props)) {
          return checkProps(props)
        }
      }

      if (isJSFunction(props)) {
        props = transformStringToFunction(props.value)
      }

      // 兼容通过componentInfo判断的情况
      if (isSchema(props)) {
        const isReactNodeFunction = !!(propInfo?.type === 'ReactNode' && propInfo?.props?.type === 'function')

        const isMixinReactNodeFunction = !!(
          propInfo?.type === 'Mixin' &&
          propInfo?.props?.types?.indexOf('ReactNode') > -1 &&
          propInfo?.props?.reactNodeProps?.type === 'function'
        )

        let params = null
        if (isReactNodeFunction) {
          params = propInfo?.props?.params
        } else if (isMixinReactNodeFunction) {
          params = propInfo?.props?.reactNodeProps?.params
        }
        return parseReactNode(props, params)
      }
      if (Array.isArray(props)) {
        return checkProps(
          props.map((item, idx) => this.__parseProps(item, scope, path ? `${path}.${idx}` : `${idx}`, info)),
        )
      }
      if (typeof props === 'function') {
        return checkProps(props.bind(scope))
      }
      if (props && typeof props === 'object') {
        if (props.$$typeof) {
          return checkProps(props)
        }
        const res: any = {}
        forEach(props, (val: any, key: string) => {
          if (key.startsWith('__')) {
            res[key] = val
            return
          }
          res[key] = this.__parseProps(val, scope, path ? `${path}.${key}` : key, info)
        })
        return checkProps(res)
      }
      return checkProps(props)
    }

    $(id: string, instance?: any) {
      this.__instanceMap = this.__instanceMap || {}
      if (!id || typeof id !== 'string') {
        return this.__instanceMap
      }
      if (instance) {
        this.__instanceMap[id] = instance
      }
      return this.__instanceMap[id]
    }

    __renderContextProvider = (customProps?: object, children?: any) => {
      return (
        <RendererContext.Provider
          value={{
            ...this.context,
            blockContext: this,
            ...(customProps || {}),
          }}
        >
          {children || this.__createDom()}
        </RendererContext.Provider>
      )
    }

    __renderContextConsumer = (children: any) => {
      return <RendererContext.Consumer>{children}</RendererContext.Consumer>
    }

    __getHOCWrappedComponent(
      OriginalComp: any,
      info: {
        schema: ComponentHocInfo['schema']
        scope: ComponentHocInfo['scope']
        componentInfo?: ComponentHocInfo['componentInfo']
        baseRenderer?: ComponentHocInfo['baseRenderer']
      },
    ) {
      let Comp = OriginalComp
      this.__componentHOCs.forEach(ComponentConstruct => {
        Comp = ComponentConstruct(Comp, {
          componentInfo: {},
          baseRenderer: this,
          ...info,
        })
      })

      return Comp
    }

    __renderComp(OriginalComp: any, ctxProps: object) {
      let Comp = OriginalComp
      const { __schema, __ctx } = this.props
      const scope: any = {}
      scope.__proto__ = __ctx || this
      Comp = this.__getHOCWrappedComponent(Comp, {
        schema: __schema,
        scope,
      })
      const data = this.__parseProps(__schema?.props, scope, '', {
        schema: __schema,
        Comp,
        componentInfo: {},
      })
      const { className } = data
      const otherProps: any = {}
      const { engine } = this.context || {}
      if (!engine) {
        return null
      }

      if (this.__designModeIsDesign) {
        otherProps.__tag = Math.random()
      }

      const child = engine.createElement(
        Comp,
        {
          ...data,
          ...this.props,
          ref: this.__getRef,
          className: classnames(
            __schema?.fileName && getFileCssName(__schema.fileName),
            className,
            this.props.className,
          ),
          __id: __schema?.id,
          ...otherProps,
        },
        this.__createDom(),
      )
      return this.__renderContextProvider(ctxProps, child)
    }

    __renderContent(children: any) {
      const { __schema } = this.props
      const parsedProps = this.__parseData(__schema.props)
      const className = classnames(
        `lce-${this.__namespace}`,
        __schema?.fileName && getFileCssName(__schema.fileName),
        parsedProps.className,
        this.props.className,
      )
      const style = { ...(parsedProps.style || {}), ...(typeof this.props.style === 'object' ? this.props.style : {}) }
      const id = this.props.id || parsedProps.id
      return (
        <div ref={this.__getRef} className={className} id={id} style={style}>
          {children}
        </div>
      )
    }

    __checkSchema = (schema: NodeSchema | undefined, originalExtraComponents: string | string[] = []) => {
      let extraComponents = originalExtraComponents
      if (typeof extraComponents === 'string') {
        extraComponents = [extraComponents]
      }

      // const builtin = capitalizeFirstLetter(this.__namespace)
      // const componentNames = [builtin, ...extraComponents]
      const componentNames = [...Object.keys(this.props.__components), ...extraComponents]
      return !isSchema(schema) || !componentNames.includes(schema?.componentName ?? '')
    }

    get appHelper() {
      return this.props.__appHelper
    }

    get requestHandlersMap() {
      return this.appHelper?.requestHandlersMap
    }

    get utils() {
      return this.appHelper?.utils
    }

    get constants() {
      return this.appHelper?.constants
    }

    // render() {
    //   return null
    // }
  }
}
