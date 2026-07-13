import { type Clipboard, DESIGNER_EVENT, type Designer, type DesignerProps } from '@easy-editor/core/instance'
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
    const instanceClipboard = designer.editor.get<Clipboard>('clipboard')
    if (!instanceClipboard) {
      throw new Error('DesignerView requires an engine-owned clipboard service')
    }

    useEffect(() => {
      if (onMount) {
        onMount(designer)
      }

      const disposeCopyPaster = instanceClipboard.injectCopyPaster(document)
      try {
        designer.postEvent(DESIGNER_EVENT.MOUNT, designer)
      } catch (error) {
        disposeCopyPaster()
        throw error
      }

      return () => {
        try {
          disposeCopyPaster()
        } finally {
          designer.purge()
        }
      }
    }, [designer, instanceClipboard, onMount])

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
