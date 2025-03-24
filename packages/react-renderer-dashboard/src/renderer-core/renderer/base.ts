import { type ComponentConstruct, baseRendererFactory, compWrapper, leafWrapper } from '@easy-editor/react-renderer'
import { dashboardWrapper } from '../hoc/dashboard'

export const dashboardBaseRendererFactory: () => any = () => {
  const OriginBase = baseRendererFactory()

  return class BaseRenderer extends OriginBase {
    get __componentHOCs(): ComponentConstruct[] {
      if (this.__designModeIsDesign) {
        return [dashboardWrapper, leafWrapper, compWrapper]
      }
      return [dashboardWrapper, compWrapper]
    }
  }
}
