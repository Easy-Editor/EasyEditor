import { type ComponentHocInfo, createForwardRefHocElement } from '@easy-editor/react-renderer'
import { classnames } from '@easy-editor/renderer-core'
import { Component } from 'react'
import { DashboardWrapper } from '../components'
import { computeRect } from '../components/DashboardWrapper'

type DashboardWrapperContext = Pick<ComponentHocInfo, 'baseRenderer' | 'schema'>

type DashboardWrapperCacheEntry = {
  Comp: any
  context: DashboardWrapperContext
  WrappedComponent: any
}

const dashboardWrapperCache = new WeakMap<object, Map<string, DashboardWrapperCacheEntry>>()

function createDashboardWrapperEntry(Comp: any, context: DashboardWrapperContext): DashboardWrapperCacheEntry {
  const entry: DashboardWrapperCacheEntry = {
    Comp,
    context,
    WrappedComponent: undefined,
  }

  class Wrapper extends Component<any> {
    render() {
      const CurrentComponent = entry.Comp
      const { schema, baseRenderer } = entry.context
      const host = baseRenderer.props?.__host
      const isDesignMode = host?.designMode === 'design'
      const mask = isDesignMode ? (host?.dashboardStyle?.mask ?? true) : false
      const { forwardRef, children, className, ...rest } = this.props
      // TODO：存在二次计算 rect 的问题
      const rect = computeRect(schema)

      if (!rect) {
        return null
      }

      if (schema.isRoot) {
        return (
          <CurrentComponent ref={forwardRef} {...rest}>
            {children}
          </CurrentComponent>
        )
      }

      return (
        <DashboardWrapper schema={schema} mask={mask} forwardRef={forwardRef}>
          <CurrentComponent className={classnames('lc-component', mask && 'mask', className)} {...rest}>
            {children && (
              <div
                style={{
                  position: 'absolute',
                  left: -rect.x!,
                  top: -rect.y!,
                }}
              >
                {children}
              </div>
            )}
          </CurrentComponent>
        </DashboardWrapper>
      )
    }
  }
  ;(Wrapper as any).displayName = Comp.displayName

  entry.WrappedComponent = createForwardRefHocElement(Wrapper, Comp)
  return entry
}

export function dashboardWrapper(Comp: any, context: ComponentHocInfo) {
  const { schema, baseRenderer } = context
  const nodeId = schema.id

  if (!nodeId || !baseRenderer || (typeof baseRenderer !== 'object' && typeof baseRenderer !== 'function')) {
    return createDashboardWrapperEntry(Comp, context).WrappedComponent
  }

  let rendererCache = dashboardWrapperCache.get(baseRenderer)
  if (!rendererCache) {
    rendererCache = new Map()
    dashboardWrapperCache.set(baseRenderer, rendererCache)
  }

  let entry = rendererCache.get(nodeId)
  if (entry) {
    entry.Comp = Comp
    entry.context = context
  } else {
    entry = createDashboardWrapperEntry(Comp, context)
    rendererCache.set(nodeId, entry)
  }

  return entry.WrappedComponent
}
