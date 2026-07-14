import EventEmitter from 'events'
import { action, observable } from 'mobx'
import { Config } from '../config'
import { assertLifecycleMutationAllowed } from '../lifecycle/mutation-barrier'
import { lockReadonlyProperties } from '../lifecycle/readonly-properties'
import {
  assertPublicLifecycleTeardownAllowed,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import type { Plugins } from '../plugin/plugins'
import {
  EDITOR_EVENT,
  type EditorConfig,
  type EditorGetResult,
  type EditorValueKey,
  type HookConfig,
  type Editor as IEditor,
} from '../types/editor'
import { EventBus, type EventDeliveryScheduler } from '../utils/event-bus'
import { createLogger } from '../utils/logger'

const logger = createLogger('Editor')

// inner instance keys which should not be stored in config
const keyBlacklist = [
  'designer',
  'skeleton',
  'currentDocument',
  'simulator',
  'plugins',
  'setters',
  'material',
  'innerHotkey',
  'innerPlugins',
  'engine',
  'clipboard',
  'remote',
  'trustPolicy',
  'transactions',
  'commands',
  'agentCapabilities',
]

export class Editor extends EventEmitter implements IEditor {
  @observable.shallow private accessor context = new Map<EditorValueKey, any>()

  config?: EditorConfig

  readonly eventBus: EventBus

  readonly engineConfig: Config

  components?: IEditor['components']

  private hooks: HookConfig[] = []

  private waits = new Map<
    EditorValueKey,
    Array<{
      once?: boolean
      resolve: (data: any) => void
    }>
  >()

  constructor(config?: EditorConfig, engineConfig?: Config, eventDelivery?: EventDeliveryScheduler) {
    super()
    installLifecycleTeardownOperation(this, () => this.#destroyInternal())
    // set global emitter maxListeners
    this.setMaxListeners(200)
    this.eventBus = new EventBus(this, undefined, eventDelivery)
    this.engineConfig = engineConfig || new Config()
    lockReadonlyProperties(this, ['engineConfig', 'eventBus'])

    if (config) {
      this.init(config)
    }
  }

  override addListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
    assertLifecycleMutationAllowed(this, 'editor.addListener')
    return super.addListener(eventName, listener)
  }

  override on(eventName: string | symbol, listener: (...args: any[]) => void): this {
    assertLifecycleMutationAllowed(this, 'editor.on')
    return super.on(eventName, listener)
  }

  override once(eventName: string | symbol, listener: (...args: any[]) => void): this {
    assertLifecycleMutationAllowed(this, 'editor.once')
    return super.once(eventName, listener)
  }

  override prependListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
    assertLifecycleMutationAllowed(this, 'editor.prependListener')
    return super.prependListener(eventName, listener)
  }

  override prependOnceListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
    assertLifecycleMutationAllowed(this, 'editor.prependOnceListener')
    return super.prependOnceListener(eventName, listener)
  }

  override setMaxListeners(count: number): this {
    assertLifecycleMutationAllowed(this, 'editor.setMaxListeners')
    return super.setMaxListeners(count)
  }

  override removeAllListeners(eventName?: string | symbol): this {
    assertPublicLifecycleTeardownAllowed(this, 'editor.removeAllListeners')
    return this.#removeAllListenersInternal(eventName)
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
    assertLifecycleMutationAllowed(this, 'editor.set')
    // store the data to engineConfig while invoking editor.set()
    if (!keyBlacklist.includes(key as string)) {
      this.engineConfig.set(key as any, data)
    }
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
    assertLifecycleMutationAllowed(this, 'editor.onceGot')
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
    assertLifecycleMutationAllowed(this, 'editor.onGot')
    const x = this.context.get(keyOrType)
    if (x !== undefined) {
      fn(x)
    }
    const registration = this.setWait(keyOrType, fn)
    return () => {
      this.removeWait(keyOrType, registration)
    }
  }

  /**
   * listen value when value is changed
   */
  onChange<T = undefined, KeyOrType extends EditorValueKey = any>(
    keyOrType: KeyOrType,
    fn: (data: EditorGetResult<T, KeyOrType>) => void,
  ): () => void {
    assertLifecycleMutationAllowed(this, 'editor.onChange')
    const registration = this.setWait(keyOrType, fn)
    return () => {
      this.removeWait(keyOrType, registration)
    }
  }

  register(data: any, key?: EditorValueKey): void {
    assertLifecycleMutationAllowed(this, 'editor.register')
    this.context.set(key || data, data)
    this.notifyGot(key || data)
  }

  async init(config?: EditorConfig, components?: Editor['components']): Promise<any> {
    assertLifecycleMutationAllowed(this, 'editor.init')
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

  destroy(): void {
    assertPublicLifecycleTeardownAllowed(this, 'editor.destroy')
    this.#destroyInternal()
  }

  #destroyInternal(): void {
    this.#unregisterHooksInternal()

    if (this.config) {
      try {
        const { lifeCycles = {} } = this.config
        lifeCycles?.destroy?.(this)
      } catch (err) {
        logger.warn(err)
      }
    }

    try {
      this.eventBus.emit(EDITOR_EVENT.DESTROY, this)
    } catch (err) {
      logger.warn(err)
    }

    this.waits.clear()
    this.context.clear()
    this.hooks = []
    this.config = undefined
    this.components = undefined
    runInternalLifecycleTeardown(this.eventBus)
    this.#removeAllListenersInternal()
  }

  async extend(pluginManager: Plugins) {
    assertLifecycleMutationAllowed(this, 'editor.extend')
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
    assertLifecycleMutationAllowed(this, 'editor.initHooks')
    this.hooks = hooks.map(hook => ({
      ...hook,
      // 指定第一个参数为 editor
      handler: hook.handler.bind(this, this),
    }))

    return this.hooks
  }

  registerHooks = (hooks: HookConfig[]) => {
    assertLifecycleMutationAllowed(this, 'editor.registerHooks')
    this.initHooks(hooks).forEach(({ message, type, handler }) => {
      if (['on', 'once'].indexOf(type) !== -1) {
        this[type](message as any, handler)
      }
    })
  }

  unregisterHooks = (): void => {
    assertPublicLifecycleTeardownAllowed(this, 'editor.unregisterHooks')
    this.#unregisterHooksInternal()
  }

  #unregisterHooksInternal(): void {
    this.hooks.forEach(({ message, handler }) => {
      this.removeListener(message, handler)
    })
  }

  #removeAllListenersInternal(eventName?: string | symbol): this {
    if (eventName === undefined) return super.removeAllListeners()
    return super.removeAllListeners(eventName)
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
    assertLifecycleMutationAllowed(this, 'editor.wait')
    const registration = { resolve, once }
    const waits = this.waits.get(key)
    if (waits) {
      waits.push(registration)
    } else {
      this.waits.set(key, [registration])
    }
    return registration
  }

  private removeWait(key: EditorValueKey, registration: { once?: boolean; resolve: (data: any) => void }): void {
    const waits = this.waits.get(key)
    if (!waits) return
    const index = waits.indexOf(registration)
    if (index !== -1) waits.splice(index, 1)
    if (waits.length < 1) this.waits.delete(key)
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
    return this.eventBus.on(EDITOR_EVENT.BEFORE_INIT, listener)
  }

  onAfterInit(listener: (editor: Editor) => void) {
    return this.eventBus.on(EDITOR_EVENT.AFTER_INIT, listener)
  }

  onDestroy(listener: (editor: Editor) => void) {
    return this.eventBus.on(EDITOR_EVENT.DESTROY, listener)
  }

  onBeforeExtend(listener: (editor: Editor) => void) {
    return this.eventBus.on(EDITOR_EVENT.BEFORE_EXTEND, listener)
  }

  onAfterExtend(listener: (editor: Editor) => void) {
    return this.eventBus.on(EDITOR_EVENT.AFTER_EXTEND, listener)
  }
}

export const createEasyEditor = (config?: EditorConfig, engineConfig?: Config) => {
  return new Editor(config, engineConfig)
}
