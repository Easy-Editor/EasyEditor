import type { Rect } from '@easy-editor/core'
import type { Point } from '../../shared/types'

/**
 * 缩放策略接口
 * 使用策略模式处理8个不同方向的缩放逻辑
 */
export interface ResizeStrategy {
  /**
   * 计算缩放后的矩形
   * @param startRect 开始时的矩形
   * @param delta 偏移量
   * @returns 新的矩形（部分字段）
   */
  calculate(startRect: Rect, delta: Point): Partial<Rect>

  /**
   * 获取吸附索引
   * @returns 吸附索引（0=左/上, 1=中, 2=右/下）
   */
  getAdsorptionIndex(): number | number[]

  /**
   * 应用约束条件（最小宽高）
   * @param rect 当前矩形
   * @param startRect 开始时的矩形
   * @returns 应用约束后的矩形
   */
  applyConstraints(rect: Rect, startRect: Rect): Rect
}
