import { type Project, Simulator, type SimulatorProps } from '@easy-editor/core'
import { classnames } from '@easy-editor/renderer-core'
import { observer } from 'mobx-react'
import { Component, useEffect, useRef } from 'react'
import { simulatorRenderer } from '..'
import { BemTools } from './BemTools'
import { useResizeObserver } from './hooks/useResizeObserver'
import './index.css'

/*
  Simulator         模拟器，可替换部件，有协议约束，包含画布的容器，使用场景：当 Canvas 大小变化时，用来居中处理 或 定位 Canvas
  Canvas            设备壳层，通过背景图片来模拟，通过设备预设样式改变宽度、高度及定位 CanvasViewport
  Canvas(Viewport)  页面编排场景中宽高不可溢出 Canvas 区
  Content           内容外层，宽高紧贴 CanvasViewport，禁用边框，禁用 margin
  BemTools          辅助显示层，初始相对 Content 位置 0,0，紧贴 Canvas, 根据 Content 滚动位置，改变相对位置
*/

const defaultDeviceStyle = {
  viewport: {
    width: 1920,
    height: 1080,
  },
}

interface SimulatorViewProps extends SimulatorProps {
  project: Project
  onMount?: (host: Simulator) => void
}

export class SimulatorView extends Component<SimulatorViewProps> {
  readonly host: Simulator

  constructor(props: SimulatorViewProps) {
    super(props)
    const { project, onMount, designer } = props
    this.host = (project.simulator as Simulator) || new Simulator(project, designer)
    this.host.setProps(props)
    onMount?.(this.host)
  }

  shouldComponentUpdate(nextProps: SimulatorViewProps) {
    this.host.setProps(nextProps)
    return false
  }

  render() {
    return (
      <div className='lc-simulator'>
        <Canvas host={this.host} />
      </div>
    )
  }
}

export const Canvas: React.FC<{ host: Simulator }> = observer(({ host }) => {
  const { viewport } = host
  const canvasRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const { canvas: canvasStyle = {}, viewport: viewportStyle } = host.deviceStyle || {}
  const { width: viewportWidth, height: viewportHeight } = (viewportStyle as any) || defaultDeviceStyle.viewport

  const viewportFrameStyle: any = {
    position: 'absolute',
    transformOrigin: '0px 0px',
    left: '50%',
    top: '50%',
    transform: `scale(${viewport.scale}) translate(-50%, -50%)`,
    width: viewportWidth,
    height: viewportHeight,
  }

  // 移除自动缩放逻辑，允许外部手动控制 viewport.scale
  // useResizeObserver({
  //   elem: canvasRef,
  //   onResize: entries => {
  //     const { width, height } = entries[0].contentRect
  //     const ww = width / viewportWidth
  //     const wh = height / viewportHeight
  //     viewport.scale = Math.min(ww, wh)
  //   },
  // })

  useEffect(() => {
    viewport.mount(viewportRef.current)
    simulatorRenderer.mount(host)
  }, [])

  return (
    <div
      ref={canvasRef}
      className={classnames('lc-simulator-canvas', `lc-simulator-device-${host.device}`, host.deviceClassName)}
      style={canvasStyle}
    >
      <div
        ref={viewportRef}
        className='lc-simulator-canvas-viewport'
        style={{ ...viewportStyle, ...viewportFrameStyle }}
      >
        <BemTools host={host} />
        <Content host={host} />
      </div>
    </div>
  )
})

export const Content: React.FC<{ host: Simulator }> = observer(({ host }) => {
  const { viewport } = host
  const frameRef = useRef<HTMLDivElement>(null)

  const frameStyle: React.CSSProperties = {
    // @ts-ignore
    // 用于 Content 更新
    width: viewport.contentWidth,
    height: viewport.contentHeight,
    // 覆盖
    // @ts-ignore
    width: '100%',
    // @ts-ignore
    height: '100%',
  }

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const rafId = requestAnimationFrame(() => {
      if (host.renderer) {
        host.mountContentFrame(frame)
      }
    })

    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [host.renderer, host])

  return (
    <div className='lc-simulator-content'>
      <div ref={frameRef} className='lc-simulator-content-frame' style={frameStyle} />
    </div>
  )
})
