import type { Component, ComponentMetadata, Setter } from './meta'
import type { Plugin } from './plugin'
import type { EventBus } from './utils'

import { action, observable } from 'mobx'
import { Designer } from './designer'
import { ComponentMetaManager, SetterManager } from './meta'
import { PluginManager } from './plugin'
import { Simulator } from './simulator'
import { createEventBus, createLogger } from './utils'

export type EditorValueKey = string | symbol

export type EditorGetResult<T, ClsType> = T extends undefined
  ? ClsType extends {
      prototype: infer R
    }
    ? R
    : any
  : T

export interface EditorConfig {
  lifeCycles?: LifeCyclesConfig
  plugins?: Plugin[] | Array<{ plugin: Plugin; options?: any }>
  setters?: Record<string, Setter>
  components?: Record<string, Component>
  componentMetas?: Record<string, ComponentMetadata>
}

export interface LifeCyclesConfig {
  init?: (editor: Editor) => any
  destroy?: (editor: Editor) => any
}

export enum EDITOR_EVENT {
  BEFORE_INIT = 'editor:beforeInit',
  AFTER_INIT = 'editor:afterInit',
  DESTROY = 'editor:destroy',
}

export class Editor {
  @observable.shallow private accessor context = new Map<EditorValueKey, any>()

  config?: EditorConfig

  eventBus: EventBus

  private waits = new Map<
    EditorValueKey,
    Array<{
      once?: boolean
      resolve: (data: any) => void
    }>
  >()

  constructor(config?: EditorConfig) {
    this.eventBus = createEventBus('EasyEditor')

    // if config is provided, initialize the editor
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
    const { lifeCycles, plugins, setters, components, componentMetas } = this.config

    this.eventBus.emit(EDITOR_EVENT.BEFORE_INIT)

    const setterManager = new SetterManager()
    const componentMetaManager = new ComponentMetaManager(this)
    const designer = new Designer({ editor: this, setterManager, componentMetaManager })
    const project = designer.project
    const simulator = new Simulator(designer)
    project.mountSimulator(simulator)

    // pluginEvent is a unified eventBus for all plugins
    const pluginEvent = createEventBus('plugin')
    const pluginManager = new PluginManager({
      assembleApis: (context, pluginName, meta) => {
        context.editor = this
        context.simulator = simulator
        context.designer = designer
        context.project = project
        context.setterManager = setterManager
        context.componentMetaManager = componentMetaManager
        context.event = pluginEvent
        context.logger = createLogger(`plugin:${pluginName}`)
      },
    })

    this.set('setterManager', setterManager)
    this.set('componentMetaManager', componentMetaManager)
    this.set('designer', designer)
    this.set('project', project)
    this.set('simulator', simulator)
    this.set('pluginManager', pluginManager)

    if (plugins) {
      pluginManager.registerPlugins(plugins)
    }
    if (setters) {
      setterManager.buildSettersMap(setters)
    }
    if (components) {
      simulator.buildComponentMap(components)
    }
    if (componentMetas) {
      componentMetaManager.buildComponentMetasMap(componentMetas)
    }

    try {
      await lifeCycles?.init?.(this)
      await pluginManager.init()
    } catch (err) {
      console.error(err)
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
      console.warn(err)
    }

    this.eventBus.emit(EDITOR_EVENT.DESTROY)
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
}

export const createEasyEditor = (config?: EditorConfig) => {
  return new Editor(config)
}
