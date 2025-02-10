import type { Designer, Node, OffsetObserver, Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useEffect, useRef } from 'react'
import DragResizeEngine from './drag-resize-engine'

interface BorderResizingInstanceProps {
  observed: OffsetObserver
  highlight?: boolean
  dragging?: boolean
  designer: Designer
}

// const BorderResizingInstance: React.FC<BorderResizingInstanceProps> = observer(
//   ({ observed, highlight, dragging, designer }) => {
//     const dragEngine = useRef<DragResizeEngine>(new DragResizeEngine(designer))

//     useEffect(() => {
//       const resize = (e: MouseEvent, direction: string, node: Node, moveX: number, moveY: number) => {
//         const { advanced } = node.componentMeta
//         if (advanced.callbacks && typeof advanced.callbacks.onResize === 'function') {
//           ;(e as any).trigger = direction
//           ;(e as any).deltaX = moveX
//           ;(e as any).deltaY = moveY
//           advanced.callbacks.onResize(e, node)
//         }
//       }

//       const resizeStart = (e: MouseEvent, direction: string, node: Node) => {
//         const { advanced } = node.componentMeta
//         if (advanced.callbacks && typeof advanced.callbacks.onResizeStart === 'function') {
//           ;(e as any).trigger = direction
//           advanced.callbacks.onResizeStart(e, node)
//         }
//       }

//       const resizeEnd = (e: MouseEvent, direction: string, node: Node) => {
//         const { advanced } = node.componentMeta
//         if (advanced.callbacks && typeof advanced.callbacks.onResizeEnd === 'function') {
//           ;(e as any).trigger = direction
//           advanced.callbacks.onResizeEnd(e, node)
//         }

//         const editor = node.document?.designer.editor
//         const selected = node?.componentMeta?.componentName || ''
//         editor?.eventBus.emit('designer.border.resize', {
//           selected,
//           layout: node?.parent?.getPropValue('layout') || '',
//         })
//       }

//       dragEngine.current.onResize(resize)
//       dragEngine.current.onResizeStart(resizeStart)
//       dragEngine.current.onResizeEnd(resizeEnd)
//     })

//     if (!observed.hasOffset) {
//       return null
//     }

//     const { offsetWidth, offsetHeight, offsetTop, offsetLeft } = observed
//     const style = {
//       width: offsetWidth,
//       height: offsetHeight,
//       transform: `translate3d(${offsetLeft}px, ${offsetTop}px, 0)`,
//     }
//     let classname = 'lc-borders lc-borders-selecting'
//     if (dragging) {
//       classname += ' dragging'
//     }

//     return (
//       <div className={classname} style={style}>
//         {/* <Title title={title} className='lc-borders-title' />
//       {isLocked ? <Title title={intl('locked')} className='lc-borders-status' /> : null} */}
//       </div>
//     )
//   },
// )

export const BorderResizingInstance: React.FC<BorderResizingInstanceProps> = observer(
  ({ observed, dragging, designer }) => {
    const dragEngine = useRef<DragResizeEngine>(new DragResizeEngine(designer))
    const outlineRefs = useRef<{
      outlineN: HTMLDivElement | null
      outlineE: HTMLDivElement | null
      outlineS: HTMLDivElement | null
      outlineW: HTMLDivElement | null
      outlineNE: HTMLDivElement | null
      outlineNW: HTMLDivElement | null
      outlineSE: HTMLDivElement | null
      outlineSW: HTMLDivElement | null
    }>({
      outlineN: null,
      outlineE: null,
      outlineS: null,
      outlineW: null,
      outlineNE: null,
      outlineNW: null,
      outlineSE: null,
      outlineSW: null,
    })

    useEffect(() => {
      const resize = ({
        e,
        direction,
        node,
        moveX,
        moveY,
      }: { e: MouseEvent; direction: string; node: Node; moveX: number; moveY: number }) => {
        const { advanced } = node.componentMeta
        if (advanced.callbacks && typeof advanced.callbacks.onResize === 'function') {
          ;(e as any).trigger = direction
          ;(e as any).deltaX = moveX
          ;(e as any).deltaY = moveY
          advanced.callbacks.onResize({ ...e, trigger: direction, deltaX: moveX, deltaY: moveY }, node)
        }
      }

      const resizeStart = ({ e, direction, node }: { e: MouseEvent; direction: string; node: Node }) => {
        const { advanced } = node.componentMeta
        if (advanced.callbacks && typeof advanced.callbacks.onResizeStart === 'function') {
          ;(e as any).trigger = direction
          advanced.callbacks.onResizeStart({ ...e, trigger: direction }, node)
        }
      }

      const resizeEnd = ({ e, direction, node }: { e: MouseEvent; direction: string; node: Node }) => {
        const { advanced } = node.componentMeta
        if (advanced.callbacks && typeof advanced.callbacks.onResizeEnd === 'function') {
          ;(e as any).trigger = direction
          advanced.callbacks.onResizeEnd({ ...e, trigger: direction }, node)
        }

        const editor = node.document?.designer.editor
        const selected = node?.componentMeta?.componentName || ''
        editor?.eventBus.emit('designer.border.resize', {
          selected,
          layout: node?.parent?.getPropValue('layout') || '',
        })
      }

      dragEngine.current.onResize(resize)
      dragEngine.current.onResizeStart(resizeStart)
      dragEngine.current.onResizeEnd(resizeEnd)

      return () => {
        observed.purge()
      }
    }, [observed, designer])

    if (!observed.hasOffset) {
      return null
    }

    const { offsetWidth, offsetHeight, offsetTop, offsetLeft } = observed
    let triggerVisible: any = ['N', 'E', 'S', 'W', 'NE', 'NW', 'SE', 'SW']
    triggerVisible = triggerVisible.map((trigger: string) => trigger?.toUpperCase())

    const baseSideClass = 'lc-borders lc-resize-side'
    const baseCornerClass = 'lc-borders lc-resize-corner'

    return (
      <div>
        <div
          ref={ref => {
            outlineRefs.current.outlineN = ref
          }}
          className={`${baseSideClass} n`}
          style={{
            height: 20,
            transform: `translate(${offsetLeft}px, ${offsetTop - 10}px)`,
            width: offsetWidth,
            display: triggerVisible.includes('N') ? 'flex' : 'none',
          }}
        />
        <div
          ref={ref => {
            outlineRefs.current.outlineNE = ref
          }}
          className={`${baseCornerClass} ne`}
          style={{
            transform: `translate(${offsetLeft + offsetWidth - 5}px, ${offsetTop - 3}px)`,
            cursor: 'nesw-resize',
            display: triggerVisible.includes('NE') ? 'flex' : 'none',
          }}
        />
        <div
          className={`${baseSideClass} e`}
          ref={ref => {
            outlineRefs.current.outlineE = ref
          }}
          style={{
            height: offsetHeight,
            transform: `translate(${offsetLeft + offsetWidth - 10}px, ${offsetTop}px)`,
            width: 20,
            display: triggerVisible.includes('E') ? 'flex' : 'none',
          }}
        />
        <div
          ref={ref => {
            outlineRefs.current.outlineSE = ref
          }}
          className={`${baseCornerClass} se`}
          style={{
            transform: `translate(${offsetLeft + offsetWidth - 5}px, ${offsetTop + offsetHeight - 5}px)`,
            cursor: 'nwse-resize',
            display: triggerVisible.includes('SE') ? 'flex' : 'none',
          }}
        />
        <div
          ref={ref => {
            outlineRefs.current.outlineS = ref
          }}
          className={`${baseSideClass} s`}
          style={{
            height: 20,
            transform: `translate(${offsetLeft}px, ${offsetTop + offsetHeight - 10}px)`,
            width: offsetWidth,
            display: triggerVisible.includes('S') ? 'flex' : 'none',
          }}
        />
        <div
          ref={ref => {
            outlineRefs.current.outlineSW = ref
          }}
          className={`${baseCornerClass} sw`}
          style={{
            transform: `translate(${offsetLeft - 3}px, ${offsetTop + offsetHeight - 5}px)`,
            cursor: 'nesw-resize',
            display: triggerVisible.includes('SW') ? 'flex' : 'none',
          }}
        />
        <div
          ref={ref => {
            outlineRefs.current.outlineW = ref
          }}
          className={`${baseSideClass} w`}
          style={{
            height: offsetHeight,
            transform: `translate(${offsetLeft - 10}px, ${offsetTop}px)`,
            width: 20,
            display: triggerVisible.includes('W') ? 'flex' : 'none',
          }}
        />
        <div
          ref={ref => {
            outlineRefs.current.outlineNW = ref
          }}
          className={`${baseCornerClass} nw`}
          style={{
            transform: `translate(${offsetLeft - 3}px, ${offsetTop - 3}px)`,
            cursor: 'nwse-resize',
            display: triggerVisible.includes('NW') ? 'flex' : 'none',
          }}
        />
      </div>
    )
  },
)

interface BorderResizingForNodeProps {
  host: Simulator
  node: Node
}

const BorderResizingForNode: React.FC<BorderResizingForNodeProps> = observer(({ host, node }) => {
  const { designer } = host
  const dragging = designer.dragon.dragging
  const instances = host.getComponentInstances(node)

  if (!instances || instances.length < 1 || dragging) {
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

        return <BorderResizingInstance key={observed.id} dragging={dragging} observed={observed} designer={designer} />
      })}
    </>
  )
})

interface BorderResizingProps {
  host: Simulator
}

export const BorderResizing: React.FC<BorderResizingProps> = observer(({ host }) => {
  const { selection } = host.designer
  const dragging = host.designer.dragon.dragging
  const selecting = dragging ? selection.getTopNodes() : selection.getNodes()

  if (!selecting || selecting.length < 1) {
    return null
  }

  return (
    <>
      {selecting.map(node => (
        <BorderResizingForNode key={node.id} host={host} node={node} />
      ))}
    </>
  )
})
