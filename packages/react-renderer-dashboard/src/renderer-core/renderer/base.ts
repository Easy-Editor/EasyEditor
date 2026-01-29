import { isRemoteComponent, NodeSchema } from '@easy-editor/core'
import { type ComponentConstruct, baseRendererFactory, compWrapper, leafWrapper } from '@easy-editor/react-renderer'
import { isSchema, isUseLoop } from '@easy-editor/renderer-core'
import { RemoteComponentLoading } from '../components'
import { dashboardWrapper } from '../hoc/dashboard'

export const dashboardBaseRendererFactory: () => any = () => {
  const OriginBase = baseRendererFactory()

  return class BaseRenderer extends OriginBase {
    constructor(props: any) {
      super(props)

      // 保存父类的 __createVirtualDom 方法引用
      const superCreateVirtualDom = this.__createVirtualDom.bind(this)
      const superCheckSchema = this.__checkSchema.bind(this)

      // 重写 __checkSchema 以支持版本化组件检查
      this.__checkSchema = (schema: NodeSchema | undefined, originalExtraComponents: string | string[] = []) => {
        if (!schema) {
          return true
        }

        const isRemote = isRemoteComponent(schema)
        if (isRemote) {
          return false
        }

        return superCheckSchema(schema, originalExtraComponents)
      }

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

        // 使用 ComponentRenderer 包装所有子组件
        if (!isSchema(originalSchema)) {
          return superCreateVirtualDom(originalSchema, originalScope, parentInfo, idx)
        }

        const { __appHelper: appHelper, __components: components = {} } = this.props || {}
        const { engine } = this.context || {}
        const ComponentRenderer = components.ComponentRenderer

        if (ComponentRenderer) {
          const key = originalSchema.__ctx?.lceKey
            ? `${originalSchema.__ctx.lceKey}_${originalSchema.__ctx.idx || 0}_${idx !== undefined ? idx : ''}`
            : originalSchema.id || `comp_${idx}`

          return engine.createElement(ComponentRenderer, {
            key,
            __schema: originalSchema,
            __appHelper: appHelper,
            __components: components,
            __designMode: engine.props?.designMode,
            __ctx: originalScope,
          })
        }

        // 降级：如果没有 ComponentRenderer，使用原有逻辑
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
