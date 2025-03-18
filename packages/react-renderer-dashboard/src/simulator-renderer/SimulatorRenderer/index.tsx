import type { Simulator } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { simulatorRenderer } from '..'
import { BemTools } from './BemTools'
import { useResizeObserver } from './hooks/useResizeObserver'

import './css/theme.css'
import './index.css'

const defaultDeviceStyle = {
  viewport: {
    width: 1920,
    height: 1080,
  },
}

export interface SimulatorRendererProps {
  // editor: Editor
  host: Simulator

  /**
   * 是否显示 BemTools
   * @default true
   */
  bemTools?:
    | boolean
    | {
        /**
         * hover组件功能
         * @default true
         */
        detecting?: boolean

        /**
         * 缩放组件功能
         * @default true
         */
        resizing?: boolean

        /**
         * 选中组件功能
         * @default true
         */
        selecting?: boolean

        /**
         * 显示参考线
         * @default true
         */
        guideLine?: boolean

        /**
         * 额外内容
         */
        extra?: ReactNode
      }
}

export const SimulatorRenderer = observer(({ host, bemTools }: SimulatorRendererProps) => {
  const { viewport } = host
  const canvasRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const { canvas: canvasStyle = {}, viewport: viewportStyle = {}, content: contentStyle = {} } = host.deviceStyle || {}
  const { width: viewportWidth, height: viewportHeight } = (viewportStyle as any) || defaultDeviceStyle.viewport

  const frameStyle: any = {
    position: 'absolute',
    transformOrigin: '0px 0px',
    left: '50%',
    top: '50%',
    transform: `scale(${viewport.scale})  translate(-50%, -50%)`,
    width: viewportWidth,
    height: viewportHeight,
  }

  useResizeObserver({
    elem: canvasRef,
    onResize: entries => {
      const { width, height } = entries[0].contentRect
      const ww = width / viewportWidth
      const wh = height / viewportHeight
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
    <div className='easy-editor'>
      {/* Canvas */}
      <div ref={canvasRef} className='easy-editor-canvas easy-editor-device-default-canvas' style={canvasStyle}>
        {/* viewport */}
        <div
          ref={viewportRef}
          className='easy-editor-viewport easy-editor-device-default-viewport'
          style={{
            ...frameStyle,
            ...viewportStyle,
          }}
        >
          {/* BemTools */}
          <BemTools host={host} bemTools={bemTools} />
          {/* Content */}
          <div ref={contentRef} className='easy-editor-content' style={contentStyle} />
        </div>
      </div>
    </div>
  )
})
