import { type Simulator, getClosestNode } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { memo } from 'react'

interface BorderDetectingInstanceProps {
  title: string
  scale: number
  rect: DOMRect | null
  isLocked?: boolean
}

const BorderDetectingInstance: React.FC<BorderDetectingInstanceProps> = memo(({ title, scale, rect, isLocked }) => {
  if (!rect) {
    return null
  }

  const style = {
    width: rect.width,
    height: rect.height,
    // transformOrigin: '0 0',
    transform: `translate(${rect.left}px, ${rect.top}px)`,
  }

  return (
    <div className='lc-borders lc-borders-detecting' style={style}>
      {/* <Title title={title} className='lc-borders-title' />
      {isLocked ? <Title title={intl('locked')} className='lc-borders-status' /> : null} */}
    </div>
  )
})

interface BorderDetectingProps {
  host: Simulator
}

export const BorderDetecting: React.FC<BorderDetectingProps> = observer(({ host }) => {
  const curDoc = host.currentDocument
  const { selection } = host.designer
  const { current } = host.designer.detecting
  if (!current || current.document !== curDoc || selection.has(current.id) || current.id === curDoc.rootNode?.id) {
    return null
  }

  const canHoverHook = current?.componentMeta.advanced.callbacks?.onHoverHook
  const canHover = canHoverHook && typeof canHoverHook === 'function' ? canHoverHook(current) : true

  if (!canHover || !current) {
    return null
  }

  const rootNode = current.document.rootNode
  if (!rootNode!.contains(current)) {
    return null
  }

  const lockedNode = getClosestNode(current, n => {
    // 假如当前节点就是 locked 状态，要从当前节点的父节点开始查找
    return !n.isLocked
  })

  if (lockedNode && lockedNode.id !== current.id) {
    // 选中父节锁定的节点
    return (
      <BorderDetectingInstance
        title={current.title}
        scale={host.viewport.scale}
        rect={lockedNode.getDashboardRect()}
        isLocked={lockedNode.id !== current.id}
      />
    )
  }

  return <BorderDetectingInstance title={current.title} scale={host.viewport.scale} rect={current.getDashboardRect()} />
})
