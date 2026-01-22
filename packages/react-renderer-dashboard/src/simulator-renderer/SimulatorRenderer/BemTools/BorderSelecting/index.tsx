import type { Node, Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { BorderSelectingForBox } from './BorderSelectingForBox'
import { BorderSelectingForNode } from './BorderSelectingForNode'

interface BorderSelectingProps {
  host: Simulator
}

/**
 * 选中边框入口组件
 */
export const BorderSelecting: React.FC<BorderSelectingProps> = observer(({ host }) => {
  const { selection } = host.designer
  const dragging = host.designer.dragon.dragging
  let selecting = dragging ? selection.getTopNodes() : selection.getNodes()
  selecting = selecting.filter((node: Node) => !node.isRoot)

  if (!selecting || selecting.length === 0) {
    return null
  }

  if (selecting.length > 1) {
    return <BorderSelectingForBox nodes={selecting} dragging={dragging} />
  }

  return (
    <>
      {selecting.map(node => (
        <BorderSelectingForNode key={node.id} host={host} node={node} />
      ))}
    </>
  )
})

BorderSelecting.displayName = 'BorderSelecting'
