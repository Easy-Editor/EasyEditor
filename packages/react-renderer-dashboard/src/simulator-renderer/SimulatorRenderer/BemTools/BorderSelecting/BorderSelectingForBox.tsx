import type { Node } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useEffect, useRef } from 'react'
import { calculateDOMRectBox } from '../utils'

interface BorderSelectingForBoxProps {
  nodes: Node[]
  dragging: boolean
}

/**
 * 多节点选中边框组件
 * 使用 requestAnimationFrame 实现流畅的跟随效果
 */
export const BorderSelectingForBox: React.FC<BorderSelectingForBoxProps> = observer(({ nodes, dragging }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let rafId = -1
    let lastInfo: DOMRect | null = null
    let isMounted = true

    const compute = () => {
      // 检查组件是否已卸载
      if (!isMounted) {
        return
      }

      const rect = calculateDOMRectBox(nodes)

      // 检查是否产生偏移，避免不必要的 DOM 操作
      if (
        rect &&
        (lastInfo?.x !== rect.x ||
          lastInfo?.y !== rect.y ||
          lastInfo?.width !== rect.width ||
          lastInfo?.height !== rect.height)
      ) {
        container.style.width = `${rect.width}px`
        container.style.height = `${rect.height}px`
        container.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`
        lastInfo = rect
      }

      // 使用 requestAnimationFrame 实现流畅跟随
      rafId = requestAnimationFrame(compute)
    }

    compute()

    // 清理函数
    return () => {
      isMounted = false
      if (rafId !== -1) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [nodes])

  let classname = 'lc-borders lc-borders-selecting'
  if (dragging) {
    classname += ' dragging'
  }

  return <div ref={containerRef} className={classname} />
})

BorderSelectingForBox.displayName = 'BorderSelectingForBox'
