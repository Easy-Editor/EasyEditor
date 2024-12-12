import { BaseRenderer, type BaseRendererProps } from './base'

export class CompRenderer extends BaseRenderer {
  static displayName = 'CompRenderer'

  __namespace = 'component'

  __afterInit(props: BaseRendererProps, ...rest: any[]) {
    this.__generateCtx({
      component: this,
    })
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
    this.__debug(`${CompRenderer.displayName} render - ${__schema.fileName}`)

    this.__generateCtx({
      component: this,
    })
    this.__render()

    const noContainer = this.__parseData(__schema.props?.noContainer)

    this.__bindCustomMethods(this.props)

    if (noContainer) {
      return this.__renderContextProvider({ compContext: this })
    }

    const Comp = this._getComponentView(__schema.componentName)

    if (!Comp) {
      return this.__renderContent(this.__renderContextProvider({ compContext: this }))
    }

    return this.__renderComp(Comp, this.__renderContextProvider({ compContext: this }))
  }
}
