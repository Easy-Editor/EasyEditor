import type { Node, Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Direction } from '../drag-resize-engine'
import type { ResizeRefs } from '../shared/types'
import { ResizeHandles } from './ResizeHandles'
import { useOutlineUpdater } from './hooks/useOutlineUpdater'
import { useResizeEngine } from './hooks/useResizeEngine'
import { useResizeHandlers } from './hooks/useResizeHandlers'

interface BorderResizingInstanceProps {
  host: Simulator
  node: Node
}

/**
 * 单节点缩放组件
 */
export const BorderResizingInstance: React.FC<BorderResizingInstanceProps> = observer(({ host, node }) => {
  const { designer } = host
  const rect = node.getDashboardRect()

  // 使用 useRef 存储累积的 refs
  const refsMap = useRef<ResizeRefs>({
    borderN: null,
    borderE: null,
    borderS: null,
    borderW: null,
    cornerNE: null,
    cornerNW: null,
    cornerSE: null,
    cornerSW: null,
  })

  // 追踪 refs 是否全部就绪
  const [refsReady, setRefsReady] = useState(false)

  // 使用 Hooks 管理状态和逻辑
  const { dragEngine, startRectRef, lastInfoRef } = useResizeEngine(designer)
  const { updateOutlines } = useOutlineUpdater(refsMap.current)

  // 使用事件处理 Hook
  useResizeHandlers({
    dragEngine,
    designer,
    node,
    startRectRef,
    lastInfoRef,
    onOutlineUpdate: updateOutlines,
  })

  // 绑定缩放手柄到拖拽引擎
  useEffect(() => {
    if (!refsReady) return

    const bindings = [
      { ref: refsMap.current.borderN, direction: Direction.N },
      { ref: refsMap.current.borderE, direction: Direction.E },
      { ref: refsMap.current.borderS, direction: Direction.S },
      { ref: refsMap.current.borderW, direction: Direction.W },
      { ref: refsMap.current.cornerNE, direction: Direction.NE },
      { ref: refsMap.current.cornerNW, direction: Direction.NW },
      { ref: refsMap.current.cornerSE, direction: Direction.SE },
      { ref: refsMap.current.cornerSW, direction: Direction.SW },
    ]

    const unbindFns = bindings
      .filter(({ ref }) => ref)
      .map(({ ref, direction }) => dragEngine.from(ref!, direction, () => node))

    return () => {
      unbindFns.forEach(fn => fn())
    }
  }, [dragEngine, node, refsReady])

  // Refs 回调 - 累积所有 refs
  const handleRefReady = useCallback(
    (newRefs: Partial<ResizeRefs>) => {
      Object.assign(refsMap.current, newRefs)

      // 检查是否所有 refs 都已就绪
      const allReady = Object.values(refsMap.current).every(ref => ref !== null)
      if (allReady && !refsReady) {
        setRefsReady(true)
      }
    },
    [refsReady],
  )

  if (!rect) {
    return null
  }

  return <ResizeHandles rect={rect} onRefReady={handleRefReady} />
})

BorderResizingInstance.displayName = 'BorderResizingInstance'
