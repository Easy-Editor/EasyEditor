import { Direction } from '../../drag-resize-engine'
import {
  EastResizeStrategy,
  NorthEastResizeStrategy,
  NorthResizeStrategy,
  NorthWestResizeStrategy,
  SouthEastResizeStrategy,
  SouthResizeStrategy,
  SouthWestResizeStrategy,
  WestResizeStrategy,
} from './DirectionStrategies'
import type { ResizeStrategy } from './ResizeStrategy'

/**
 * 缩放策略工厂
 * 使用工厂模式创建和管理策略实例
 */
export class ResizeStrategyFactory {
  private static strategies = new Map<Direction, ResizeStrategy>([
    [Direction.N, new NorthResizeStrategy()],
    [Direction.S, new SouthResizeStrategy()],
    [Direction.W, new WestResizeStrategy()],
    [Direction.E, new EastResizeStrategy()],
    [Direction.NW, new NorthWestResizeStrategy()],
    [Direction.NE, new NorthEastResizeStrategy()],
    [Direction.SW, new SouthWestResizeStrategy()],
    [Direction.SE, new SouthEastResizeStrategy()],
  ])

  /**
   * 获取指定方向的缩放策略
   * @param direction 缩放方向
   * @returns 缩放策略实例
   */
  static getStrategy(direction: Direction): ResizeStrategy {
    const strategy = this.strategies.get(direction)
    if (!strategy) {
      throw new Error(`Unknown resize direction: ${direction}`)
    }
    return strategy
  }
}
