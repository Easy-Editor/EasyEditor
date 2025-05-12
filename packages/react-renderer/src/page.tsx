import { type BaseRendererProps, logger } from '@easy-editor/renderer-core'
import { baseRendererFactory } from './base'
import type { BaseRendererComponent } from './types'

export function pageRendererFactory(): BaseRendererComponent {
  const BaseRenderer = baseRendererFactory()

  return class PageRenderer extends BaseRenderer {
    static displayName = 'PageRenderer'

    __namespace = 'page'

    __afterInit(props: BaseRendererProps, ...rest: unknown[]) {
      const schema = props.__schema || {}
      this.state = this.__parseData(schema.state || {})
      this.__initDataSource(props)
      this.__executeLifeCycleMethod('constructor', [props, ...rest])
    }

    async componentDidUpdate(prevProps: BaseRendererProps, _prevState: any, snapshot: unknown) {
      const { __ctx } = this.props
      // 当编排的时候修改 schema.state 值，需要将最新 schema.state 值 setState
      if (JSON.stringify(prevProps.__schema.state) !== JSON.stringify(this.props.__schema.state)) {
        const newState = this.__parseData(this.props.__schema.state, __ctx)
        this.setState(newState)
      }

      super.componentDidUpdate?.(prevProps, _prevState, snapshot)
    }

    setState(state: any, callback?: () => void) {
      logger.log('page set state', state)
      super.setState(state, callback)
    }

    render() {
      const { __schema } = this.props
      if (this.__checkSchema(__schema)) {
        return '页面schema结构异常！'
      }
      logger.log(`${PageRenderer.displayName} render - ${__schema.componentName}`)

      this.__bindCustomMethods(this.props)
      this.__initDataSource(this.props)

      this.__generateCtx({
        page: this,
      })
      this.__render()

      const Comp = this.__getComponentView()

      if (!Comp) {
        return this.__renderContent(this.__renderContextProvider({ pageContext: this }))
      }

      return this.__renderComp(Comp, { pageContext: this })
    }
  }
}
