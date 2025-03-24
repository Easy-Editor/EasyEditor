import type { RendererProps } from '@easy-editor/react-renderer'
import { useRef } from 'react'
import { LowCodeRenderer } from '../renderer-core/renderer'
import { useResizeObserver } from '../simulator-renderer/SimulatorRenderer/hooks/useResizeObserver'
import { RouteRenderer, type RouteRendererProps } from './RouteRenderer'

// interface PureRendererProps extends RendererProps, RouteRendererProps {
//   /**
//    * 视图窗口设置
//    */
//   viewport?: {
//     /**
//      * 视图窗口宽度
//      * @default 1920
//      */
//     width?: number

//     /**
//      * 视图窗口高度
//      * @default 1080
//      */
//     height?: number
//   }
// }

type PureRendererProps = (
  | ({
      /**
       * 是否开启路由模式
       * @default true
       */
      routeMode: true
    } & RouteRendererProps)
  | ({
      /**
       * 是否开启路由模式
       * @default true
       */
      routeMode: false
    } & RendererProps)
) & {
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
  const { viewport, routeMode = true, ...rendererProps } = props
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
    <div className='easy-editor'>
      {/* Canvas */}
      <div ref={canvasRef} className='easy-editor-canvas'>
        {/* viewport */}
        <div
          ref={viewportRef}
          className='easy-editor-viewport'
          style={{
            width: viewportWidth,
            height: viewportHeight,
          }}
        >
          {/* Content */}
          <div className='easy-editor-content'>
            {/* Renderer */}
            {routeMode ? (
              <RouteRenderer {...(rendererProps as RouteRendererProps)} />
            ) : (
              <LowCodeRenderer {...(rendererProps as RendererProps)} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PureRenderer
