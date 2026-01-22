import type { Designer, Rect } from '@easy-editor/core'
import { useMemo, useRef } from 'react'
import DragResizeEngine from '../../drag-resize-engine'
import type { ResizeInfo } from '../../shared/types'

/**
 * 缩放引擎 Hook
 * 管理 DragResizeEngine 实例和缩放状态
 *
 * 注意：使用 useRef 而非 useState 存储 startRect 和 lastInfo，
 * 因为这些值需要在事件处理函数中立即获取最新值，
 * 而 useState 的更新是异步的。
 */
export function useResizeEngine(designer: Designer) {
  // 创建拖拽引擎实例（只创建一次）
  const dragEngine = useMemo(() => new DragResizeEngine(designer), [designer])

  // 缩放开始时的矩形（使用 ref 确保同步更新）
  const startRectRef = useRef<Rect | null>(null)

  // 最后一次缩放信息（用于在缩放结束时更新节点）
  const lastInfoRef = useRef<ResizeInfo | null>(null)

  return {
    dragEngine,
    startRectRef,
    lastInfoRef,
  }
}
