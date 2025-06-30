import { type ComponentConstruct, baseRendererFactory, compWrapper, leafWrapper } from '@easy-editor/react-renderer'
import { formWrapper } from '../hoc/dashboard'

export const formBaseRendererFactory: () => any = () => {
  const OriginBase = baseRendererFactory()

  return class BaseRenderer extends OriginBase {
    get __componentHOCs(): ComponentConstruct[] {
      if (this.__designModeIsDesign) {
        return [formWrapper, leafWrapper, compWrapper]
      }
      return [formWrapper, compWrapper]
    }
  }
}

// 向后兼容
export { formBaseRendererFactory as dashboardBaseRendererFactory }
