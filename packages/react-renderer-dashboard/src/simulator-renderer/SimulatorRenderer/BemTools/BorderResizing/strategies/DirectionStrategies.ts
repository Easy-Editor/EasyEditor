import type { Rect } from '@easy-editor/core'
import type { Point } from '../../shared/types'
import { RESIZE_MIN_HEIGHT, RESIZE_MIN_WIDTH } from '../utils/constants'
import type { ResizeStrategy } from './ResizeStrategy'

/**
 * 北向（上）缩放策略
 */
export class NorthResizeStrategy implements ResizeStrategy {
  calculate(startRect: Rect, delta: Point): Partial<Rect> {
    return {
      y: startRect.y + delta.y,
      height: startRect.height - delta.y,
    }
  }

  getAdsorptionIndex(): number {
    return 0
  }

  applyConstraints(rect: Rect, startRect: Rect): Rect {
    if (rect.height < RESIZE_MIN_HEIGHT) {
      return {
        ...rect,
        height: RESIZE_MIN_HEIGHT,
        y: startRect.y + startRect.height - RESIZE_MIN_HEIGHT,
      }
    }
    return rect
  }
}

/**
 * 南向（下）缩放策略
 */
export class SouthResizeStrategy implements ResizeStrategy {
  calculate(startRect: Rect, delta: Point): Partial<Rect> {
    return {
      height: startRect.height + delta.y,
    }
  }

  getAdsorptionIndex(): number {
    return 2
  }

  applyConstraints(rect: Rect, startRect: Rect): Rect {
    if (rect.height < RESIZE_MIN_HEIGHT) {
      return {
        ...rect,
        height: RESIZE_MIN_HEIGHT,
      }
    }
    return rect
  }
}

/**
 * 西向（左）缩放策略
 */
export class WestResizeStrategy implements ResizeStrategy {
  calculate(startRect: Rect, delta: Point): Partial<Rect> {
    return {
      x: startRect.x + delta.x,
      width: startRect.width - delta.x,
    }
  }

  getAdsorptionIndex(): number {
    return 0
  }

  applyConstraints(rect: Rect, startRect: Rect): Rect {
    if (rect.width < RESIZE_MIN_WIDTH) {
      return {
        ...rect,
        width: RESIZE_MIN_WIDTH,
        x: startRect.x + startRect.width - RESIZE_MIN_WIDTH,
      }
    }
    return rect
  }
}

/**
 * 东向（右）缩放策略
 */
export class EastResizeStrategy implements ResizeStrategy {
  calculate(startRect: Rect, delta: Point): Partial<Rect> {
    return {
      width: startRect.width + delta.x,
    }
  }

  getAdsorptionIndex(): number {
    return 2
  }

  applyConstraints(rect: Rect, startRect: Rect): Rect {
    if (rect.width < RESIZE_MIN_WIDTH) {
      return {
        ...rect,
        width: RESIZE_MIN_WIDTH,
      }
    }
    return rect
  }
}

/**
 * 西北向（左上）缩放策略
 */
export class NorthWestResizeStrategy implements ResizeStrategy {
  calculate(startRect: Rect, delta: Point): Partial<Rect> {
    return {
      x: startRect.x + delta.x,
      y: startRect.y + delta.y,
      width: startRect.width - delta.x,
      height: startRect.height - delta.y,
    }
  }

  getAdsorptionIndex(): number {
    return 0
  }

  applyConstraints(rect: Rect, startRect: Rect): Rect {
    const result = { ...rect }

    if (result.width < RESIZE_MIN_WIDTH) {
      result.width = RESIZE_MIN_WIDTH
      result.x = startRect.x + startRect.width - RESIZE_MIN_WIDTH
    }

    if (result.height < RESIZE_MIN_HEIGHT) {
      result.height = RESIZE_MIN_HEIGHT
      result.y = startRect.y + startRect.height - RESIZE_MIN_HEIGHT
    }

    return result
  }
}

/**
 * 东北向（右上）缩放策略
 */
export class NorthEastResizeStrategy implements ResizeStrategy {
  calculate(startRect: Rect, delta: Point): Partial<Rect> {
    return {
      y: startRect.y + delta.y,
      width: startRect.width + delta.x,
      height: startRect.height - delta.y,
    }
  }

  getAdsorptionIndex(): number | number[] {
    return [0, 2]
  }

  applyConstraints(rect: Rect, startRect: Rect): Rect {
    const result = { ...rect }

    if (result.width < RESIZE_MIN_WIDTH) {
      result.width = RESIZE_MIN_WIDTH
    }

    if (result.height < RESIZE_MIN_HEIGHT) {
      result.height = RESIZE_MIN_HEIGHT
      result.y = startRect.y + startRect.height - RESIZE_MIN_HEIGHT
    }

    return result
  }
}

/**
 * 东南向（右下）缩放策略
 */
export class SouthEastResizeStrategy implements ResizeStrategy {
  calculate(startRect: Rect, delta: Point): Partial<Rect> {
    return {
      width: startRect.width + delta.x,
      height: startRect.height + delta.y,
    }
  }

  getAdsorptionIndex(): number {
    return 2
  }

  applyConstraints(rect: Rect, startRect: Rect): Rect {
    const result = { ...rect }

    if (result.width < RESIZE_MIN_WIDTH) {
      result.width = RESIZE_MIN_WIDTH
    }

    if (result.height < RESIZE_MIN_HEIGHT) {
      result.height = RESIZE_MIN_HEIGHT
    }

    return result
  }
}

/**
 * 西南向（左下）缩放策略
 */
export class SouthWestResizeStrategy implements ResizeStrategy {
  calculate(startRect: Rect, delta: Point): Partial<Rect> {
    return {
      x: startRect.x + delta.x,
      width: startRect.width - delta.x,
      height: startRect.height + delta.y,
    }
  }

  getAdsorptionIndex(): number | number[] {
    return [0, 2]
  }

  applyConstraints(rect: Rect, startRect: Rect): Rect {
    const result = { ...rect }

    if (result.width < RESIZE_MIN_WIDTH) {
      result.width = RESIZE_MIN_WIDTH
      result.x = startRect.x + startRect.width - RESIZE_MIN_WIDTH
    }

    if (result.height < RESIZE_MIN_HEIGHT) {
      result.height = RESIZE_MIN_HEIGHT
    }

    return result
  }
}
