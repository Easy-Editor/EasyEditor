import { isRemoteComponent } from '@easy-editor/core'
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
        const { __components: components = {} } = this.props || {}
        const isRemote = isRemoteComponent(originalSchema)
        const isExist =
          components[originalSchema.componentName] || this.props.__container?.components?.[originalSchema.componentName]

        if (isRemote && !isExist) {
          return this.context.engine.createElement(RemoteComponentLoading, {
            schema: originalSchema,
          })
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
