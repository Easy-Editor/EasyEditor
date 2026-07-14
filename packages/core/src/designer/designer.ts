import { computed, observable, reaction } from 'mobx'
import { type Node, type PropsMap, insertChildren, isNodeSchema } from '../document'
import { assertLifecycleMutationAllowed, inheritLifecycleMutationGuard } from '../lifecycle/mutation-barrier'
import { lockPrototypeAccessors, lockReadonlyProperties } from '../lifecycle/readonly-properties'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import type { Materials } from '../materials'
import { Project } from '../project'
import { withoutProjectMutationAuthority } from '../project/mutation-authority'
import type { ComponentMetadata, Editor, ProjectSchema, TRANSFORM_STAGE } from '../types'
import { type EventBus, type EventDeliveryScheduler, createEventBus, createLogger } from '../utils'
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
  eventDelivery?: EventDeliveryScheduler
  defaultSchema?: ProjectSchema
  hotkeys?: object
  simulatorProps?: Record<string, any> | ((project: Project) => object)
  suspended?: boolean
  componentMetadatas?: ComponentMetadata[]

  onMount?: (designer: Designer) => void
  onDragstart?: (e: LocateEvent) => void
  onDrag?: (e: LocateEvent) => void
  onDragend?: (e: { dragObject: DragObject; copy: boolean }, loc?: DropLocation) => void

  [key: string]: any
}

export enum DESIGNER_EVENT {
  MOUNT = 'designer:mount',
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
  private emitter: EventBus

  readonly activeTracker: ActiveTracker

  readonly editor: Editor

  readonly dragon: Dragon

  readonly detecting: Detecting

  readonly project: Project

  readonly selection: Selection

  readonly settingsManager: SettingsManager

  private _dropLocation?: DropLocation

  get materials() {
    return this.editor.get<Materials>('materials')!
  }

  private props?: DesignerProps

  #propsReducers = new Map<TRANSFORM_STAGE, PropsTransducer[]>()

  private oobxList: OffsetObserver[] = []

  #scrollers = new Set<Scroller>()

  private mounted = false

  #disposers: Array<() => void> = []

  private historyDispose?: () => void

  private readonly eventDelivery?: EventDeliveryScheduler

  @observable.ref private accessor _simulatorProps: Record<string, any> | ((project: Project) => object)

  @observable.ref private accessor _suspended = false

  get currentDocument() {
    return this.project.currentDocument
  }

  get currentHistory() {
    return this.currentDocument?.history
  }

  constructor(props: DesignerProps) {
    installLifecycleTeardownOperation(this, () => this.#purgeInternal())
    this.eventDelivery = props.eventDelivery
    lockReadonlyProperties(this, ['eventDelivery', 'oobxList'])
    this.emitter = createEventBus('Designer', undefined, this.eventDelivery)
    lockReadonlyProperties(this, ['emitter'])
    lockPrototypeAccessors(this, ['currentDocument', 'currentHistory', 'materials'])
    inheritEngineTeardownOwnership(this, this.emitter)
    this.activeTracker = new ActiveTracker(this)
    lockReadonlyProperties(this, ['activeTracker'])
    this.setProps(props)
    this.editor = props.editor
    lockReadonlyProperties(this, ['editor'])
    this.project = new Project(this, props?.defaultSchema)
    this.dragon = new Dragon(this)
    this.detecting = new Detecting(this)
    this.selection = new Selection(this)
    this.settingsManager = new SettingsManager(this.editor)
    lockReadonlyProperties(this, ['detecting', 'dragon', 'project', 'selection', 'settingsManager'])
    for (const service of [this.activeTracker, this.dragon, this.detecting, this.selection, this.settingsManager]) {
      inheritEngineTeardownOwnership(this, service)
    }

    this.mount()
    this.init()
    this.postEvent(DESIGNER_EVENT.INIT, this)
  }

  createEventBus(name: string, maxListeners?: number): EventBus {
    assertLifecycleMutationAllowed(this, 'designer.createEventBus')
    const eventBus = createEventBus(name, maxListeners, this.eventDelivery)
    inheritLifecycleMutationGuard(this, eventBus)
    return eventBus
  }

  deferEvent(deliver: () => void): boolean {
    return this.eventDelivery?.(deliver) ?? false
  }

  /**
   * Rebind the instance-owned subscriptions after a lifecycle restart.
   * EventBus disposal only removes listeners, so all owned buses remain reusable.
   */
  mount(): void {
    assertLifecycleMutationAllowed(this, 'designer.mount')
    if (this.mounted) return
    this.mounted = true
    this.settingsManager.mount()

    this.#disposers.push(
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
      }),
      this.dragon.onDrag(e => {
        this.postEvent(DESIGNER_EVENT.DRAG, e)
      }),
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
      }),
      this.activeTracker.onChange(({ node, detail }) => {
        node.document?.simulator?.scrollToNode(node, detail)
      }),
      this.selection.onSelectionChange(ids => {
        this.postEvent(DESIGNER_EVENT.SELECTION_CHANGE, ids)
      }),
      // Select the root node and follow its history when the active document changes.
      // Project.onCurrentDocumentChange historically listened on a different bus
      // than Project.checkExclusive emits, so ownership is explicit here.
      reaction(
        () => this.project.currentDocument,
        () => {
          this.selection.clear()

          if (this.selection.selected.length === 0) {
            const rootNode = this.project.currentDocument?.getRoot()
            if (rootNode) {
              this.selection.select(rootNode.id)
            }
          }
          this.bindCurrentHistory()
        },
        { fireImmediately: true },
      ),
    )

    this.bindCurrentHistory()
  }

  private bindCurrentHistory(): void {
    this.historyDispose?.()
    this.historyDispose = undefined
    this.postEvent(DESIGNER_EVENT.CURRENT_HISTORY_CHANGE, this.currentHistory)

    const history = this.currentHistory
    if (!history) return
    this.historyDispose = history.onStateChange(() => {
      this.postEvent(DESIGNER_EVENT.CURRENT_DOCUMENT_CHANGE, this.currentDocument)
      this.postEvent(DESIGNER_EVENT.CURRENT_HISTORY_CHANGE, this.currentHistory)
    })
  }

  /**
   * 该函数用于 Designer constructor 的插件扩展，因为 Object.defineProperty 无法修改 constructor
   */
  init() {}

  setProps(nextProps: Partial<DesignerProps>) {
    assertLifecycleMutationAllowed(this, 'designer.setProps')
    const props = this.props ? { ...this.props, ...nextProps } : nextProps

    if (this.props) {
      if (props.simulatorProps && props.simulatorProps !== this.props.simulatorProps) {
        this._simulatorProps = props.simulatorProps
      }
      if (props.suspended && props.suspended !== this.props.suspended) {
        this._suspended = props.suspended
      }
      if (props.componentMetadatas && props.componentMetadatas !== this.props.componentMetadatas) {
        this.materials.buildComponentMetasMap(props.componentMetadatas)
      }
    } else {
      if (props.simulatorProps) {
        this._simulatorProps = props.simulatorProps
      }
      if (props.suspended != null) {
        this._suspended = props.suspended
      }
      if (props.componentMetadatas != null) {
        this.materials.buildComponentMetasMap(props.componentMetadatas)
      }
    }

    this.props = props as DesignerProps
  }

  get(key: string) {
    return this.props?.[key]
  }

  postEvent(event: string, ...args: any[]) {
    this.emitter.emit(event, ...args)
  }

  onEvent(event: string, listener: (...args: any[]) => void) {
    assertLifecycleMutationAllowed(this, 'designer.onEvent')
    return this.emitter.on(event, listener)
  }

  createLocation(locationData: LocationData<Node>): DropLocation {
    assertLifecycleMutationAllowed(this, 'designer.createLocation')
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
    assertLifecycleMutationAllowed(this, 'designer.clearLocation')
    if (this._dropLocation && this._dropLocation.document) {
      this._dropLocation.document.dropLocation = null
    }
    this.postEvent(DESIGNER_EVENT.DROP_LOCATION_CHANGE, undefined)
    this._dropLocation = undefined
  }

  createScroller(scrollable: Scrollable) {
    assertLifecycleMutationAllowed(this, 'designer.createScroller')
    const scroller = new Scroller(scrollable)
    inheritLifecycleMutationGuard(this, scroller)
    inheritEngineTeardownOwnership(this, scroller)
    this.#scrollers.add(scroller)
    return scroller
  }

  createOffsetObserver(nodeInstance: NodeSelector): OffsetObserver | null {
    assertLifecycleMutationAllowed(this, 'designer.createOffsetObserver')
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
    assertLifecycleMutationAllowed(this, 'designer.touchOffsetObserver')
    this.clearOobxList(true)
    this.oobxList.forEach(item => item.compute())
  }

  onInit(listener: (designer: Designer) => void) {
    assertLifecycleMutationAllowed(this, 'designer.onInit')
    this.onEvent(DESIGNER_EVENT.INIT, listener)
  }

  get schema() {
    return this.project.export()
  }

  @computed
  get simulatorProps(): Record<string, any> {
    if (typeof this._simulatorProps === 'function') {
      return this._simulatorProps(this.project)
    }
    return this._simulatorProps || {}
  }

  /**
   * 提供给模拟器的参数
   */
  @computed
  get projectSimulatorProps(): any {
    return {
      ...this.simulatorProps,
      project: this.project,
      designer: this,
      onMount: (simulator: any) => {
        this.project.mountSimulator(simulator)
        this.editor.set('simulator', simulator)
      },
    }
  }

  get suspended(): boolean {
    return this._suspended
  }

  set suspended(flag: boolean) {
    assertLifecycleMutationAllowed(this, 'designer.suspended')
    this._suspended = flag
    // Todo afterwards...
    if (flag) {
      // this.project.suspensed = true?
    }
  }

  setSchema(schema: ProjectSchema) {
    assertLifecycleMutationAllowed(this, 'designer.setSchema')
    this.project.import(schema)
  }

  transformProps(props: PropsMap, node: Node, stage: TRANSFORM_STAGE) {
    if (Array.isArray(props)) {
      // current not support, make this future
      return props
    }

    const reducers = this.#propsReducers.get(stage)
    if (!reducers) {
      return props
    }

    return reducers.reduce<PropsMap>((transformedProps, reducer) => {
      try {
        return withoutProjectMutationAuthority(node.document.project, () =>
          reducer(transformedProps, node, { stage }),
        ) as PropsMap
      } catch (e) {
        logger.error('Error transforming props:', e)
        return transformedProps
      }
    }, props)
  }

  addPropsReducer(reducer: PropsTransducer, stage: TRANSFORM_STAGE) {
    assertLifecycleMutationAllowed(this, 'designer.addPropsReducer')
    if (!reducer) {
      logger.error('reducer is not available')
      return
    }
    const reducers = this.#propsReducers.get(stage)
    if (reducers) {
      reducers.push(reducer)
    } else {
      this.#propsReducers.set(stage, [reducer])
    }
  }

  createSettingEntry(nodes: Node[]) {
    assertLifecycleMutationAllowed(this, 'designer.createSettingEntry')
    return new SettingTopEntry(this.editor, nodes)
  }

  purge(): void {
    assertPublicLifecycleTeardownAllowed(this, 'designer.purge')
    this.#purgeInternal()
  }

  #purgeInternal(): void {
    const failures: unknown[] = []
    const cleanup = (operation: () => void) => {
      try {
        operation()
      } catch (error) {
        failures.push(error)
      }
    }

    this.mounted = false
    cleanup(() => this.historyDispose?.())
    this.historyDispose = undefined
    for (const dispose of this.#disposers.splice(0).reverse()) {
      cleanup(dispose)
    }

    // Drop public and plugin listeners before resetting child state so disposal
    // cannot publish partial teardown events.
    cleanup(() => runInternalLifecycleTeardown(this.emitter))
    cleanup(() => runInternalLifecycleTeardown(this.settingsManager))
    cleanup(() => runInternalLifecycleTeardown(this.dragon))
    cleanup(() => runInternalLifecycleTeardown(this.selection))
    cleanup(() => runInternalLifecycleTeardown(this.detecting))
    cleanup(() => runInternalLifecycleTeardown(this.activeTracker))

    if (this._dropLocation?.document) {
      this._dropLocation.document.dropLocation = null
    }
    this._dropLocation = undefined
    this.#propsReducers.clear()

    for (const scroller of [...this.#scrollers].reverse()) {
      try {
        runInternalLifecycleTeardown(scroller)
        this.#scrollers.delete(scroller)
      } catch (error) {
        failures.push(error)
      }
    }

    const retainedObservers: OffsetObserver[] = []
    for (const observer of this.oobxList) {
      try {
        observer.purge()
      } catch (error) {
        failures.push(error)
        retainedObservers.push(observer)
      }
    }
    this.oobxList.splice(0, this.oobxList.length, ...retainedObservers)

    if (failures.length > 0) {
      throw new AggregateError(failures, 'Designer disposal completed with errors')
    }
  }
}
