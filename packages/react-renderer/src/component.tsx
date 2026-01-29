import { type BaseRendererProps, logger } from '@easy-editor/renderer-core'
import { baseRendererFactory } from './base'
import type { BaseRendererComponent } from './types'

export function componentRendererFactory(): BaseRendererComponent {
  const BaseRenderer = baseRendererFactory()
  return class CompRenderer extends BaseRenderer {
    static displayName = 'CompRenderer'

    __namespace = 'component'

    __afterInit(props: BaseRendererProps, ...rest: any[]) {
      const schema = props.__schema || {}
      this.state = this.__parseData(schema.state || {})
      this.__initDataSource(props)
      this.__executeLifeCycleMethod('constructor', [props, ...rest])
    }

    render() {
      const { __schema } = this.props
      if (this.__checkSchema(__schema)) {
        return '自定义组件 schema 结构异常！'
      }
      logger.log(`${CompRenderer.displayName} render - ${__schema.componentName}`)

      this.__generateCtx({
        component: this,
      })
      this.__render()

      const noContainer = this.__parseData(__schema.props?.noContainer)

      this.__bindCustomMethods(this.props)

      if (noContainer) {
        return this.__renderContextProvider({ compContext: this })
      }

      const Comp = this.__getComponentView()

      if (!Comp) {
        return this.__renderContent(this.__renderContextProvider({ compContext: this }))
      }

      return this.__renderComp(Comp, { compContext: this })
    }
  }
}
