import { type Designer, type Simulator, type Viewport, createEventBus, makeEventsHandler } from '@easy-editor/core'

export interface MarqueeRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MarqueeEvent {
  startX: number
  startY: number
  currentX: number
  currentY: number
  rect: MarqueeRect
  isCtrlPressed: boolean
}

/**
 * 框选引擎
 * 用于在画布空白区域拖拽框选多个组件
 */
export class MarqueeSelection {
  private emitter = createEventBus('MarqueeEngine')

  private isMarqueeSelecting = false

  enabled = true

  constructor(readonly designer: Designer) {}

  isSelecting() {
    return this.isMarqueeSelecting
  }

  /**
   * 绑定框选事件到指定元素
   * @param shell 画布容器元素
   * @param viewport 视口对象，用于坐标转换
   * @param isClickOnNode 检测点击是否在节点上的函数
   */
  from(shell: HTMLElement, viewport: Viewport, isClickOnNode: (target: Element) => boolean) {
    if (!shell) {
      return () => {}
    }

    let startX = 0
    let startY = 0
    let isCtrlPressed = false

    const masterSensors = this.getMasterSensors()

    const calculateRect = (x1: number, y1: number, x2: number, y2: number): MarqueeRect => {
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      }
    }

    const move = (e: MouseEvent) => {
      const localPoint = viewport.toLocalPoint(e)
      const currentX = localPoint.clientX
      const currentY = localPoint.clientY

      const marqueeRect = calculateRect(startX, startY, currentX, currentY)

      this.emitter.emit('marquee', {
        startX,
        startY,
        currentX,
        currentY,
        rect: marqueeRect,
        isCtrlPressed: e.ctrlKey || e.metaKey,
      } as MarqueeEvent)
    }

    const over = (e: MouseEvent) => {
      const handleEvents = makeEventsHandler(e, masterSensors)
      handleEvents(doc => {
        doc.removeEventListener('mousemove', move, true)
        doc.removeEventListener('mouseup', over, true)
      })

      const localPoint = viewport.toLocalPoint(e)
      const currentX = localPoint.clientX
      const currentY = localPoint.clientY

      const marqueeRect = calculateRect(startX, startY, currentX, currentY)

      this.isMarqueeSelecting = false
      this.designer.detecting.enable = true

      this.emitter.emit('marqueeEnd', {
        startX,
        startY,
        currentX,
        currentY,
        rect: marqueeRect,
        isCtrlPressed: e.ctrlKey || e.metaKey,
      } as MarqueeEvent)
    }

    const mousedown = (e: MouseEvent) => {
      // 只响应左键
      if (e.button !== 0) return

      if (!this.enabled) {
        return
      }

      // 检查是否点击在组件上
      const target = e.target as Element
      if (isClickOnNode(target)) {
        return
      }

      e.preventDefault()

      const localPoint = viewport.toLocalPoint(e)
      startX = localPoint.clientX
      startY = localPoint.clientY
      isCtrlPressed = e.ctrlKey || e.metaKey

      const handleEvents = makeEventsHandler(e, masterSensors)
      handleEvents(doc => {
        doc.addEventListener('mousemove', move, true)
        doc.addEventListener('mouseup', over, true)
      })

      this.emitter.emit('marqueeStart', {
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        rect: { x: startX, y: startY, width: 0, height: 0 },
        isCtrlPressed,
      } as MarqueeEvent)

      this.isMarqueeSelecting = true
      this.designer.detecting.enable = false
    }

    shell.addEventListener('mousedown', mousedown)

    return () => {
      shell.removeEventListener('mousedown', mousedown)
    }
  }

  onMarqueeStart(func: (evt: MarqueeEvent) => void) {
    this.emitter.on('marqueeStart', func)
    return () => {
      this.emitter.off('marqueeStart', func)
    }
  }

  onMarquee(func: (evt: MarqueeEvent) => void) {
    this.emitter.on('marquee', func)
    return () => {
      this.emitter.off('marquee', func)
    }
  }

  onMarqueeEnd(func: (evt: MarqueeEvent) => void) {
    this.emitter.on('marqueeEnd', func)
    return () => {
      this.emitter.off('marqueeEnd', func)
    }
  }

  private getMasterSensors(): Simulator[] {
    return this.designer.project.documents
      .map(doc => {
        if (doc.opened && doc.simulator?.sensorAvailable) {
          return doc.simulator
        }
        return null
      })
      .filter(Boolean) as Simulator[]
  }
}
