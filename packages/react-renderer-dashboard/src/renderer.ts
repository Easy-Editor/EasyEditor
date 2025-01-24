import {
  type RenderComponent,
  adapter,
  componentRendererFactory,
  pageRendererFactory,
  rendererFactory,
} from '@easy-editor/react-renderer'
import { dashboardBaseRendererFactory } from './renderer/base'

// 抽离开单独设置，不然下面的 page 和 component 会走老的
adapter.setBaseRenderer(dashboardBaseRendererFactory())
adapter.setRenderers({
  PageRenderer: pageRendererFactory(),
  ComponentRenderer: componentRendererFactory(),
})

function factory(): RenderComponent {
  return rendererFactory()
  // const Renderer = rendererFactory()
  // return class ReactRenderer extends Renderer implements Component {
  //   readonly props: RendererProps

  //   context: ContextType<any>

  //   setState: (state: RendererState, callback?: () => void) => void

  //   forceUpdate: (callback?: () => void) => void

  //   refs: {
  //     [key: string]: ReactInstance
  //   }

  //   constructor(props: RendererProps, context: ContextType<any>) {
  //     super(props, context)
  //   }

  //   isValidComponent(obj: any) {
  //     return obj?.prototype?.isReactComponent || obj?.prototype instanceof Component
  //   }
  // }
}

export const LowCodeRenderer = factory()
