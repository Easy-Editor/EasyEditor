import {
  type Component,
  ComponentMetaManager,
  type ComponentMetadata,
  Designer,
  type DesignerProps,
  Hotkey,
  type HotkeyConfig,
  type Plugin,
  type PluginContextApiAssembler,
  PluginManager,
  type ProjectSchema,
  type Setter,
  SetterManager,
  Simulator,
  createEventBus,
  createLogger,
  logger,
} from '@easy-editor/core'
import { action, observable } from 'mobx'

export type EditorValueKey = string | symbol

export type EditorGetResult<T, ClsType> = T extends undefined
  ? ClsType extends {
      prototype: infer R
    }
    ? R
    : any
  : T

export interface EditorConfig {
  /**
   * 插件 Plugin
   */
  plugins?: Plugin[]

  /**
   * 设置器 Setter
   */
  setters?: Record<string, Component | Setter>

  /**
   * 组件 Component
   */
  components?: Record<string, Component>

  /**
   * 组件元数据 ComponentMetadata
   */
  componentMetas?: Record<string, ComponentMetadata>

  /**
   * 生命周期
   */
  lifeCycles?: LifeCyclesConfig

  /**
   * designer props
   */
  designer?: Pick<DesignerProps, 'onDragstart' | 'onDrag' | 'onDragend'>

  /**
   * 默认项目 Schema
   */
  defaultSchema?: ProjectSchema

  /**
   * 快捷键
   */
  hotkeys?: HotkeyConfig[]
}

export interface LifeCyclesConfig {
  init?: (editor: Editor) => any
  destroy?: (editor: Editor) => any
  extend?: (editor: Editor) => any
}

export enum EDITOR_EVENT {
  BEFORE_INIT = 'editor:beforeInit',
  AFTER_INIT = 'editor:afterInit',
  DESTROY = 'editor:destroy',
  BEFORE_EXTEND = 'editor:beforeExtend',
  AFTER_EXTEND = 'editor:afterExtend',
}

export class Editor {
  @observable.shallow private accessor context = new Map<EditorValueKey, any>()

  config?: EditorConfig

  eventBus = createEventBus('EasyEditor')

  private waits = new Map<
    EditorValueKey,
    Array<{
      once?: boolean
      resolve: (data: any) => void
    }>
  >()

  constructor(config?: EditorConfig) {
    if (config) {
      this.init(config)
    }
  }

  get<T = undefined, KeyOrType extends EditorValueKey = any>(
    keyOrType: KeyOrType,
  ): EditorGetResult<T, KeyOrType> | undefined {
    return this.context.get(keyOrType)
  }

  has(keyOrType: EditorValueKey): boolean {
    return this.context.has(keyOrType)
  }

  @action
  set(key: EditorValueKey, data: any): void | Promise<void> {
    this.context.set(key, data)
    this.notifyGot(key)
  }

  /**
   * get value until value is set
   */
  @action
  onceGot<T = undefined, KeyOrType extends EditorValueKey = any>(
    keyOrType: KeyOrType,
  ): Promise<EditorGetResult<T, KeyOrType>> {
    const x = this.context.get(keyOrType)
    if (x !== undefined) {
      return Promise.resolve(x)
    }
    return new Promise(resolve => {
      this.setWait(keyOrType, resolve, true)
    })
  }

  /**
   * listen value when value is set
   */
  @action
  onGot<T = undefined, KeyOrType extends EditorValueKey = any>(
    keyOrType: KeyOrType,
    fn: (data: EditorGetResult<T, KeyOrType>) => void,
  ): () => void {
    const x = this.context.get(keyOrType)
    if (x !== undefined) {
      fn(x)
    }
    this.setWait(keyOrType, fn)
    return () => {
      this.delWait(keyOrType, fn)
    }
  }

  /**
   * listen value when value is changed
   */
  onChange<T = undefined, KeyOrType extends EditorValueKey = any>(
    keyOrType: KeyOrType,
    fn: (data: EditorGetResult<T, KeyOrType>) => void,
  ): () => void {
    this.setWait(keyOrType, fn)
    return () => {
      this.delWait(keyOrType, fn)
    }
  }

  async init(config?: EditorConfig) {
    this.config = config || {}
    const {
      lifeCycles,
      plugins,
      setters,
      components,
      componentMetas,
      hotkeys,
      designer: designerProps,
      defaultSchema,
    } = this.config

    // 1. register plugins
    const pluginManager = new PluginManager()
    if (plugins) {
      pluginManager.registerPlugins(plugins)
    }

    // 2. plugins.extend()
    await this.extend(pluginManager)

    // 3. init
    this.eventBus.emit(EDITOR_EVENT.BEFORE_INIT)

    const hotkey = new Hotkey()
    const setterManager = new SetterManager()
    const componentMetaManager = new ComponentMetaManager(this)
    const designer = new Designer({
      editor: this,
      setterManager,
      componentMetaManager,
      ...designerProps,
      defaultSchema,
    })
    const project = designer.project
    const simulator = new Simulator(designer)
    project.mountSimulator(simulator)

    // pluginEvent is a unified eventBus for all plugins
    const pluginEvent = createEventBus('plugin')
    const contextApiAssembler: PluginContextApiAssembler = {
      assembleApis: (context, pluginName, meta) => {
        context.editor = this
        context.simulator = simulator
        context.designer = designer
        context.project = project
        context.setterManager = setterManager
        context.componentMetaManager = componentMetaManager
        context.event = pluginEvent
        context.hotkey = hotkey
        context.logger = createLogger(`plugin:${pluginName}`)
      },
    }
    pluginManager.setContextApiAssembler(contextApiAssembler)

    this.set('setterManager', setterManager)
    this.set('componentMetaManager', componentMetaManager)
    this.set('designer', designer)
    this.set('project', project)
    this.set('simulator', simulator)
    this.set('pluginManager', pluginManager)

    if (setters) {
      setterManager.buildSettersMap(setters)
    }
    if (components) {
      simulator.buildComponentMap(components)
    }
    if (componentMetas) {
      componentMetaManager.buildComponentMetasMap(componentMetas)
    }
    if (hotkeys) {
      hotkey.batchBind(hotkeys)
    }

    try {
      await pluginManager.init()
      await lifeCycles?.init?.(this)
    } catch (err) {
      logger.error(err)
    }

    this.eventBus.emit(EDITOR_EVENT.AFTER_INIT)
  }

  destroy() {
    if (!this.config) {
      return
    }

    try {
      const { lifeCycles = {} } = this.config
      lifeCycles?.destroy?.(this)
    } catch (err) {
      logger.warn(err)
    }

    this.eventBus.emit(EDITOR_EVENT.DESTROY)
  }

  async extend(pluginManager: PluginManager) {
    this.eventBus.emit(EDITOR_EVENT.BEFORE_EXTEND)

    try {
      const { lifeCycles = {} } = this.config!
      lifeCycles?.extend?.(this)
      await pluginManager.extend()
    } catch (err) {
      logger.warn(err)
    }

    this.eventBus.emit(EDITOR_EVENT.AFTER_EXTEND)
  }

  /**
   * notify all listeners when value is got
   */
  private notifyGot(key: EditorValueKey) {
    let waits = this.waits.get(key)
    if (!waits) {
      return
    }
    waits = waits.slice().reverse()
    let i = waits.length
    while (i--) {
      waits[i].resolve(this.get(key))
      if (waits[i].once) {
        waits.splice(i, 1)
      }
    }
    if (waits.length > 0) {
      this.waits.set(key, waits)
    } else {
      this.waits.delete(key)
    }
  }

  private setWait(key: EditorValueKey, resolve: (data: any) => void, once?: boolean) {
    const waits = this.waits.get(key)
    if (waits) {
      waits.push({ resolve, once })
    } else {
      this.waits.set(key, [{ resolve, once }])
    }
  }

  private delWait(key: EditorValueKey, fn: any) {
    const waits = this.waits.get(key)
    if (!waits) {
      return
    }
    let i = waits.length
    while (i--) {
      if (waits[i].resolve === fn) {
        waits.splice(i, 1)
      }
    }
    if (waits.length < 1) {
      this.waits.delete(key)
    }
  }

  onBeforeInit(listener: (editor: Editor) => void) {
    this.eventBus.on(EDITOR_EVENT.BEFORE_INIT, listener)

    return () => {
      this.eventBus.off(EDITOR_EVENT.BEFORE_INIT, listener)
    }
  }

  onAfterInit(listener: (editor: Editor) => void) {
    this.eventBus.on(EDITOR_EVENT.AFTER_INIT, listener)

    return () => {
      this.eventBus.off(EDITOR_EVENT.AFTER_INIT, listener)
    }
  }

  onDestroy(listener: (editor: Editor) => void) {
    this.eventBus.on(EDITOR_EVENT.DESTROY, listener)

    return () => {
      this.eventBus.off(EDITOR_EVENT.DESTROY, listener)
    }
  }

  onBeforeExtend(listener: (editor: Editor) => void) {
    this.eventBus.on(EDITOR_EVENT.BEFORE_EXTEND, listener)

    return () => {
      this.eventBus.off(EDITOR_EVENT.BEFORE_EXTEND, listener)
    }
  }

  onAfterExtend(listener: (editor: Editor) => void) {
    this.eventBus.on(EDITOR_EVENT.AFTER_EXTEND, listener)

    return () => {
      this.eventBus.off(EDITOR_EVENT.AFTER_EXTEND, listener)
    }
  }
}

export const createEasyEditor = (config?: EditorConfig) => {
  return new Editor(config)
}
