import { Project, type ProjectSchema } from '../project'

import { type Node, type PropsSchema, insertChildren, isNodeSchema } from '../document'
import type { Editor } from '../editor'
import type { ComponentMetaManager } from '../meta'
import type { TRANSFORM_STAGE } from '../types'
import { createEventBus, logger } from '../utils'
import { Detecting } from './detecting'
import { type DragObject, Dragon, isDragNodeDataObject, isDragNodeObject } from './dragon'
import type { LocateEvent, LocationData } from './location'
import { DropLocation, isLocationChildrenDetail } from './location'
import { Selection } from './selection'

export type PropsTransducer = (
  props: PropsSchema,
  node: Node,
  ctx?: {
    stage: TRANSFORM_STAGE
  },
) => PropsSchema

export interface DesignerProps {
  editor: Editor
  defaultSchema?: ProjectSchema

  // TODO
  hotkeys?: object

  onMount?: (designer: Designer) => void
  onDragstart?: (e: LocateEvent) => void
  onDrag?: (e: LocateEvent) => void
  onDragend?: (e: { dragObject: DragObject; copy: boolean }, loc?: DropLocation) => void

  [key: string]: any
}

export enum DESIGNER_EVENT {
  INIT = 'designer:init',

  DRAG_START = 'designer:dragstart',
  DRAG = 'designer:drag',
  DRAG_END = 'designer:dragend',
  DROP_LOCATION_CHANGE = 'designer:dropLocation.change',

  // TODO: 名称有点问题，因为这个暂时只是触发从物料拖拽出来了 nodedata 生效
  INSERT_NODE_BEFORE = 'designer:node.insert.before',
  INSERT_NODE_AFTER = 'designer:node.insert.after',

  CURRENT_DOCUMENT_CHANGE = 'designer:current-document.change',
  CURRENT_HISTORY_CHANGE = 'designer:current-history.change',

  DOCUMENT_DROP_LOCATION_CHANGE = 'designer:document.dropLocation.change',

  NODE_VISIBLE_CHANGE = 'designer:node.visible.change',
  NODE_CHILDREN_CHANGE = 'designer:node.children.change',
  NODE_PROPS_CHANGE = 'designer:node.props.change',
  NODE_REMOVE = 'designer:node.remove',

  SIMULATOR_SELECT = 'designer:simulator.select',
}

export class Designer {
  private emitter = createEventBus('Designer')

  readonly editor: Editor

  readonly dragon: Dragon

  readonly detecting: Detecting

  readonly project: Project

  readonly selection: Selection

  private _dropLocation?: DropLocation

  get componentMetaManager() {
    return this.editor.get('componentMetaManager') as ComponentMetaManager
  }

  private props?: DesignerProps

  private propsReducers = new Map<TRANSFORM_STAGE, PropsTransducer[]>()

  get currentDocument() {
    return this.project.currentDocument
  }

  get currentHistory() {
    return this.currentDocument?.history
  }

  constructor(props: DesignerProps) {
    this.setProps(props)
    this.editor = props.editor
    this.project = new Project(this, props?.defaultSchema)
    this.dragon = new Dragon(this)
    this.detecting = new Detecting(this)
    this.selection = new Selection(this)

    this.dragon.onDragstart(e => {
      this.detecting.enable = false
      const { dragObject } = e
      if (isDragNodeObject(dragObject)) {
        if (dragObject.nodes.length === 1) {
          if (dragObject.nodes[0].parent) {
            // ensure current selecting
            dragObject.nodes[0].select()
          } else {
            this.selection.clear()
          }
        }
      } else {
        this.selection.clear()
      }
      this.postEvent(DESIGNER_EVENT.DRAG_START, e)
    })

    this.dragon.onDrag(e => {
      this.postEvent(DESIGNER_EVENT.DRAG, e)
    })

    // insert node
    this.dragon.onDragend(e => {
      const { dragObject, copy } = e
      logger.log('onDragend: dragObject ', dragObject, ' copy ', copy)
      const loc = this._dropLocation
      if (loc) {
        this.postEvent(DESIGNER_EVENT.INSERT_NODE_BEFORE, loc)
        if (isLocationChildrenDetail(loc.detail) && loc.detail.valid !== false) {
          let nodes: Node[] | undefined
          if (isDragNodeObject(dragObject)) {
            nodes = insertChildren(loc.target, [...dragObject.nodes], loc.detail.index, copy)
          } else if (isDragNodeDataObject(dragObject)) {
            // process nodeData
            const nodeData = Array.isArray(dragObject.data) ? dragObject.data : [dragObject.data]
            const isNotNodeSchema = nodeData.find(item => !isNodeSchema(item))
            if (isNotNodeSchema) {
              return
            }
            nodes = insertChildren(loc.target, nodeData, loc.detail.index)
          }
          if (nodes) {
            this.selection.selectAll(nodes.map(o => o.id))
          }
        }
        this.postEvent(DESIGNER_EVENT.INSERT_NODE_AFTER, loc)
      }
      this.detecting.enable = true
      this.postEvent(DESIGNER_EVENT.DRAG_END, e)
    })

    let historyDispose: undefined | (() => void)
    const setupHistory = () => {
      if (historyDispose) {
        historyDispose()
        historyDispose = undefined
      }
      this.postEvent(DESIGNER_EVENT.CURRENT_HISTORY_CHANGE, this.currentHistory)
      if (this.currentHistory) {
        const { currentHistory } = this
        historyDispose = currentHistory.onStateChange(() => {
          this.postEvent(DESIGNER_EVENT.CURRENT_DOCUMENT_CHANGE, this.currentDocument)
          this.postEvent(DESIGNER_EVENT.CURRENT_HISTORY_CHANGE, this.currentHistory)
          setupHistory()
        })
      }
    }

    // select root node
    this.project.onCurrentDocumentChange(() => {
      this.selection.clear()

      if (this.selection && this.selection.selected.length === 0) {
        const rootNode = this.project.currentDocument?.getRoot()
        if (rootNode) {
          this.selection.select(rootNode.id)
        }
      }
    })

    this.postEvent(DESIGNER_EVENT.INIT, this)
  }

  setProps(nextProps: DesignerProps) {
    const props = this.props ? { ...this.props, ...nextProps } : nextProps
    this.props = props
  }

  get(key: string) {
    return this.props?.[key]
  }

  postEvent(event: string, ...args: any[]) {
    this.emitter.emit(event, ...args)
  }

  onEvent(event: string, listener: (...args: any[]) => void) {
    this.emitter.on(event, listener)

    return () => {
      this.emitter.off(event, listener)
    }
  }

  createLocation(locationData: LocationData<Node>): DropLocation {
    const loc = new DropLocation(locationData)
    if (this._dropLocation && this._dropLocation.document && this._dropLocation.document !== loc.document) {
      this._dropLocation.document.dropLocation = null
    }
    this._dropLocation = loc
    this.postEvent(DESIGNER_EVENT.DROP_LOCATION_CHANGE, loc)
    if (loc.document) {
      loc.document.dropLocation = loc
    }
    return loc
  }

  clearLocation() {
    if (this._dropLocation && this._dropLocation.document) {
      this._dropLocation.document.dropLocation = null
    }
    this.postEvent(DESIGNER_EVENT.DROP_LOCATION_CHANGE, undefined)
    this._dropLocation = undefined
  }

  onInit(listener: (designer: Designer) => void) {
    this.onEvent(DESIGNER_EVENT.INIT, listener)
  }

  get schema(): ProjectSchema {
    return this.project.getSchema()
  }

  setSchema(schema?: ProjectSchema) {
    this.project.load(schema)
  }

  transformProps(props: PropsSchema, node: Node, stage: TRANSFORM_STAGE) {
    if (Array.isArray(props)) {
      // current not support, make this future
      return props
    }

    const reducers = this.propsReducers.get(stage)
    if (!reducers) {
      return props
    }

    return reducers.reduce<PropsSchema>((transformedProps, reducer) => {
      try {
        return reducer(transformedProps, node, { stage }) as PropsSchema
      } catch (e) {
        logger.error('Error transforming props:', e)
        return transformedProps
      }
    }, props)
  }

  addPropsReducer(reducer: PropsTransducer, stage: TRANSFORM_STAGE) {
    if (!reducer) {
      logger.error('reducer is not available')
      return
    }
    const reducers = this.propsReducers.get(stage)
    if (reducers) {
      reducers.push(reducer)
    } else {
      this.propsReducers.set(stage, [reducer])
    }
  }
}
