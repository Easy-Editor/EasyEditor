import type { Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useEffect, useRef } from 'react'
import { simulatorRenderer } from '..'
import { BemTools } from './BemTools'
import { useResizeObserver } from './hooks/useResizeObserver'

import './css/theme.css'
import './index.css'

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
    <div className='lc-simulator'>
      {/* Canvas */}
      <div ref={canvasRef} className='lc-simulator-canvas lc-simulator-device-default-canvas' style={canvasStyle}>
        {/* viewport */}
        <div
          ref={viewportRef}
          className='lc-simulator-viewport lc-simulator-device-default-viewport'
          style={{
            ...viewportStyle,
            ...frameStyle,
          }}
        >
          {/* BemTools */}
          <BemTools host={host} />
          {/* Content */}
          <div
            ref={contentRef}
            className='lc-simulator-content'
            style={{
              // 临时样式
              backgroundColor: 'white',
            }}
          />
        </div>
      </div>
    </div>
  )
})
