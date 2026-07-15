import type { ComponentType } from '@easy-editor/core'
import type { BaseRendererComponent } from '../types'

export interface RendererModules {
  BaseRenderer?: BaseRendererComponent
  PageRenderer: BaseRendererComponent
  ComponentRenderer: BaseRendererComponent
}

export class RendererAdapter {
  private renderers: Partial<RendererModules>

  constructor(renderers: Partial<RendererModules> = {}) {
    this.renderers = { ...renderers }
  }

  setRenderers(renderers: RendererModules) {
    this.renderers = { ...renderers }
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
    return Object.freeze({ ...this.renderers }) as Readonly<Record<string, ComponentType<any>>>
  }
}

/** Create one renderer module graph owned by one renderer composition. */
export const createRendererAdapter = (renderers: Partial<RendererModules> = {}): RendererAdapter =>
  new RendererAdapter(renderers)
