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

/** 获取数据源数据 */
const getDataSource = (baseRenderer: any) => {
  // component
  const componentDataSource: Record<string, any> = {}
  if (baseRenderer.dataSourceMap) {
    const { dataSourceMap, state } = baseRenderer
    Object.keys(dataSourceMap).forEach(key => {
      componentDataSource[key] = state[key]
    })
  }

  // page
  const pageDataSource: Record<string, any> = {}
  if (baseRenderer.page.dataSourceMap) {
    const { dataSourceMap, state } = baseRenderer.page
    Object.keys(dataSourceMap).forEach(key => {
      pageDataSource[key] = state[key]
    })
  }

  if (Object.keys(componentDataSource).length > 0 || Object.keys(pageDataSource).length > 0) {
    return {
      component: componentDataSource,
      page: pageDataSource,
    }
  }
  return undefined
}

export const compWrapper: ComponentConstruct = (Comp, info) => {
  const { baseRenderer, schema } = info

  if (Comp?.prototype?.isReactComponent || Comp?.prototype instanceof Component) {
    patchDidCatch(Comp, info)
    return Comp
  }

  if (schema.id && cache.has(schema.id) && cache.get(schema.id)?.Comp === Comp) {
    return cache.get(schema.id)?.WrapperComponent
  }

  class Wrapper extends Component<any, { componentDataSource?: Record<string, any> }> {
    static displayName = Comp.displayName

    render() {
      const { forwardRef, ...rest } = this.props

      return createElement(Comp, {
        ...rest,
        ref: forwardRef,
        __dataSource: getDataSource(baseRenderer),
      } as any)
    }
  }

  patchDidCatch(Wrapper, info)

  const WrapperComponent = createForwardRefHocElement(Wrapper, Comp)

  schema.id && cache.set(schema.id, { WrapperComponent, Comp })

  return WrapperComponent
}
