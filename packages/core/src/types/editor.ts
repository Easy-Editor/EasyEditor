import type { Component, ComponentMetadata, DesignerProps } from '../designer'
import type { Plugin, PluginManager } from '../plugin'
import type { Setter } from '../setter-manager'
import type { EventBus, HotkeyConfig } from '../utils'
import type { ProjectSchema } from './schema'

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

export interface Editor {
  config?: EditorConfig
  eventBus: EventBus

  get<T = undefined, KeyOrType extends EditorValueKey = any>(
    keyOrType: KeyOrType,
  ): EditorGetResult<T, KeyOrType> | undefined

  has(keyOrType: EditorValueKey): boolean

  set(key: EditorValueKey, data: any): void | Promise<void>

  /**
   * get value until value is set
   */
  onceGot<T = undefined, KeyOrType extends EditorValueKey = any>(
    keyOrType: KeyOrType,
  ): Promise<EditorGetResult<T, KeyOrType>>

  /**
   * listen value when value is set
   */
  onGot<T = undefined, KeyOrType extends EditorValueKey = any>(
    keyOrType: KeyOrType,
    fn: (data: EditorGetResult<T, KeyOrType>) => void,
  ): () => void

  /**
   * listen value when value is changed
   */
  onChange<T = undefined, KeyOrType extends EditorValueKey = any>(
    keyOrType: KeyOrType,
    fn: (data: EditorGetResult<T, KeyOrType>) => void,
  ): () => void

  extend(pluginManager: PluginManager): Promise<void>
  init(config?: EditorConfig): Promise<void>
  destroy(): void

  onBeforeExtend(listener: (editor: Editor) => void): () => void
  onAfterExtend(listener: (editor: Editor) => void): () => void
  onBeforeInit(listener: (editor: Editor) => void): () => void
  onAfterInit(listener: (editor: Editor) => void): () => void
  onDestroy(listener: (editor: Editor) => void): () => void
}
