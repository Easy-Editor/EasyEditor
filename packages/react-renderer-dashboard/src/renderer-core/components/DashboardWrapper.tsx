import type { NodeSchema } from '@easy-editor/core'
import { classnames, logger } from '@easy-editor/renderer-core'
import type { FC } from 'react'

interface DashboardWrapperProps {
  schema: NodeSchema
  children?: React.ReactNode
  mask?: boolean
  forwardRef?: React.RefObject<HTMLDivElement>
}

/**
 * 大屏定位容器
 */
const DashboardWrapper: FC<DashboardWrapperProps> = ({ schema, mask = true, forwardRef, children }) => {
  const rect = computeRect(schema)

  if (!rect) {
    logger.error('DashboardWrapper: schema is not found in dashboard', schema)
    return null
  }

  return (
    <div
      className={classnames('lc-component-container', mask && 'mask')}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: -rect.x!,
          top: -rect.y!,
        }}
      >
        <div
          ref={forwardRef}
          className='lc-component-mask'
          style={{
            left: rect.x!,
            top: rect.y!,
            width: rect.width,
            height: rect.height,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

export default DashboardWrapper

/**
 * 计算节点在 dashboard 中的位置和尺寸
 */
export const computeRect = (node: NodeSchema) => {
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
