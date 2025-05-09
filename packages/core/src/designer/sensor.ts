import type { Node } from '../document'
import type { ComponentInstance } from '../types'
import type { NodeInstance } from './dragon'
import type { DropLocation, LocateEvent } from './location'

export interface Sensor<T = Node> {
  /**
   * whether the sensor is available
   */
  readonly sensorAvailable: boolean

  /**
   * fix location event, add canvasX,canvasY
   */
  fixEvent(e: LocateEvent): LocateEvent

  /**
   * locate and activate
   */
  locate(e: LocateEvent): DropLocation | undefined | null

  /**
   * whether enter the sensitive area
   */
  isEnter(e: LocateEvent): boolean

  /**
   * deactivate
   */
  deactiveSensor(): void

  /**
   * get node instance from element
   */
  getNodeInstanceFromElement?: (e: Element | null) => NodeInstance<ComponentInstance, T> | null
}
