import { isRemoteComponent, NodeSchema } from '@easy-editor/core'
import { type ComponentConstruct, baseRendererFactory, compWrapper, leafWrapper } from '@easy-editor/react-renderer'
import { RemoteComponentLoading } from '../components'
import { dashboardWrapper } from '../hoc/dashboard'

export const dashboardBaseRendererFactory: () => any = () => {
  const OriginBase = baseRendererFactory()

  return class BaseRenderer extends OriginBase {
    constructor(props: any) {
      super(props)

      // 保存父类的 __createVirtualDom 方法引用
      const superCreateVirtualDom = this.__createVirtualDom.bind(this)

      // 重写 __getComponentView 以支持版本化组件查找
      this.__getComponentView = (schema?: NodeSchema) => {
        const { __components, __schema } = this.props
        if (!__components) return

        let newSchema = schema || __schema

        let componentName = newSchema.componentName
        const isRemote = isRemoteComponent(newSchema)
        if (isRemote) {
          componentName = `${newSchema.componentName}@${newSchema.npm.version}`
        }

        return __components[componentName]
      }

      // 覆盖 __createVirtualDom
      this.__createVirtualDom = (
        originalSchema: any,
        originalScope: any,
        parentInfo: any,
        idx: string | number = '',
      ): any => {
        // 处理数组或空值，交给父类处理
        if (!originalSchema || Array.isArray(originalSchema)) {
          return superCreateVirtualDom(originalSchema, originalScope, parentInfo, idx)
        }

        // 处理远程组件加载逻辑
        const isRemote = isRemoteComponent(originalSchema)
        if (isRemote) {
          const { __components: components = {} } = this.props || {}
          const componentName = `${originalSchema.componentName}@${originalSchema.npm.version}`
          const isExist = components[componentName] || this.props.__container?.components?.[componentName]
          if (!isExist) {
            return this.context.engine.createElement(RemoteComponentLoading, {
              schema: originalSchema,
            })
          }
        }

        // 处理远程组件的情况
        return superCreateVirtualDom(originalSchema, originalScope, parentInfo, idx)
      }
    }

    get __componentHOCs(): ComponentConstruct[] {
      if (this.__designModeIsDesign) {
        return [dashboardWrapper, leafWrapper, compWrapper]
      }
      return [dashboardWrapper, compWrapper]
    }
  }
}
