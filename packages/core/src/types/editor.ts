import type { EventEmitter } from 'node:events'
import type { Plugin, Plugins } from '../plugin'
import type { EventBus } from '../utils'
import type { Component } from './component'

export type EditorValueKey = string | symbol

export type EditorGetResult<T, ClsType> = T extends undefined
  ? ClsType extends {
      prototype: infer R
    }
    ? R
    : any
  : T

export interface EditorConfig {
  plugins?: PluginConfig
  hooks?: HooksConfig
  shortCuts?: ShortCutsConfig
  utils?: UtilsConfig
  constants?: ConstantsConfig
  lifeCycles?: LifeCyclesConfig
}

export type PluginConfig = Plugin[]

export type HooksConfig = HookConfig[]

export interface HookConfig {
  message: string
  type: 'on' | 'once'
  handler: (this: Editor, editor: Editor, ...args: any[]) => void
}

export type ShortCutsConfig = ShortCutConfig[]

export interface ShortCutConfig {
  keyboard: string
  handler: (editor: Editor, ev: Event, keymaster: any) => void
}

export type UtilsConfig = UtilConfig[]

export interface UtilConfig {
  name: string
  type: 'function'
  content: (...args: []) => any
}

export type ConstantsConfig = Record<string, unknown>

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

export interface Editor extends EventEmitter {
  config?: EditorConfig
  eventBus: EventBus
  components?: Record<string, Component>

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

  extend(pluginManager: Plugins): Promise<void>
  init(config?: EditorConfig, components?: Editor['components']): Promise<void>
  destroy(): void

  onBeforeExtend(listener: (editor: Editor) => void): () => void
  onAfterExtend(listener: (editor: Editor) => void): () => void
  onBeforeInit(listener: (editor: Editor) => void): () => void
  onAfterInit(listener: (editor: Editor) => void): () => void
  onDestroy(listener: (editor: Editor) => void): () => void
}
