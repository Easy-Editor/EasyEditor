import { type Node, type PropsMap, insertChildren, isNodeSchema } from '../document'
import { Project } from '../project'
import type { ComponentMetaManager, Editor, ProjectSchema, TRANSFORM_STAGE } from '../types'
import { createEventBus, createLogger } from '../utils'
import { ActiveTracker } from './active-tracker'
import { Detecting } from './detecting'
import type { DragObject } from './dragon'
import { Dragon, isDragNodeDataObject, isDragNodeObject } from './dragon'
import { DropLocation, type LocateEvent, type LocationData, isLocationChildrenDetail } from './location'
import { type NodeSelector, type OffsetObserver, createOffsetObserver } from './offset-observer'
import { type Scrollable, Scroller } from './scroller'
import { Selection } from './selection'
import { SettingsManager } from './setting'
import { SettingTopEntry } from './setting/setting-top-entry'

const logger = createLogger('Designer')

export type PropsTransducer = (
  props: PropsMap,
  node: Node,
  ctx?: {
    stage: TRANSFORM_STAGE
  },
) => PropsMap

export interface DesignerProps {
  editor: Editor
  defaultSchema?: ProjectSchema

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
  DOCUMENT_DROP_LOCATION_CHANGE = 'designer:document.dropLocation.change',
  SETTING_TOP_ENTRY_VALUE_CHANGE = 'designer:setting.top-entry.value.change',
  SELECTION_CHANGE = 'designer:selection.change',

  CURRENT_DOCUMENT_CHANGE = 'designer:current-document.change',
  CURRENT_HISTORY_CHANGE = 'designer:current-history.change',
  INSERT_NODE_BEFORE = 'designer:node.insert.before',
  INSERT_NODE_AFTER = 'designer:node.insert.after',
  NODE_VISIBLE_CHANGE = 'designer:node.visible.change',
  NODE_LOCK_CHANGE = 'designer:node.lock.change',
  NODE_CHILDREN_CHANGE = 'designer:node.children.change',
  NODE_PROPS_CHANGE = 'designer:node.props.change',
  NODE_REMOVE = 'designer:node.remove',
  NODE_RENDER = 'designer:node.render',

  SIMULATOR_SELECT = 'designer:simulator.select',
  VIEWPORT_MOUNT = 'simulator:viewport.mount',
}

export class Designer {
  private emitter = createEventBus('Designer')

  readonly activeTracker = new ActiveTracker()

  readonly editor: Editor

  readonly dragon: Dragon

  readonly detecting: Detecting

  readonly project: Project

  readonly selection: Selection

  readonly settingsManager: SettingsManager

  private _dropLocation?: DropLocation

  get componentMetaManager() {
    return this.editor.get<ComponentMetaManager>('componentMetaManager')!
  }

  private props?: DesignerProps

  private propsReducers = new Map<TRANSFORM_STAGE, PropsTransducer[]>()

  private oobxList: OffsetObserver[] = []

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
    this.settingsManager = new SettingsManager(this.editor)

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

    // TODO: 这一块逻辑是否需要抽出来
    // insert node
    this.dragon.onDragend(e => {
      const { dragObject } = e
      const loc = this._dropLocation
      if (loc) {
        this.postEvent(DESIGNER_EVENT.INSERT_NODE_BEFORE, loc)
        if (isLocationChildrenDetail(loc.detail) && loc.detail.valid !== false) {
          let nodes: Node[] | undefined
          if (isDragNodeObject(dragObject)) {
            // TODO: 插入逻辑在 dashboard 不需要
            // nodes = insertChildren(loc.target, [...dragObject.nodes], loc.detail.index, copy)
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

    this.activeTracker.onChange(({ node, detail }) => {
      node.document?.simulator?.scrollToNode(node, detail)
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

    this.selection.onSelectionChange(ids => {
      this.postEvent(DESIGNER_EVENT.SELECTION_CHANGE, ids)
    })

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

    this.init()
    this.postEvent(DESIGNER_EVENT.INIT, this)
  }

  /**
   * 该函数用于 Designer constructor 的插件扩展，因为 Object.defineProperty 无法修改 constructor
   */
  init() {}

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

  createScroller(scrollable: Scrollable) {
    return new Scroller(scrollable)
  }

  createOffsetObserver(nodeInstance: NodeSelector): OffsetObserver | null {
    const oobx = createOffsetObserver(nodeInstance)
    this.clearOobxList()
    if (oobx) {
      this.oobxList.push(oobx)
    }
    return oobx
  }

  private clearOobxList(force?: boolean) {
    let l = this.oobxList.length
    if (l > 20 || force) {
      while (l-- > 0) {
        if (this.oobxList[l].isPurged()) {
          this.oobxList.splice(l, 1)
        }
      }
    }
  }

  touchOffsetObserver() {
    this.clearOobxList(true)
    this.oobxList.forEach(item => item.compute())
  }

  onInit(listener: (designer: Designer) => void) {
    this.onEvent(DESIGNER_EVENT.INIT, listener)
  }

  get schema() {
    return this.project.export()
  }

  setSchema(schema: ProjectSchema) {
    this.project.import(schema)
  }

  transformProps(props: PropsMap, node: Node, stage: TRANSFORM_STAGE) {
    if (Array.isArray(props)) {
      // current not support, make this future
      return props
    }

    const reducers = this.propsReducers.get(stage)
    if (!reducers) {
      return props
    }

    return reducers.reduce<PropsMap>((transformedProps, reducer) => {
      try {
        return reducer(transformedProps, node, { stage }) as PropsMap
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

  createSettingEntry(nodes: Node[]) {
    return new SettingTopEntry(this.editor, nodes)
  }
}
