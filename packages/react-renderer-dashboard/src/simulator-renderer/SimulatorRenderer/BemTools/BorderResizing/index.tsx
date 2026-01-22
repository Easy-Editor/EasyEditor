import type { Node, Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { BorderResizingBox } from './BorderResizingBox'
import { BorderResizingInstance } from './BorderResizingInstance'

interface BorderResizingProps {
  host: Simulator
}

/**
 * 缩放边框入口组件
 * 根据选中节点数量选择单节点或多节点缩放
 */
export const BorderResizing: React.FC<BorderResizingProps> = observer(({ host }) => {
  const { selection } = host.designer
  const dragging = host.designer.dragon.dragging
  const nodes = selection.getNodes().filter((node: Node) => !node.isRoot)

  if (nodes.length === 0 || dragging) {
    return null
  }

  if (nodes.length === 1) {
    return <BorderResizingInstance host={host} node={nodes[0]} />
  }

  return <BorderResizingBox host={host} nodes={nodes} />
})

BorderResizing.displayName = 'BorderResizing'
