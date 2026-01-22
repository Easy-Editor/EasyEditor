import type { Node, Rect } from '@easy-editor/core'
import type { Direction } from '../../drag-resize-engine'
import { Direction as Dir } from '../../drag-resize-engine'

/**
 * 矩形更新器
 * 统一处理节点和DOM的矩形更新逻辑
 */
export class RectUpdater {
  /**
   * 通过 MobX 更新节点矩形
   * @param node 节点
   * @param direction 缩放方向
   * @param rect 新的矩形
   * @param startRect 开始时的矩形
   */
  static updateByNode(node: Node, direction: Direction, rect: Rect, startRect: Rect): void {
    const updates = this.getUpdateFields(direction, rect)
    node.updateDashboardRect(updates)

    // 处理分组节点
    if (node.isGroup) {
      this.updateGroupChildren(node, rect, startRect)
    }
  }

  /**
   * 通过 DOM 更新节点矩形（用于拖拽过程中的实时更新）
   * @param node 节点
   * @param rect 新的矩形
   * @param startRect 开始时的矩形
   */
  static updateByDOM(node: Node, rect: Rect, startRect: Rect): void {
    const domNode = node.getDashboardContainer()
    if (!domNode) return

    // 使用 requestAnimationFrame 优化性能
    requestAnimationFrame(() => {
      domNode.style.left = `${rect.x}px`
      domNode.style.top = `${rect.y}px`
      domNode.style.width = `${rect.width}px`
      domNode.style.height = `${rect.height}px`
    })

    // 处理分组节点
    if (node.isGroup) {
      this.updateGroupChildrenByDOM(node, rect, startRect)
    }
  }

  /**
   * 根据方向获取需要更新的字段
   * @param direction 缩放方向
   * @param rect 新的矩形
   * @returns 需要更新的字段
   */
  private static getUpdateFields(direction: Direction, rect: Rect): Partial<Rect> {
    const fieldMap: Record<Direction, Partial<Rect>> = {
      [Dir.N]: { y: rect.y, height: rect.height },
      [Dir.S]: { height: rect.height },
      [Dir.W]: { x: rect.x, width: rect.width },
      [Dir.E]: { width: rect.width },
      [Dir.NW]: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      [Dir.NE]: { y: rect.y, width: rect.width, height: rect.height },
      [Dir.SE]: { width: rect.width, height: rect.height },
      [Dir.SW]: { x: rect.x, width: rect.width, height: rect.height },
    }
    return fieldMap[direction]
  }

  /**
   * 更新分组的子节点（通过 MobX）
   * @param node 分组节点
   * @param newRect 新的矩形
   * @param startRect 开始时的矩形
   */
  private static updateGroupChildren(node: Node, newRect: Rect, startRect: Rect): void {
    const ratioWidth = newRect.width / startRect.width
    const ratioHeight = newRect.height / startRect.height

    for (const child of node.getAllNodesInGroup()) {
      const childRect = child.getDashboardRect()
      child.updateDashboardRect({
        x: newRect.x + (childRect.x - startRect.x) * ratioWidth,
        y: newRect.y + (childRect.y - startRect.y) * ratioHeight,
        width: childRect.width * ratioWidth,
        height: childRect.height * ratioHeight,
      })
    }
  }

  /**
   * 更新分组的子节点（通过 DOM）
   * @param node 分组节点
   * @param newRect 新的矩形
   * @param startRect 开始时的矩形
   */
  private static updateGroupChildrenByDOM(node: Node, newRect: Rect, startRect: Rect): void {
    const ratioWidth = newRect.width / startRect.width
    const ratioHeight = newRect.height / startRect.height

    requestAnimationFrame(() => {
      for (const child of node.getAllNodesInGroup()) {
        const childDom = child.getDashboardContainer()
        if (!childDom) continue

        const childRect = child.getDashboardRect()
        childDom.style.left = `${newRect.x + (childRect.x - startRect.x) * ratioWidth}px`
        childDom.style.top = `${newRect.y + (childRect.y - startRect.y) * ratioHeight}px`
        childDom.style.width = `${childRect.width * ratioWidth}px`
        childDom.style.height = `${childRect.height * ratioHeight}px`
      }
    })
  }
}
