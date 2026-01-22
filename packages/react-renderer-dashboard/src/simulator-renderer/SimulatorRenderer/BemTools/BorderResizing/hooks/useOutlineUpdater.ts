import type { Rect } from '@easy-editor/core'
import { useCallback } from 'react'
import type { ResizeRefs } from '../../shared/types'
import { useAnimationFrame } from '../../shared/hooks/useAnimationFrame'

/**
 * 轮廓更新 Hook
 * 使用 RAF 优化轮廓更新性能
 */
export function useOutlineUpdater(refs: ResizeRefs) {
  const { scheduleUpdate } = useAnimationFrame()

  /**
   * 更新所有轮廓（边框和角点）
   * @param rect 新的矩形
   */
  const updateOutlines = useCallback(
    (rect: Rect) => {
      scheduleUpdate(() => {
        updateBorders(refs, rect)
        updateCorners(refs, rect)
      })
    },
    [refs, scheduleUpdate],
  )

  return { updateOutlines }
}

/**
 * 更新四边边框
 */
function updateBorders(refs: ResizeRefs, rect: Rect): void {
  if (refs.borderN) {
    refs.borderN.style.width = `${rect.width}px`
    refs.borderN.style.transform = `translate(${rect.x}px, ${rect.y}px)`
  }

  if (refs.borderS) {
    refs.borderS.style.width = `${rect.width}px`
    refs.borderS.style.transform = `translate(${rect.x}px, ${rect.y + rect.height}px)`
  }

  if (refs.borderE) {
    refs.borderE.style.height = `${rect.height}px`
    refs.borderE.style.transform = `translate(${rect.x + rect.width}px, ${rect.y}px)`
  }

  if (refs.borderW) {
    refs.borderW.style.height = `${rect.height}px`
    refs.borderW.style.transform = `translate(${rect.x}px, ${rect.y}px)`
  }
}

/**
 * 更新四个角点
 */
function updateCorners(refs: ResizeRefs, rect: Rect): void {
  if (refs.cornerNW) {
    refs.cornerNW.style.left = `${rect.x - 4}px`
    refs.cornerNW.style.top = `${rect.y - 4}px`
  }

  if (refs.cornerNE) {
    refs.cornerNE.style.left = `${rect.x + rect.width - 4}px`
    refs.cornerNE.style.top = `${rect.y - 4}px`
  }

  if (refs.cornerSW) {
    refs.cornerSW.style.left = `${rect.x - 4}px`
    refs.cornerSW.style.top = `${rect.y + rect.height - 4}px`
  }

  if (refs.cornerSE) {
    refs.cornerSE.style.left = `${rect.x + rect.width - 4}px`
    refs.cornerSE.style.top = `${rect.y + rect.height - 4}px`
  }
}
