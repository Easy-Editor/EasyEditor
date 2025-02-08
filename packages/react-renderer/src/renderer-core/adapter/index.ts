import type { ComponentType } from 'react'
import type { BaseRenderComponent } from '../types'

import { componentRendererFactory, pageRendererFactory } from '..'

export interface RendererModules {
  BaseRenderer?: BaseRenderComponent
  PageRenderer: BaseRenderComponent
  ComponentRenderer: BaseRenderComponent
}

class Adapter {
  renderers: RendererModules = {
    PageRenderer: pageRendererFactory(),
    ComponentRenderer: componentRendererFactory(),
  }

  setRenderers(renderers: RendererModules) {
    this.renderers = renderers
  }

  setBaseRenderer(BaseRenderer: BaseRenderComponent) {
    this.renderers.BaseRenderer = BaseRenderer
  }

  setPageRenderer(PageRenderer: BaseRenderComponent) {
    this.renderers.PageRenderer = PageRenderer
  }

  setComponentRenderer(ComponentRenderer: BaseRenderComponent) {
    this.renderers.ComponentRenderer = ComponentRenderer
  }

  getRenderers() {
    return (this.renderers || {}) as unknown as Record<string, ComponentType>
  }
}

export const adapter = new Adapter()
