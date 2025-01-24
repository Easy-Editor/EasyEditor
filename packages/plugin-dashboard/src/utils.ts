import type { Node } from '@easy-editor/core'

/**
 * 更新节点在 dashboard 中的位置
 * @param node 节点
 * @param offset 节点相对于画布的偏移量
 * @param groupOffset 节点相对于其父组节点的偏移量
 */
export const updateNodeRect = (node: Node, offset = { x: 0, y: 0 }) => {
  if (node.isGroup) {
    const nodeRect = node.getDashboardRect()
    const delta = {
      x: offset.x - nodeRect.x,
      y: offset.y - nodeRect.y,
    }

    for (const childNode of node.getAllNodesInGroup()) {
      const childRect = childNode.getDashboardRect()
      childNode.updateDashboardRect({
        x: childRect.x + delta.x,
        y: childRect.y + delta.y,
      })
    }
  } else {
    node.updateDashboardRect({
      x: offset.x,
      y: offset.y,
    })
  }
}

/**
 * 更新节点 DOM 在 dashboard 中的位置
 * @param node 节点
 * @param offset 节点相对于画布的偏移量
 * @param groupOffset 节点相对于其父组节点的偏移量
 */
export const updateNodeRectByDOM = (node: Node, offset = { x: 0, y: 0 }) => {
  const domNode = node.getDashboardContainer()
  if (!domNode) {
    return
  }

  domNode.style.left = `${offset.x}px`
  domNode.style.top = `${offset.y}px`
}
