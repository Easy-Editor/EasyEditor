import type { Node, Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useCallback, useEffect, useState } from 'react'
import { MarqueeEvent, MarqueeRect } from '@easy-editor/plugin-dashboard'

interface MarqueeSelectionProps {
  host: Simulator
}

/**
 * 框选组件
 * 用于在画布空白区域拖拽框选多个组件
 */
export const MarqueeSelection: React.FC<MarqueeSelectionProps> = observer(({ host }) => {
  const { designer } = host
  const [isSelecting, setIsSelecting] = useState(false)
  const [rect, setRect] = useState<MarqueeRect | null>(null)
  const marqueeSelection = designer.marqueeSelection

  const handleMarqueeStart = useCallback((evt: MarqueeEvent) => {
    setIsSelecting(true)
    setRect(evt.rect)
  }, [])

  const handleMarquee = useCallback((evt: MarqueeEvent) => {
    setRect(evt.rect)
  }, [])

  const handleMarqueeEnd = useCallback(
    (evt: MarqueeEvent) => {
      setIsSelecting(false)
      setRect(null)

      // 计算被框选的节点
      const selectedIds = getNodesInRect(host, evt.rect)

      if (selectedIds.length > 0) {
        if (evt.isCtrlPressed) {
          // Ctrl/Cmd 按下时，添加到现有选择
          const currentIds = designer.selection.selected
          const newIds = [...new Set([...currentIds, ...selectedIds])]
          designer.selection.selectAll(newIds)
        } else {
          // 替换选择
          designer.selection.selectAll(selectedIds)
        }
      } else if (!evt.isCtrlPressed) {
        // 没有框选到任何节点且没有按 Ctrl，清空选择
        designer.selection.clear()
      }
    },
    [host, designer],
  )

  // 检测点击是否在组件节点上（忽略根节点）
  const isClickOnNode = useCallback(
    (target: Element): boolean => {
      // 检查是否点击在 BemTools 层
      let current: Element | null = target
      while (current) {
        if (current.classList?.contains('lc-bem-tools')) {
          return true
        }
        current = current.parentElement
      }

      // 使用 host.getNodeInstanceFromElement 检测是否点击在组件上
      const nodeInstance = host.getNodeInstanceFromElement(target)
      // 忽略根节点，根节点占满画布，点击空白区域也会返回根节点
      if (!nodeInstance?.node || nodeInstance.node.isRoot) {
        return false
      }
      return true
    },
    [host],
  )

  // 绑定框选引擎事件
  useEffect(() => {
    // 通过 DOM 查询获取视口元素
    const viewportElement = document.querySelector('.lc-simulator-canvas-viewport') as HTMLElement
    if (!viewportElement) return

    const unsubscribeFrom = marqueeSelection.from(viewportElement, host.viewport, isClickOnNode)
    const unsubscribeStart = marqueeSelection.onMarqueeStart(handleMarqueeStart)
    const unsubscribeMove = marqueeSelection.onMarquee(handleMarquee)
    const unsubscribeEnd = marqueeSelection.onMarqueeEnd(handleMarqueeEnd)

    return () => {
      unsubscribeFrom()
      unsubscribeStart()
      unsubscribeMove()
      unsubscribeEnd()
    }
  }, [host, marqueeSelection, isClickOnNode, handleMarqueeStart, handleMarquee, handleMarqueeEnd])

  if (!isSelecting || !rect) {
    return null
  }

  return (
    <div
      className='lc-marquee-selection'
      style={{
        transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
        width: rect.width,
        height: rect.height,
      }}
    />
  )
})

MarqueeSelection.displayName = 'MarqueeSelection'

/**
 * 获取在框选矩形内的节点 ID 列表
 * 使用完全包含判定
 */
function getNodesInRect(host: Simulator, marqueeRect: MarqueeRect): string[] {
  const { designer } = host
  const document = designer.currentDocument
  if (!document) return []

  const rootNode = document.rootNode
  if (!rootNode) return []

  const selectedIds: string[] = []

  // 遍历所有子节点
  const checkNode = (node: Node) => {
    if (node.isRoot) {
      // 根节点不参与框选，但需要检查其子节点
      node.children?.forEach(checkNode)
      return
    }

    // 获取节点的 DOM 元素
    const instances = host.getComponentInstances(node)
    if (!instances || instances.length === 0) {
      return
    }

    // 检查节点是否在框选矩形内
    for (const instance of instances) {
      const element = instance as HTMLElement
      if (!element?.getBoundingClientRect) continue

      const nodeRect = getNodeRectInViewport(host, element)
      if (nodeRect && isRectFullyContained(nodeRect, marqueeRect)) {
        if (node.canSelect()) {
          selectedIds.push(node.id)
        }
        break
      }
    }

    // 不递归检查子节点，只选择顶层被框选的节点
  }

  rootNode.children?.forEach(checkNode)

  return selectedIds
}

/**
 * 获取节点在视口中的矩形位置
 */
function getNodeRectInViewport(host: Simulator, element: HTMLElement): MarqueeRect | null {
  const elementRect = element.getBoundingClientRect()

  // 使用 viewport.toLocalPoint 转换左上角坐标
  const topLeft = host.viewport.toLocalPoint({
    clientX: elementRect.left,
    clientY: elementRect.top,
  })

  const scale = host.viewport.scale

  return {
    x: topLeft.clientX,
    y: topLeft.clientY,
    width: elementRect.width / scale,
    height: elementRect.height / scale,
  }
}

/**
 * 判断节点矩形是否完全包含在框选矩形内
 */
function isRectFullyContained(nodeRect: MarqueeRect, marqueeRect: MarqueeRect): boolean {
  return (
    nodeRect.x >= marqueeRect.x &&
    nodeRect.y >= marqueeRect.y &&
    nodeRect.x + nodeRect.width <= marqueeRect.x + marqueeRect.width &&
    nodeRect.y + nodeRect.height <= marqueeRect.y + marqueeRect.height
  )
}
