import { type Designer, type Point, type Simulator, createEventBus, makeEventsHandler } from '@easy-editor/core'

export enum Direction {
  N = 'n',
  E = 'e',
  S = 's',
  W = 'w',
  NE = 'ne',
  NW = 'nw',
  SE = 'se',
  SW = 'sw',
}

// 拖动缩放
export default class DragResizeEngine {
  private emitter = createEventBus('DragResizeEngine')

  private dragResizing = false

  private designer: Designer

  constructor(designer: Designer) {
    this.designer = designer
  }

  isDragResizing() {
    return this.dragResizing
  }

  /**
   * drag reszie from
   * @param shell
   * @param direction n/s/e/w
   * @param boost (e: MouseEvent) => VE.Node
   */
  from(shell: HTMLElement, direction: Direction, boost: (e: MouseEvent) => any) {
    let node: any
    let startEvent: Point
    let scale = 1

    if (!shell) {
      return () => {}
    }

    const move = (e: MouseEvent) => {
      const x = createResizeEvent(e)
      // 将计算的坐标转换为画布内缩放后的坐标
      const moveX = (x.clientX - startEvent.clientX) / scale
      const moveY = (x.clientY - startEvent.clientY) / scale

      this.emitter.emit('resize', { e, direction, node, moveX, moveY })
    }

    const masterSensors = this.getMasterSensors()

    const createResizeEvent = (e: MouseEvent | DragEvent): Point => {
      const sourceDocument = e.view?.document
      const srcSim = masterSensors.find(sim => sim.contentDocument === sourceDocument)
      scale = srcSim?.viewport.scale || 1

      if (!sourceDocument || sourceDocument === document) {
        return e
      }
      if (srcSim) {
        return srcSim.viewport.toGlobalPoint(e)
      }
      return e
    }

    const over = (e: MouseEvent) => {
      const handleEvents = makeEventsHandler(e, masterSensors)
      handleEvents(doc => {
        doc.removeEventListener('mousemove', move, true)
        doc.removeEventListener('mouseup', over, true)
      })

      this.dragResizing = false
      this.designer.detecting.enable = true
      // cursor.release()

      this.emitter.emit('resizeEnd', { e, direction, node })
    }

    const mousedown = (e: MouseEvent) => {
      // 阻止浏览器拖拽的默认行为，存在冲突
      e.preventDefault()

      node = boost(e)
      startEvent = createResizeEvent(e)
      const handleEvents = makeEventsHandler(e, masterSensors)
      handleEvents(doc => {
        doc.addEventListener('mousemove', move, true)
        doc.addEventListener('mouseup', over, true)
      })

      this.emitter.emit('resizeStart', { e, direction, node })
      this.dragResizing = true
      this.designer.detecting.enable = false
      // cursor.addState('ew-resize')
    }
    shell.addEventListener('mousedown', mousedown)
    return () => {
      shell.removeEventListener('mousedown', mousedown)
    }
  }

  onResizeStart(func: (evt: { e: MouseEvent; direction: Direction; node: any }) => any) {
    this.emitter.on('resizeStart', func)
    return () => {
      this.emitter.off('resizeStart', func)
    }
  }

  onResize(func: (evt: { e: MouseEvent; direction: Direction; node: any; moveX: number; moveY: number }) => any) {
    this.emitter.on('resize', func)
    return () => {
      this.emitter.off('resize', func)
    }
  }

  onResizeEnd(func: (evt: { e: MouseEvent; direction: Direction; node: any }) => any) {
    this.emitter.on('resizeEnd', func)
    return () => {
      this.emitter.off('resizeEnd', func)
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
      .filter(Boolean) as any
  }
}
