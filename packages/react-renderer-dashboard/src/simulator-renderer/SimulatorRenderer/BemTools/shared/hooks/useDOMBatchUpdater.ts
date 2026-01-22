import { useCallback, useEffect, useRef } from 'react'

type CSSProperties = Partial<CSSStyleDeclaration>

/**
 * DOM 批量更新 Hook
 * 批量更新 DOM 样式，使用 RAF 优化性能
 */
export function useDOMBatchUpdater() {
  const updates = useRef(new Map<HTMLElement, CSSProperties>())
  const rafId = useRef<number | null>(null)

  /**
   * 调度 DOM 样式更新
   * @param element DOM 元素
   * @param styles 样式对象
   */
  const schedule = useCallback((element: HTMLElement, styles: CSSProperties) => {
    // 合并样式更新
    const existingStyles = updates.current.get(element) || {}
    updates.current.set(element, { ...existingStyles, ...styles })

    // 调度批量更新
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        flush()
      })
    }
  }, [])

  /**
   * 立即执行所有待处理的更新
   */
  const flush = useCallback(() => {
    updates.current.forEach((styles, element) => {
      Object.assign(element.style, styles)
    })
    updates.current.clear()
    rafId.current = null
  }, [])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current)
      }
    }
  }, [])

  return { schedule, flush }
}
