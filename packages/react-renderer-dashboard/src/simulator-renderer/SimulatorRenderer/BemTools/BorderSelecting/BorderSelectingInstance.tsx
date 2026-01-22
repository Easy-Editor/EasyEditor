import type { OffsetObserver } from '@easy-editor/core'
import { observer } from 'mobx-react'

interface BorderSelectingInstanceProps {
  observed: OffsetObserver
  highlight?: boolean
  dragging?: boolean
}

/**
 * 选中边框实例组件
 */
export const BorderSelectingInstance: React.FC<BorderSelectingInstanceProps> = observer(
  ({ observed, highlight, dragging }) => {
    if (!observed.hasOffset) {
      return null
    }

    const { offsetWidth, offsetHeight, offsetTop, offsetLeft } = observed
    const style = {
      width: offsetWidth,
      height: offsetHeight,
      transform: `translate3d(${offsetLeft}px, ${offsetTop}px, 0)`,
    }

    let classname = 'lc-borders lc-borders-selecting'
    if (dragging) {
      classname += ' dragging'
    }

    return <div className={classname} style={style} />
  },
)

BorderSelectingInstance.displayName = 'BorderSelectingInstance'
