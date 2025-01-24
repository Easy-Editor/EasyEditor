import type { Node } from '@easy-editor/core'

/**
 * 计算节点的外围矩形 Rect，包括分支节点、多个节点计算（根据 DashboardRect 计算）
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

/**
 * 计算节点的外围矩形 Rect，包括分支节点、多个节点计算（根据 DOM 计算）
 * @param nodes 分组节点
 * @returns 外围矩形 {DOMRect}
 */
export const calculateDOMRectBox = (nodes: Node[]) => {
  const simulator = nodes[0].document.simulator!
  const { viewport } = simulator
  let [minX, minY, maxX, maxY] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]

  for (const node of nodes) {
    const rect = simulator.computeRect(node)!
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }

  const local = viewport.toLocalPoint({ clientX: minX, clientY: minY })
  // 转换为 local 坐标信息
  return new DOMRect(local.clientX, local.clientY, (maxX - minX) / viewport.scale, (maxY - minY) / viewport.scale)
}
