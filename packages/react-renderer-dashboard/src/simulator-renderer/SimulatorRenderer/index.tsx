import type { Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useEffect, useRef } from 'react'
import { simulatorRenderer } from '..'
import { useResizeObserver } from './hooks/useResizeObserver'

import { BemTools } from './BemTools'
import './css/theme.css'

interface SimulatorRendererProps {
  // editor: Editor
  host: Simulator
}

export const SimulatorRenderer = observer(({ host }: SimulatorRendererProps) => {
  const { viewport } = host
  const canvasRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const { canvas: canvasStyle = {}, viewport: viewportStyle = {} } = host.deviceStyle || {}
  const frameStyle: any = {
    position: 'absolute',
    transformOrigin: '0px 0px',
    left: '50%',
    top: '50%',
    transform: `scale(${viewport.scale})  translate(-50%, -50%)`,
    width: '1920px',
    height: '1080px',
    // height: viewport.contentHeight,
    // width: viewport.contentWidth,
  }

  useResizeObserver({
    elem: canvasRef,
    onResize: entries => {
      const { width, height } = entries[0].contentRect
      const ww = width / 1920
      const wh = height / 1080
      viewport.scale = Math.min(ww, wh)
    },
  })

  useEffect(() => {
    viewport.mount(viewportRef.current)
    simulatorRenderer.mount(host)
    host.mountContentFrame(contentRef.current)
  }, [])

  return (
    // Simulator
    <div style={{ position: 'relative', height: '100%', width: '100%', overflow: 'auto' }}>
      {/* Canvas */}
      <div
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '100%', overflow: 'hidden', ...canvasStyle }}
      >
        {/* viewport */}
        <div
          ref={viewportRef}
          // style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '100%', ...viewportStyle }}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: '100%',
            ...frameStyle,
          }}
        >
          {/* BemTools */}
          <BemTools host={host} />
          {/* Content */}
          <div
            ref={contentRef}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: '100%',
              overflow: 'hidden',
              // ...frameStyle,
              // 临时样式
              backgroundColor: 'white',
            }}
          />
        </div>
      </div>
    </div>
  )
})
