import {
  EDITOR_EVENT,
  type EditorConfig,
  type EditorGetResult,
  type EditorValueKey,
  EventBus,
  type HookConfig,
  type Editor as IEditor,
  type Plugins,
  createLogger,
} from '@easy-editor/core'
import { action, observable } from 'mobx'
import { EventEmitter } from 'node:events'

const logger = createLogger('Editor')

export class Editor extends EventEmitter implements IEditor {
  @observable.shallow private accessor context = new Map<EditorValueKey, any>()

  config?: EditorConfig

  eventBus: EventBus

  components?: IEditor['components']

  private hooks: HookConfig[] = []

  private waits = new Map<
    EditorValueKey,
    Array<{
      once?: boolean
      resolve: (data: any) => void
    }>
  >()

  constructor(config?: EditorConfig) {
    super()
    // set global emitter maxListeners
    this.setMaxListeners(200)
    this.eventBus = new EventBus(this)

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

  register(data: any, key?: EditorValueKey): void {
    this.context.set(key || data, data)
    this.notifyGot(key || data)
  }

  async init(config?: EditorConfig, components?: Editor['components']): Promise<any> {
    this.config = config || {}
    this.components = components || {}
    const { hooks = [], lifeCycles } = this.config

    this.emit(EDITOR_EVENT.BEFORE_INIT)
    const init = (lifeCycles && lifeCycles.init) || ((): void => {})

    try {
      await init(this)
      // 注册快捷键
      // 注册 hooks
      this.registerHooks(hooks)
      this.emit(EDITOR_EVENT.AFTER_INIT)

      return true
    } catch (err) {
      logger.error(err)
    }
  }

  destroy() {
    if (!this.config) {
      return
    }

    try {
      const { lifeCycles = {} } = this.config
      this.unregisterHooks()
      lifeCycles?.destroy?.(this)
    } catch (err) {
      logger.warn(err)
    }

    this.eventBus.emit(EDITOR_EVENT.DESTROY)
  }

  async extend(pluginManager: Plugins) {
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

  initHooks = (hooks: HookConfig[]) => {
    this.hooks = hooks.map(hook => ({
      ...hook,
      // 指定第一个参数为 editor
      handler: hook.handler.bind(this, this),
    }))

    return this.hooks
  }

  registerHooks = (hooks: HookConfig[]) => {
    this.initHooks(hooks).forEach(({ message, type, handler }) => {
      if (['on', 'once'].indexOf(type) !== -1) {
        this[type](message as any, handler)
      }
    })
  }

  unregisterHooks = () => {
    this.hooks.forEach(({ message, handler }) => {
      this.removeListener(message, handler)
    })
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
