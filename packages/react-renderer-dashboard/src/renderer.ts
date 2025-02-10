import { adapter, componentRendererFactory, pageRendererFactory, rendererFactory } from '@easy-editor/react-renderer'
import { dashboardBaseRendererFactory } from './renderer/base'

// 抽离开单独设置，不然下面的 page 和 component 会走老的
adapter.setBaseRenderer(dashboardBaseRendererFactory())
adapter.setRenderers({
  PageRenderer: pageRendererFactory(),
  ComponentRenderer: componentRendererFactory(),
})

export const LowCodeRenderer = rendererFactory()
