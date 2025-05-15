import type { RendererProps } from '@easy-editor/renderer-core'
import { useRef } from 'react'
import LowCodeRenderer from '../renderer-core'
import { useResizeObserver } from '../simulator-renderer/SimulatorRenderer/hooks/useResizeObserver'

import './index.css'

interface PureRendererProps extends RendererProps {
  /**
   * 视图窗口设置
   */
  viewport?: {
    /**
     * 视图窗口宽度
     * @default 1920
     */
    width?: number

    /**
     * 视图窗口高度
     * @default 1080
     */
    height?: number
  }
}

const PureRenderer: React.FC<PureRendererProps> = props => {
  const { viewport, ...rendererProps } = props
  const { width: viewportWidth = 1920, height: viewportHeight = 1080 } = viewport || {}
  const canvasRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  useResizeObserver({
    elem: canvasRef,
    onResize: entries => {
      const { width, height } = entries[0].contentRect
      const ww = width / viewportWidth
      const wh = height / viewportHeight
      viewportRef.current!.style.transform = `scale(${Math.min(ww, wh)})  translate(-50%, -50%)`
    },
  })

  return (
    <div className='lc-editor'>
      <div ref={canvasRef} className='lc-editor-canvas'>
        <div
          ref={viewportRef}
          className='lc-editor-canvas-viewport'
          style={{
            width: viewportWidth,
            height: viewportHeight,
          }}
        >
          <div className='lc-editor-content'>
            <div className='lc-editor-content-frame'>
              <LowCodeRenderer {...(rendererProps as RendererProps)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PureRenderer
