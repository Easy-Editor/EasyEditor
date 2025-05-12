import type { ComponentType } from 'react'
import type { BaseRendererComponent } from '../types'

export interface RendererModules {
  BaseRenderer?: BaseRendererComponent
  PageRenderer: BaseRendererComponent
  ComponentRenderer: BaseRendererComponent
}

class Adapter {
  // @ts-ignore
  renderers: RendererModules = {}

  setRenderers(renderers: RendererModules) {
    this.renderers = renderers
  }

  setBaseRenderer(BaseRenderer: BaseRendererComponent) {
    this.renderers.BaseRenderer = BaseRenderer
  }

  setPageRenderer(PageRenderer: BaseRendererComponent) {
    this.renderers.PageRenderer = PageRenderer
  }

  setComponentRenderer(ComponentRenderer: BaseRendererComponent) {
    this.renderers.ComponentRenderer = ComponentRenderer
  }

  getRenderers() {
    return (this.renderers || {}) as unknown as Record<string, ComponentType<any>>
  }
}

export const adapter = new Adapter()
