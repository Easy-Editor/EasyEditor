import type { Designer, Rect } from '@easy-editor/core'
import type { Direction } from '../../drag-resize-engine'
import type { Point } from '../../shared/types'
import { ResizeStrategyFactory } from '../strategies/StrategyFactory'
import { applyAdsorption } from './adsorption-helper'

/**
 * 计算缩放后的矩形
 * 使用策略模式简化原来215行的 calculateResizeRectByDirection 函数
 *
 * @param designer 设计器实例
 * @param direction 缩放方向
 * @param delta 偏移量
 * @param startRect 开始时的矩形
 * @returns 缩放后的矩形
 */
export function calculateResizeRect(designer: Designer, direction: Direction, delta: Point, startRect: Rect): DOMRect {
  // 步骤 1: 获取对应方向的策略
  const strategy = ResizeStrategyFactory.getStrategy(direction)

  // 步骤 2: 计算基础矩形
  // 注意：DOMRect 的 x, y, width, height 是 getter，不是自有属性，需要显式提取
  const calculated = strategy.calculate(startRect, delta)
  const newRect: Rect = {
    x: startRect.x,
    y: startRect.y,
    width: startRect.width,
    height: startRect.height,
    ...calculated,
  }

  // 步骤 3: 应用吸附
  const adsorptionIndex = strategy.getAdsorptionIndex()
  const adsorbedRect = applyAdsorption(designer, newRect, adsorptionIndex)

  // 步骤 4: 应用约束（最小宽高）
  const constrainedRect = strategy.applyConstraints(adsorbedRect, startRect)

  return new DOMRect(constrainedRect.x, constrainedRect.y, constrainedRect.width, constrainedRect.height)
}
