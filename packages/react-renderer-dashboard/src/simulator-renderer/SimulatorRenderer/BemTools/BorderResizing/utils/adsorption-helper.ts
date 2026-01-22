import type { Designer, Rect } from '@easy-editor/core'

/**
 * 应用吸附效果到矩形
 * @param designer 设计器实例
 * @param rect 当前矩形
 * @param adsorptionIndex 吸附索引（0=左/上, 1=中, 2=右/下）
 * @returns 应用吸附后的矩形
 */
export function applyAdsorption(designer: Designer, rect: Rect, adsorptionIndex: number | number[]): Rect {
  const adsorption = designer.guideline.getAdsorptionPosition(
    new DOMRect(rect.x, rect.y, rect.width, rect.height),
    adsorptionIndex,
  )

  if (!adsorption.isAdsorption) {
    return rect
  }

  const result = { ...rect }

  // 应用 X 轴吸附
  if (adsorption.adsorb.x) {
    const { position } = adsorption.adsorb.x
    applyXAdsorption(result, position, adsorptionIndex)
  }

  // 应用 Y 轴吸附
  if (adsorption.adsorb.y) {
    const { position } = adsorption.adsorb.y
    applyYAdsorption(result, position, adsorptionIndex)
  }

  return result
}

/**
 * 应用 X 轴吸附
 * @param rect 矩形（会被修改）
 * @param position 吸附位置
 * @param index 吸附索引
 */
function applyXAdsorption(rect: Rect, position: number, index: number | number[]): void {
  const indices = Array.isArray(index) ? index : [index]

  for (const idx of indices) {
    if (idx === 0) {
      // 左边吸附
      const oldX = rect.x
      rect.x = position
      rect.width = rect.width + (oldX - position)
    } else if (idx === 2) {
      // 右边吸附
      rect.width = position - rect.x
    }
  }
}

/**
 * 应用 Y 轴吸附
 * @param rect 矩形（会被修改）
 * @param position 吸附位置
 * @param index 吸附索引
 */
function applyYAdsorption(rect: Rect, position: number, index: number | number[]): void {
  const indices = Array.isArray(index) ? index : [index]

  for (const idx of indices) {
    if (idx === 0) {
      // 上边吸附
      const oldY = rect.y
      rect.y = position
      rect.height = rect.height + (oldY - position)
    } else if (idx === 2) {
      // 下边吸附
      rect.height = position - rect.y
    }
  }
}
