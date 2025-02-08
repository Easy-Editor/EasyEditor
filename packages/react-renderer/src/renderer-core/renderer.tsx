import { type RootSchema, logger } from '@easy-editor/core'
import { isEmpty } from 'lodash-es'
import { Component, createElement } from 'react'
import { adapter } from './adapter'
import FaultComponent from './components/FaultComponent'
import NotFoundComponent from './components/NotFoundComponent'
import { RendererContext } from './context'
import type { RenderComponent, RendererProps, RendererState } from './types'
import { isSchema } from './utils'

export function rendererFactory(): RenderComponent {
  const RENDERER_COMPS = adapter.getRenderers()

  return class Renderer extends Component<RendererProps> {
    static displayName = 'Renderer'

    state: Partial<RendererState> = {}

    __ref: any

    static defaultProps: RendererProps = {
      appHelper: undefined,
      components: {},
      designMode: 'live',
      suspended: false,
      schema: {} as RootSchema,
      onCompGetRef: () => {},
      onCompGetCtx: () => {},
      thisRequiredInJSE: true,
    }

    constructor(props: RendererProps) {
      super(props)
      this.state = {}
      logger.log(`entry.constructor - ${props?.schema?.componentName}`)
    }

    async componentDidMount() {
      logger.log(`entry.componentDidMount - ${this.props.schema && this.props.schema.componentName}`)
    }

    async componentDidUpdate() {
      logger.log(`entry.componentDidUpdate - ${this.props?.schema?.componentName}`)
    }

    async componentWillUnmount() {
      logger.log(`entry.componentWillUnmount - ${this.props?.schema?.componentName}`)
    }

    componentDidCatch(error: Error) {
      this.state.engineRenderError = true
      this.state.error = error
    }

    shouldComponentUpdate(nextProps: RendererProps) {
      return !nextProps.suspended
    }

    __getRef = (ref: any) => {
      this.__ref = ref
      if (ref) {
        this.props.onCompGetRef?.(this.props.schema, ref)
      }
    }

    isValidComponent(SetComponent: any) {
      return SetComponent
    }

    createElement(SetComponent: any, props: any, children?: any) {
      return (this.props.customCreateElement || createElement)(SetComponent, props, children)
    }

    getNotFoundComponent() {
      return this.props.notFoundComponent || NotFoundComponent
    }

    getFaultComponent() {
      return this.props.faultComponent || FaultComponent
    }

    render() {
      const { schema, designMode, appHelper, components } = this.props

      if (isEmpty(schema)) {
        return null
      }

      if (!isSchema(schema)) {
        logger.error(
          'The root component name needs to be one of Page、Block、Component, please check the schema: ',
          schema,
        )
        return '模型结构异常'
      }

      logger.log('entry.render')
      const allComponents = { ...components, ...RENDERER_COMPS }
      // TODO: 默认最顶层使用 PageRenderer
      const Comp = allComponents.PageRenderer

      if (this.state && this.state.engineRenderError) {
        return createElement(this.getFaultComponent(), {
          componentName: schema.componentName,
          error: this.state.error,
        })
      }

      if (!Comp) {
        return null
      }

      return (
        <RendererContext.Provider
          value={{
            appHelper,
            components: allComponents,
            engine: this,
          }}
        >
          <Comp
            key={schema.__ctx && `${schema.__ctx.lceKey}_${schema.__ctx.idx || '0'}`}
            // ref={this.__getRef}
            __appHelper={appHelper}
            __components={allComponents}
            __schema={schema}
            __designMode={designMode}
            {...this.props}
          />
        </RendererContext.Provider>
      )
    }
  }
}
