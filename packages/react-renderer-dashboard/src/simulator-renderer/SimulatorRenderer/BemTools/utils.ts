import type { Node } from '@easy-editor/core'

/**
 * 计算节点的外围矩形 Rect，包括分支节点、多个节点计算
 * @param nodes 分组节点
 * @returns 外围矩形 {DOMRect}
 */
export const calculateDashboardRectBox = (nodes: Node[]) => {
  let [minX, minY, maxX, maxY] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]

  for (const node of nodes) {
    const rect = node.getDashboardRect()
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }

  return new DOMRect(minX, minY, maxX - minX, maxY - minY)
}
