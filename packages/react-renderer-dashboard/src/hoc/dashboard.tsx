import type { NodeSchema } from '@easy-editor/core'
import { type ComponentHocInfo, createForwardRefHocElement } from '@easy-editor/react-renderer'
import { Component } from 'react'

export function dashboardWrapper(Comp: any, { schema, baseRenderer, componentInfo, scope }: ComponentHocInfo) {
  // const getNode = baseRenderer.props?.getNode
  // const container = baseRenderer.props?.__container
  const host = baseRenderer.props?.__host
  // dashboardStyle 大屏配置信息
  const { mask = true } = host?.get('dashboardStyle') || {}

  class Wrapper extends Component<any> {
    render() {
      const { forwardRef, children, __designMode, className, ...rest } = this.props
      const rect = computeRect(schema)

      if (!rect) {
        return null
      }

      // TODO: TEMP
      if (schema.componentName === 'RootContainer') {
        return (
          <Comp ref={forwardRef} {...rest}>
            {children}
          </Comp>
        )
      }

      return (
        // mask 层
        <div
          id={`${schema.id}-container`}
          className={`lc-simulator-component-container ${mask ? 'mask' : ''}`}
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        >
          {/* 重置坐标系 */}
          <div
            style={{
              position: 'absolute',
              left: -rect.x!,
              top: -rect.y!,
            }}
          >
            {/* 组件坐标定位 */}
            <div
              ref={forwardRef}
              id={`${schema.id}-mask`}
              className='lc-simulator-component-mask'
              style={{
                left: rect.x!,
                top: rect.y!,
                width: rect.width,
                height: rect.height,
              }}
            >
              {/* 组件渲染 */}
              <Comp className={`lc-simulator-component ${mask ? 'mask' : ''} ${className}`} {...rest}>
                {children && (
                  // 再次重置坐标系，用于内部组件定位
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
            </div>
          </div>
        </div>
      )
    }
  }
  ;(Wrapper as any).displayName = Comp.displayName

  return createForwardRefHocElement(Wrapper, Comp)
}

/**
 * 计算节点在 dashboard 中的位置信息
 */
const computeRect = (node: NodeSchema) => {
  if (!node.isGroup || !node.children || node.children.length === 0) {
    return node.$dashboard?.rect
  }

  let [minX, minY, maxX, maxY] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]

  for (const child of node.children) {
    let childRect: any
    if (child.isGroup) {
      childRect = computeRect(child)
    } else {
      childRect = child.$dashboard?.rect
    }
    const x = childRect?.x
    const y = childRect?.y
    const width = childRect?.width || 0
    const height = childRect?.height || 0

    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}
