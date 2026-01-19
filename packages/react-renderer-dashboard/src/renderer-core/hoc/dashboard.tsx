import { type ComponentHocInfo, createForwardRefHocElement } from '@easy-editor/react-renderer'
import { classnames } from '@easy-editor/renderer-core'
import { Component } from 'react'
import { DashboardWrapper } from '../components'
import { computeRect } from '../components/DashboardWrapper'

export function dashboardWrapper(Comp: any, { schema, baseRenderer }: ComponentHocInfo) {
  const host = baseRenderer.props?.__host
  const isDesignMode = host?.designMode === 'design'
  let { mask = true } = host?.dashboardStyle || {}

  if (!isDesignMode) {
    mask = false
  }

  class Wrapper extends Component<any> {
    render() {
      const { forwardRef, children, className, ...rest } = this.props
      // TODO：存在二次计算 rect 的问题
      const rect = computeRect(schema)

      if (!rect) {
        return null
      }

      if (schema.isRoot) {
        return (
          <Comp ref={forwardRef} {...rest}>
            {children}
          </Comp>
        )
      }

      return (
        <DashboardWrapper schema={schema} mask={mask} forwardRef={forwardRef}>
          <Comp className={classnames('lc-component', mask && 'mask', className)} {...rest}>
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
          </Comp>
        </DashboardWrapper>
      )
    }
  }
  ;(Wrapper as any).displayName = Comp.displayName

  return createForwardRefHocElement(Wrapper, Comp)
}
