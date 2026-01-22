import { useCallback, useEffect, useRef } from 'react'

/**
 * RAF 优化 Hook
 * 使用 requestAnimationFrame 批量处理更新，提升性能
 */
export function useAnimationFrame() {
  const rafId = useRef<number | undefined>(undefined)
  const pendingUpdates = useRef<Array<() => void>>([])

  /**
   * 调度更新
   * 多个更新会被批量处理在同一帧中执行
   */
  const scheduleUpdate = useCallback((update: () => void) => {
    pendingUpdates.current.push(update)

    if (rafId.current === undefined) {
      rafId.current = requestAnimationFrame(() => {
        const updates = pendingUpdates.current
        pendingUpdates.current = []
        rafId.current = undefined

        // 批量执行所有更新
        updates.forEach(fn => fn())
      })
    }
  }, [])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current)
      }
    }
  }, [])

  return { scheduleUpdate }
}
