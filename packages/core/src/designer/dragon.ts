import { action, observable, runInAction } from 'mobx'
import type { Designer } from '.'
import type { Node } from '../document'
import type { Simulator } from '../simulator'
import { isSimulator } from '../simulator'
import type { ComponentInstance, NodeSchema } from '../types'
import { createEventBus } from '../utils'
import type { LocateEvent } from './location'
import type { Sensor } from './sensor'

export enum DRAGON_EVENT {
  DRAGSTART = 'dragon:dragstart',
  DRAG = 'dragon:drag',
  DRAGEND = 'dragon:dragend',
}

export enum DragObjectType {
  Node = 'node',
  NodeData = 'nodedata',
}

export class DragObject {
  type: DragObjectType
  data?: NodeSchema | NodeSchema[] | undefined
  nodes?: (Node | null)[] | undefined
}

export interface DragAnyObject {
  type: string
  [key: string]: any
}

export interface DragNodeObject<T = Node> {
  type: DragObjectType.Node
  nodes: T[]
}

export interface DragNodeDataObject {
  type: DragObjectType.NodeData
  data: NodeSchema | NodeSchema[]
  thumbnail?: string
  description?: string
  [extra: string]: any
}

export interface NodeInstance<T = ComponentInstance, N = Node> {
  docId: string
  nodeId: string
  instance: T
  node?: N | null
}

export function isDragAnyObject(obj: any): obj is DragAnyObject {
  return obj && obj.type !== DragObjectType.NodeData && obj.type !== DragObjectType.Node
}

export const isDragNodeObject = (obj: any): obj is DragNodeObject => {
  return obj && obj.type === DragObjectType.Node
}

export const isDragNodeDataObject = (obj: any): obj is DragNodeDataObject => {
  return obj && obj.type === DragObjectType.NodeData
}

export const isLocateEvent = (e: any): e is LocateEvent => {
  return e && e.type === 'LocateEvent'
}

export const isDragEvent = (e: any): e is DragEvent => {
  return e?.type?.startsWith('drag')
}

export const isInvalidPoint = (e: any, last: any): boolean => {
  return (
    e.clientX === 0 &&
    e.clientY === 0 &&
    last &&
    (Math.abs(last.clientX - e.clientX) > 5 || Math.abs(last.clientY - e.clientY) > 5)
  )
}

export const isSameAs = (e1: MouseEvent | DragEvent, e2: MouseEvent | DragEvent): boolean => {
  return e1.clientY === e2.clientY && e1.clientX === e2.clientX
}

const SHAKE_DISTANCE = 4

/**
 * mouse shake check
 */
export const isShaken = (e1: MouseEvent | DragEvent, e2: MouseEvent | DragEvent): boolean => {
  if ((e1 as any).shaken) {
    return true
  }
  if (e1.target !== e2.target) {
    return true
  }
  return (e1.clientY - e2.clientY) ** 2 + (e1.clientX - e2.clientX) ** 2 > SHAKE_DISTANCE
}

export const setShaken = (e: any) => {
  e.shaken = true
}

export const getSourceSensor = (dragObject: DragObject): Simulator | null => {
  if (!isDragNodeObject(dragObject)) {
    return null
  }
  return dragObject.nodes[0]?.document?.simulator || null
}

export class Dragon {
  emitter = createEventBus('Dragon')

  private sensors: Sensor[] = []

  /** current active sensor */
  @observable.ref private accessor _activeSensor: Sensor | undefined

  get activeSensor() {
    return this._activeSensor
  }

  @observable.ref private accessor _dragging = false

  get dragging() {
    return this._dragging
  }

  constructor(readonly designer: Designer) {}

  /**
   * Quick listen a shell(container element) drag behavior
   * @param shell container element
   * @param boost boost got a drag object
   * @param eventType choose a event to trigger the dnd
   */
  from(
    shell: HTMLElement,
    boost: (e: MouseEvent | DragEvent) => DragObject | null,
    eventType: 'mouse' | 'drag' = 'drag',
  ) {
    const handleEvent = (e: MouseEvent | DragEvent) => {
      // ESC or RightClick
      if (e.which === 3 || e.button === 2) {
        return
      }

      // Get a new node to be dragged
      const dragObject = boost(e)
      if (!dragObject) {
        return
      }

      this.boost(dragObject, e, shell)
    }
    if (eventType === 'drag') {
      shell.draggable = true
      shell.addEventListener('dragstart', handleEvent as any)

      return () => {
        shell.draggable = false
        shell.removeEventListener('dragstart', handleEvent as any)
      }
    } else {
      shell.addEventListener('mousedown', handleEvent as any)

      return () => {
        shell.removeEventListener('mousedown', handleEvent as any)
      }
    }
  }

  /**
   * boost your dragObject for dragging(flying)
   * @param dragObject drag object
   * @param boostEvent drag start event
   * @param shell shell element(which trigger the boost)
   */
  @action
  boost(dragObject: DragObject, boostEvent: MouseEvent | DragEvent, shell?: HTMLElement) {
    const { designer } = this
    const masterSensors = this.getMasterSensors()
    const handleEvents = makeEventsHandler(boostEvent, masterSensors)
    const isNode = isDragNodeObject(dragObject)
    const isBoostFromDragAPI = isDragEvent(boostEvent)
    let lastSensor: Sensor | undefined

    this._dragging = false

    /**
     * When you press esc while dragging, it will stop dnd
     */
    const checkEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        designer.clearLocation()
        over()
      }
    }

    let lastArrive: any
    /** adjust event format  */
    const drag = (e: MouseEvent | DragEvent) => {
      if (isInvalidPoint(e, lastArrive)) return

      if (lastArrive && isSameAs(e, lastArrive)) {
        lastArrive = e
        return
      }
      lastArrive = e

      const locateEvent = createLocateEvent(e)
      const sensor = chooseSensor(locateEvent)

      if (sensor) {
        sensor.fixEvent(locateEvent)
        sensor.locate(locateEvent)
      } else {
        designer.clearLocation()
      }
      this.emitter.emit(DRAGON_EVENT.DRAG, locateEvent)
    }

    // drag start
    const dragstart = () => {
      runInAction(() => {
        this._dragging = true
      })
      setShaken(boostEvent)
      const locateEvent = createLocateEvent(boostEvent)
      if (isNode) {
        chooseSensor(locateEvent)
      }
      // ESC cancel drag
      if (!isBoostFromDragAPI) {
        handleEvents(doc => {
          doc.addEventListener('keydown', checkEsc, false)
        })
      }

      this.emitter.emit(DRAGON_EVENT.DRAGSTART, { ...locateEvent, shell })
    }

    // drag move
    const move = (e: MouseEvent | DragEvent) => {
      if (isBoostFromDragAPI) {
        e.preventDefault()
      }
      if (this._dragging) {
        // process dragging
        drag(e)
        return
      }

      // first move check is shaken
      if (isShaken(boostEvent, e)) {
        // is shaken dragstart
        dragstart()
        drag(e)
      }
    }

    let didDrop = true
    // drop
    const drop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      didDrop = true
    }

    // drag end
    const over = (e?: any) => {
      if (e && isDragEvent(e)) {
        e.preventDefault()
      }
      if (lastSensor) {
        lastSensor.deactiveSensor()
      }
      if (isBoostFromDragAPI) {
        if (!didDrop) {
          designer.clearLocation()
        }
      }

      let exception: unknown
      if (this._dragging) {
        runInAction(() => {
          this._dragging = false
        })
        try {
          // TODO: copy, escape
          this.emitter.emit(DRAGON_EVENT.DRAGEND, { dragObject, copy: false, esc: !e })
        } catch (ex) {
          exception = ex
        }
      }
      designer.clearLocation()

      handleEvents(doc => {
        if (isBoostFromDragAPI) {
          doc.removeEventListener('dragover', move, true)
          doc.removeEventListener('dragend', over, true)
          doc.removeEventListener('drop', drop, true)
        } else {
          doc.removeEventListener('mousemove', move, true)
          doc.removeEventListener('mouseup', over, true)
        }
        doc.removeEventListener('mousedown', over, true)
        doc.removeEventListener('keydown', checkEsc, false)
      })

      if (exception) {
        throw exception
      }
    }

    // create drag locate event
    const createLocateEvent = (e: MouseEvent | DragEvent): LocateEvent => {
      const evt: any = {
        type: 'LocateEvent',
        dragObject,
        target: e.target,
        originalEvent: e,
      }

      const sourceDocument = e.view?.document

      // event from current document
      if (!sourceDocument || sourceDocument === document) {
        evt.globalX = e.clientX
        evt.globalY = e.clientY
      } else {
        // event from simulator sandbox
        let srcSim: Simulator | undefined
        const lastSim = lastSensor && isSimulator(lastSensor) ? lastSensor : null
        // check source simulator
        if (lastSim && lastSim.contentDocument === sourceDocument) {
          srcSim = lastSim
        } else {
          srcSim = masterSensors.find(sim => sim.contentDocument === sourceDocument)
          if (!srcSim && lastSim) {
            srcSim = lastSim
          }
        }
        if (srcSim) {
          // transform point by simulator
          const g = srcSim.viewport.toGlobalPoint(e)
          evt.globalX = g.clientX
          evt.globalY = g.clientY
          evt.canvasX = e.clientX
          evt.canvasY = e.clientY
          evt.sensor = srcSim
        } else {
          // this condition will not happen, just make sure ts ok
          evt.globalX = e.clientX
          evt.globalY = e.clientY
        }
      }
      return evt
    }

    const sourceSensor = getSourceSensor(dragObject)

    const chooseSensor = (e: LocateEvent) => {
      // this.sensors will change on dragstart
      const sensors: Sensor[] = this.sensors.concat(masterSensors as Sensor[])
      // TODO: 这里需要优化，因为e.sensor可能为空
      let sensor = e.sensor && e.sensor.isEnter(e) ? e.sensor : sensors.find(s => s.sensorAvailable && s.isEnter(e))
      if (!sensor) {
        // TODO: enter some area like componentspanel cancel
        if (lastSensor) {
          sensor = lastSensor
        } else if (e.sensor) {
          sensor = e.sensor
        } else if (sourceSensor) {
          sensor = sourceSensor
        }
      }
      if (sensor !== lastSensor) {
        if (lastSensor) {
          lastSensor.deactiveSensor()
        }
        lastSensor = sensor
      }
      if (sensor) {
        e.sensor = sensor
        sensor.fixEvent(e)
      }
      runInAction(() => {
        this._activeSensor = sensor
      })
      return sensor
    }

    if (isDragEvent(boostEvent)) {
      const { dataTransfer } = boostEvent

      if (dataTransfer) {
        dataTransfer.effectAllowed = 'all'

        try {
          dataTransfer.setData('application/json', '{}')
        } catch (ex) {
          // ignore
        }
      }

      dragstart()
    }

    handleEvents(doc => {
      if (isBoostFromDragAPI) {
        doc.addEventListener('dragover', move, true)
        // dragexit
        didDrop = false
        doc.addEventListener('drop', drop, true)
        doc.addEventListener('dragend', over, true)
      } else {
        doc.addEventListener('mousemove', move, true)
        doc.addEventListener('mouseup', over, true)
      }
      doc.addEventListener('mousedown', over, true)
    })
  }

  /**
   * get master sensors(opened documents)
   */
  private getMasterSensors() {
    return Array.from(
      new Set(
        this.designer.project.documents
          .map(doc => {
            if (doc.opened && doc.simulator?.sensorAvailable) {
              return doc.simulator
            }
            return null
          })
          .filter(Boolean) as Simulator[],
      ),
    )
  }

  /**
   * get all simulators
   */
  private getSimulators() {
    return new Set(this.designer.project.documents.map(doc => doc.simulator))
  }

  /**
   * 添加投放感应区
   */
  @action
  addSensor(sensor: Sensor) {
    this.sensors.push(sensor)
  }

  /**
   * 移除投放感应
   */
  @action
  removeSensor(sensor: Sensor) {
    const i = this.sensors.indexOf(sensor)
    if (i > -1) {
      this.sensors.splice(i, 1)
    }
  }

  onDragstart(
    func: (
      e: LocateEvent & {
        /**
         * 触发拖拽的元素
         * @description 目前用于 Snippet
         */
        shell?: HTMLElement
      },
    ) => void,
  ) {
    this.emitter.on(DRAGON_EVENT.DRAGSTART, func)

    return () => {
      this.emitter.off(DRAGON_EVENT.DRAGSTART, func)
    }
  }

  onDrag(func: (e: LocateEvent) => void) {
    this.emitter.on(DRAGON_EVENT.DRAG, func)

    return () => {
      this.emitter.off(DRAGON_EVENT.DRAG, func)
    }
  }

  onDragend(func: (e: { dragObject: DragObject; copy?: boolean; esc?: boolean }) => void) {
    this.emitter.on(DRAGON_EVENT.DRAGEND, func)

    return () => {
      this.emitter.off(DRAGON_EVENT.DRAGEND, func)
    }
  }
}

export const makeEventsHandler = (boostEvent: MouseEvent | DragEvent, sensors: Simulator[]) => {
  const topDoc = window.document
  const sourceDoc = boostEvent.view?.document || topDoc

  const docs = new Set<globalThis.Document>()
  docs.add(topDoc)
  docs.add(sourceDoc)
  sensors.forEach(sim => {
    const sdoc = sim.contentDocument
    if (sdoc) {
      docs.add(sdoc)
    }
  })

  return (handle: (sdoc: globalThis.Document) => void) => {
    docs.forEach(doc => handle(doc))
  }
}
