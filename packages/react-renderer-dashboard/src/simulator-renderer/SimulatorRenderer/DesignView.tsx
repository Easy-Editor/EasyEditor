import { DESIGNER_EVENT, type Designer, type DesignerProps, clipboard } from '@easy-editor/core'
import { classnames } from '@easy-editor/renderer-core'
import { memo, useEffect, useState } from 'react'
import { ProjectView } from './ProjectView'

interface DesignerViewProps extends Omit<DesignerProps, 'editor'> {
  designer: Designer
  className?: string
  style?: React.CSSProperties

  [key: string]: any
}

export const DesignerView: React.FC<DesignerViewProps> = memo(
  props => {
    const { designer: propsDesigner, className, style, onMount, ...designerProps } = props

    const [designer] = useState(() => {
      propsDesigner.setProps(designerProps)
      return propsDesigner
    })

    useEffect(() => {
      if (onMount) {
        onMount(designer)
      }

      clipboard.injectCopyPaster(document)
      designer.postEvent(DESIGNER_EVENT.MOUNT, designer)

      return () => {
        designer.purge()
      }
    }, [])

    return (
      <div className={classnames('lc-designer', className)} style={style}>
        <ProjectView designer={designer} />
      </div>
    )
  },
  (prevProps, nextProps) => {
    nextProps.designer.setProps(nextProps)

    if (nextProps.className !== prevProps.className || nextProps.style !== prevProps.style) {
      return true
    }
    return false
  },
)
