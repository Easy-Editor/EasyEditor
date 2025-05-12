import type { RendererProps } from '@easy-editor/renderer-core'
import { Component, PureComponent, createElement } from 'react'
import { createForwardRefHocElement } from '../utils'
import type { ComponentConstruct, ComponentHocInfo } from './leaf'

const patchDidCatch = (Comp: any, { baseRenderer }: ComponentHocInfo) => {
  if (Comp.patchedCatch) {
    return
  }
  Comp.patchedCatch = true
  const originalDidCatch = Comp.prototype.componentDidCatch
  Comp.prototype.componentDidCatch = function didCatch(this: any, error: Error, errorInfo: any) {
    this.setState({ engineRenderError: true, error })
    if (originalDidCatch && typeof originalDidCatch === 'function') {
      originalDidCatch.call(this, error, errorInfo)
    }
  }

  const { engine } = baseRenderer.context
  const originRender = Comp.prototype.render
  Comp.prototype.render = function () {
    if (this.state && this.state.engineRenderError) {
      this.state.engineRenderError = false
      return engine.createElement(engine.getFaultComponent(), {
        ...this.props,
        error: this.state.error,
        componentName: this.props._componentName,
      })
    }
    return originRender.call(this)
  }
  if (!(Comp.prototype instanceof PureComponent)) {
    const originShouldComponentUpdate = Comp.prototype.shouldComponentUpdate
    Comp.prototype.shouldComponentUpdate = function (nextProps: RendererProps, nextState: any) {
      if (nextState && nextState.engineRenderError) {
        return true
      }
      return originShouldComponentUpdate ? originShouldComponentUpdate.call(this, nextProps, nextState) : true
    }
  }
}

const cache = new Map<string, { Comp: any; WrapperComponent: any }>()

export const compWrapper: ComponentConstruct = (Comp, info) => {
  if (Comp?.prototype?.isReactComponent || Comp?.prototype instanceof Component) {
    patchDidCatch(Comp, info)
    return Comp
  }

  if (info.schema.id && cache.has(info.schema.id) && cache.get(info.schema.id)?.Comp === Comp) {
    return cache.get(info.schema.id)?.WrapperComponent
  }

  class Wrapper extends Component<any> {
    static displayName = Comp.displayName

    render() {
      const { forwardRef, ...rest } = this.props
      // @ts-ignore
      return createElement(Comp, { ...rest, ref: forwardRef })
    }
  }

  patchDidCatch(Wrapper, info)

  const WrapperComponent = createForwardRefHocElement(Wrapper, Comp)

  info.schema.id && cache.set(info.schema.id, { WrapperComponent, Comp })

  return WrapperComponent
}
