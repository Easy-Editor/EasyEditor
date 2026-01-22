import type { Designer, Node, Rect } from '@easy-editor/core'
import type { MutableRefObject } from 'react'
import { useCallback, useEffect } from 'react'
import type DragResizeEngine from '../../drag-resize-engine'
import type { Direction } from '../../drag-resize-engine'
import type { ResizeInfo } from '../../shared/types'
import { calculateDashboardRectBox } from '../../utils'
import { calculateResizeRect } from '../utils/resize-calculator'
import { RectUpdater } from '../utils/rect-updater'

interface UseResizeHandlersOptions {
  dragEngine: DragResizeEngine
  designer: Designer
  node: Node | null
  nodes?: Node[]
  startRectRef: MutableRefObject<Rect | null>
  lastInfoRef: MutableRefObject<ResizeInfo | null>
  onOutlineUpdate?: (rect: Rect) => void
}

/**
 * 事件处理 Hook
 * 统一处理 resizeStart/resize/resizeEnd 逻辑
 * 消除 BorderResizingInstance 和 BorderResizingBox 的重复代码
 */
export function useResizeHandlers(options: UseResizeHandlersOptions) {
  const { dragEngine, designer, node, nodes, startRectRef, lastInfoRef, onOutlineUpdate } = options

  /**
   * 缩放开始处理
   */
  const handleResizeStart = useCallback(
    ({ e, direction, node: resizeNode }: { e: MouseEvent; direction: Direction; node: Node }) => {
      // 计算辅助线位置
      designer.guideline.calculateGuideLineInfo()

      // 调用组件的 onResizeStart 回调
      const { advanced } = resizeNode.componentMeta
      if (advanced.callbacks && typeof advanced.callbacks.onResizeStart === 'function') {
        ;(e as any).trigger = direction
        advanced.callbacks.onResizeStart({ ...e, trigger: direction }, resizeNode)
      }

      // 保存开始时的矩形（直接修改 ref.current）
      if (nodes && nodes.length > 0) {
        // 多节点：计算包围盒
        startRectRef.current = calculateDashboardRectBox(nodes)
      } else {
        // 单节点
        startRectRef.current = resizeNode.getDashboardRect()
      }
    },
    [designer, nodes, startRectRef],
  )

  /**
   * 缩放中处理
   */
  const handleResize = useCallback(
    ({
      e,
      direction,
      node: resizeNode,
      moveX,
      moveY,
    }: { e: MouseEvent; direction: Direction; node: Node; moveX: number; moveY: number }) => {
      const startRect = startRectRef.current
      if (!startRect) return

      // 调用组件的 onResize 回调
      const { advanced } = resizeNode.componentMeta
      if (advanced.callbacks && typeof advanced.callbacks.onResize === 'function') {
        ;(e as any).trigger = direction
        ;(e as any).deltaX = moveX
        ;(e as any).deltaY = moveY
        advanced.callbacks.onResize({ ...e, trigger: direction, deltaX: moveX, deltaY: moveY }, resizeNode)
      }

      // 计算新的矩形
      const newRect = calculateResizeRect(designer, direction, { x: moveX, y: moveY }, startRect)

      // 通过 DOM 更新（实时预览）
      if (nodes && nodes.length > 0) {
        // 多节点：更新所有节点
        updateMultipleNodesByDOM(nodes, newRect, startRect)
      } else if (node) {
        // 单节点
        RectUpdater.updateByDOM(node, newRect, startRect)
      }

      // 更新轮廓
      if (onOutlineUpdate) {
        onOutlineUpdate(newRect)
      }

      // 保存最后的缩放信息（直接修改 ref.current）
      lastInfoRef.current = {
        node: resizeNode,
        direction,
        moveX,
        moveY,
      }
    },
    [designer, node, nodes, startRectRef, lastInfoRef, onOutlineUpdate],
  )

  /**
   * 缩放结束处理
   */
  const handleResizeEnd = useCallback(
    ({ e, direction, node: resizeNode }: { e: MouseEvent; direction: Direction; node: Node }) => {
      // 重置辅助线
      designer.guideline.resetAdsorptionLines()

      // 调用组件的 onResizeEnd 回调
      const { advanced } = resizeNode.componentMeta
      if (advanced.callbacks && typeof advanced.callbacks.onResizeEnd === 'function') {
        ;(e as any).trigger = direction
        advanced.callbacks.onResizeEnd({ ...e, trigger: direction }, resizeNode)
      }

      const lastInfo = lastInfoRef.current
      const startRect = startRectRef.current

      // 应用最终的缩放结果（通过 MobX 更新）
      if (lastInfo && startRect) {
        const newRect = calculateResizeRect(
          designer,
          lastInfo.direction,
          { x: lastInfo.moveX, y: lastInfo.moveY },
          startRect,
        )

        if (nodes && nodes.length > 0) {
          // 多节点：更新所有节点
          updateMultipleNodesByNode(nodes, newRect, startRect)
        } else if (node) {
          // 单节点
          RectUpdater.updateByNode(node, lastInfo.direction, newRect, startRect)
        }

        // 清空辅助线
        designer.guideline.resetAdsorptionLines()
      }

      // 发送事件
      const editor = resizeNode.document?.designer.editor
      const selected = resizeNode?.componentMeta?.componentName || ''
      editor?.eventBus.emit('designer.border.resize', {
        selected,
        layout: resizeNode?.parent?.getPropValue('layout') || '',
      })

      // 清理状态
      lastInfoRef.current = null
      startRectRef.current = null
    },
    [designer, node, nodes, lastInfoRef, startRectRef],
  )

  // 注册事件监听
  useEffect(() => {
    const unsubscribeStart = dragEngine.onResizeStart(handleResizeStart)
    const unsubscribeResize = dragEngine.onResize(handleResize)
    const unsubscribeEnd = dragEngine.onResizeEnd(handleResizeEnd)

    return () => {
      unsubscribeStart()
      unsubscribeResize()
      unsubscribeEnd()
    }
  }, [dragEngine, handleResizeStart, handleResize, handleResizeEnd])

  return {
    handleResizeStart,
    handleResize,
    handleResizeEnd,
  }
}

/**
 * 通过 DOM 更新多个节点
 */
function updateMultipleNodesByDOM(nodes: Node[], newRect: Rect, startRect: Rect): void {
  const ratioWidth = newRect.width / startRect.width
  const ratioHeight = newRect.height / startRect.height

  requestAnimationFrame(() => {
    for (const node of nodes) {
      if (node.isGroup) {
        // 分组节点：更新子节点
        for (const child of node.getAllNodesInGroup()) {
          const childDom = child.getDashboardContainer()
          if (!childDom) continue

          const childRect = child.getDashboardRect()
          childDom.style.left = `${newRect.x + (childRect.x - startRect.x) * ratioWidth}px`
          childDom.style.top = `${newRect.y + (childRect.y - startRect.y) * ratioHeight}px`
          childDom.style.width = `${childRect.width * ratioWidth}px`
          childDom.style.height = `${childRect.height * ratioHeight}px`
        }
      } else {
        // 普通节点
        const domNode = node.getDashboardContainer()
        if (!domNode) continue

        const rect = node.getDashboardRect()
        domNode.style.left = `${newRect.x + (rect.x - startRect.x) * ratioWidth}px`
        domNode.style.top = `${newRect.y + (rect.y - startRect.y) * ratioHeight}px`
        domNode.style.width = `${rect.width * ratioWidth}px`
        domNode.style.height = `${rect.height * ratioHeight}px`
      }
    }
  })
}

/**
 * 通过 MobX 更新多个节点
 */
function updateMultipleNodesByNode(nodes: Node[], newRect: Rect, startRect: Rect): void {
  const ratioWidth = newRect.width / startRect.width
  const ratioHeight = newRect.height / startRect.height

  for (const node of nodes) {
    if (node.isGroup) {
      // 分组节点：更新子节点
      for (const child of node.getAllNodesInGroup()) {
        const childRect = child.getDashboardRect()
        child.updateDashboardRect({
          x: newRect.x + (childRect.x - startRect.x) * ratioWidth,
          y: newRect.y + (childRect.y - startRect.y) * ratioHeight,
          width: childRect.width * ratioWidth,
          height: childRect.height * ratioHeight,
        })
      }
    } else {
      // 普通节点
      const rect = node.getDashboardRect()
      node.updateDashboardRect({
        x: newRect.x + (rect.x - startRect.x) * ratioWidth,
        y: newRect.y + (rect.y - startRect.y) * ratioHeight,
        width: rect.width * ratioWidth,
        height: rect.height * ratioHeight,
      })
    }
  }
}
