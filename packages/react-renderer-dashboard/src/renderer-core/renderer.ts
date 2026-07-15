import {
  componentRendererFactory,
  createRendererAdapter,
  pageRendererFactory,
  rendererFactory,
} from '@easy-editor/react-renderer'
import { dashboardBaseRendererFactory } from './renderer/base'

const dashboardRendererAdapter = createRendererAdapter()
dashboardRendererAdapter.setBaseRenderer(dashboardBaseRendererFactory(dashboardRendererAdapter))
dashboardRendererAdapter.setRenderers({
  PageRenderer: pageRendererFactory(dashboardRendererAdapter),
  ComponentRenderer: componentRendererFactory(dashboardRendererAdapter),
})

export const LowCodeRenderer = rendererFactory(dashboardRendererAdapter)
