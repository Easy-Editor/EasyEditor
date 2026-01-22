import type { Node, Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { BorderSelectingInstance } from './BorderSelectingInstance'

interface BorderSelectingForNodeProps {
  host: Simulator
  node: Node
}

/**
 * 节点选中边框组件
 */
export const BorderSelectingForNode: React.FC<BorderSelectingForNodeProps> = observer(({ host, node }) => {
  const { designer } = host
  const dragging = designer.dragon.dragging
  const instances = host.getComponentInstances(node)

  if (!instances || instances.length < 1) {
    return null
  }

  return (
    <>
      {instances.map((instance: any) => {
        const observed = designer.createOffsetObserver({
          node,
          instance,
        })
        if (!observed) {
          return null
        }

        return <BorderSelectingInstance key={observed.id} dragging={dragging} observed={observed} />
      })}
    </>
  )
})

BorderSelectingForNode.displayName = 'BorderSelectingForNode'
