import type { Document as IDocument, Node as INode } from '../document'
import { isDocumentNode } from '../utils'
import type { DragObject } from './dragon'
import type { Sensor } from './sensor'

export interface Point {
  clientX: number
  clientY: number
}

export interface CanvasPoint {
  canvasX: number
  canvasY: number
}

export type Rect = DOMRect & {
  elements?: Array<Element | Text>
  computed?: boolean
}

export type Rects = DOMRect[] & {
  elements: Array<Element | Text>
}

export enum LocationDetailType {
  Children = 'Children',
  Prop = 'Prop',
}

export interface LocationChildrenDetail {
  type: LocationDetailType.Children
  index?: number | null

  /** is valid location */
  valid?: boolean

  edge?: DOMRect
  near?: {
    node: INode
    pos: 'before' | 'after' | 'replace'
    rect?: Rect
    align?: 'V' | 'H'
  }
  focus?: { type: 'node'; node: INode }
}

export interface LocationPropDetail {
  type: LocationDetailType.Prop
  name: string
  domNode?: HTMLElement
}

export type LocationDetail = LocationChildrenDetail | LocationPropDetail | { [key: string]: any; type: string }

export interface LocationData<Node = INode> {
  target: Node
  detail: LocationDetail
  source: string
  event: LocateEvent
}

export interface LocateEvent {
  get type(): string

  /**
   * browser window coordinate system
   */
  readonly globalX: number
  readonly globalY: number

  readonly originalEvent: MouseEvent | DragEvent

  /**
   * browser event response target
   */
  target?: Element | null

  /**
   * event correction identifier, initially constructed from the initiating end, missing canvasX,canvasY, needs to be corrected
   */
  fixed?: true

  canvasX?: number
  canvasY?: number

  /**
   * active or target document
   */
  document?: Document | null

  get dragObject(): DragObject | null

  sensor?: Sensor
}

export const isLocationData = (obj: any): obj is LocationData => {
  return obj && obj.target && obj.detail
}

export const isLocationChildrenDetail = (obj: any): obj is LocationChildrenDetail => {
  return obj && obj.type === LocationDetailType.Children
}

export const getWindow = (elem: Element | Document): Window => {
  return (isDocumentNode(elem) ? elem : elem.ownerDocument!).defaultView!
}

export class DropLocation {
  readonly target: INode

  readonly detail: LocationDetail

  readonly event: LocateEvent

  readonly source: string

  get document(): IDocument | null {
    return this.target.document
  }

  constructor({ target, detail, source, event }: LocationData) {
    this.target = target
    this.detail = detail
    this.source = source
    this.event = event
  }

  clone(event: LocateEvent): DropLocation {
    return new DropLocation({
      target: this.target,
      detail: this.detail,
      source: this.source,
      event,
    })
  }
}
