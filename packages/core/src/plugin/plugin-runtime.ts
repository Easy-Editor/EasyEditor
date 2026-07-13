import {
  type LifecycleMutationTicket,
  assertLifecycleMutationAllowed,
  assertLifecycleMutationTicket,
  captureLifecycleMutationTicket,
  inheritLifecycleMutationGuard,
} from '../lifecycle/mutation-barrier'
import {
  assertPublicLifecycleTeardownAllowed,
  assertPublicOwnedLifecycleOperationAllowed,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import { type Logger, createLogger } from '../utils'
import type { PluginContext } from './plugin-context'
import { createLifecycleCapabilityBinder } from './plugin-context-boundary'
import type { PluginExtend } from './plugin-extend'
import { deletePluginRuntimeFromManager } from './plugin-manager-boundary'
import { installPluginRuntimeOperations } from './plugin-runtime-boundary'
import type { Plugin, PluginMeta, Plugins } from './plugins'

export class PluginRuntime {
  readonly #config: Plugin

  readonly #publicConfig: Plugin

  get config(): Plugin {
    return this.#publicConfig
  }

  readonly logger: Logger

  readonly #manager: Plugins

  #inited = false

  #extended = false

  readonly #pluginName: string

  #context?: PluginContext

  #initAttempt?: object

  #initPromise?: Promise<void>

  #destroyPromise?: Promise<void>

  #extendPromise?: Promise<void>

  #canonicalProxy?: PluginRuntime

  #destroyHookCompleted = false

  readonly meta: PluginMeta

  /**
   * indicates whether the plugin is disabled
   */
  #disabled = false

  get ctx() {
    assertLifecycleMutationAllowed(this, 'pluginRuntime.ctx')
    this.#context ||= this.#manager.getPluginContext({ pluginName: this.#pluginName, meta: this.meta }, this)
    return this.#context
  }

  constructor(pluginName: string, manager: Plugins, config: Plugin) {
    this.#manager = manager
    this.#config = Object.freeze({
      ...config,
      deps: config.deps ? (Object.freeze([...config.deps]) as unknown as string[]) : undefined,
    })
    this.#publicConfig = this.#config
    this.#pluginName = pluginName
    this.meta = Object.freeze({
      dependencies: Object.freeze([...(config?.deps || [])]) as string[],
      eventPrefix: config.eventPrefix,
    })
    this.logger = createLogger(`plugin:${pluginName}`)
    installLifecycleTeardownOperation(this, () => this.#destroyInternal())
    installPluginRuntimeOperations(this, {
      destroy: () => this.#destroyInternal(),
      getConfig: () => this.#config,
      init: forceInit => this.#initInternal(forceInit),
      markExtended: () => this.#markExtendedInternal(),
      prepareExtension: pluginExtend => this.#prepareExtensionInternal(pluginExtend),
      publishContext: () => this.#publishContextInternal(),
    })
    Object.defineProperty(this, 'config', {
      configurable: false,
      enumerable: true,
      get: () => this.#publicConfig,
    })
    Object.defineProperty(this, 'meta', {
      configurable: false,
      enumerable: true,
      value: this.meta,
      writable: false,
    })
    Object.preventExtensions(this)
  }

  get name() {
    return this.#pluginName
  }

  get deps() {
    if (typeof this.meta.dependencies === 'string') {
      return [this.meta.dependencies]
    }

    return this.meta.dependencies || []
  }

  get disabled() {
    return this.#disabled
  }

  isInited() {
    return this.#inited
  }

  isExtended() {
    return this.#extended
  }

  async init(forceInit = false): Promise<void> {
    assertPublicOwnedLifecycleOperationAllowed(this, 'pluginRuntime.init')
    return this.#initInternal(forceInit)
  }

  async #initInternal(forceInit = false): Promise<void> {
    const ticket = captureLifecycleMutationTicket(this, 'pluginRuntime.init')
    return this.#initWithTicket(forceInit, ticket)
  }

  async #initWithTicket(forceInit: boolean, ticket: LifecycleMutationTicket): Promise<void> {
    if (!forceInit && this.#initPromise) return this.#initPromise
    if (forceInit && this.#initPromise) {
      try {
        await this.#initPromise
      } catch {
        // A forced retry starts only after the previous attempt has settled.
      }
      assertLifecycleMutationTicket(this, ticket, 'pluginRuntime.init.retry')
      return this.#initWithTicket(true, ticket)
    }
    if (this.#destroyPromise) {
      await this.#destroyPromise
      assertLifecycleMutationTicket(this, ticket, 'pluginRuntime.init.afterDestroy')
      return this.#initWithTicket(forceInit, ticket)
    }
    if (this.#inited && !forceInit) return

    const initPromise = this.#performInit(ticket)
    this.#initPromise = initPromise
    try {
      await initPromise
    } finally {
      if (this.#initPromise === initPromise) this.#initPromise = undefined
    }
  }

  async #performInit(ticket: LifecycleMutationTicket): Promise<void> {
    const attempt = {}
    this.#initAttempt = attempt
    this.logger.log('method init called')
    if (!this.#inited && this.#context) {
      const precreatedContext = this.#context
      try {
        runInternalLifecycleTeardown(precreatedContext)
      } finally {
        this.#manager.releasePluginContext(this.name, precreatedContext)
        if (this.#context === precreatedContext) this.#context = undefined
      }
    }
    const context = this.ctx
    try {
      await this.#config.init?.call(undefined, context)
      assertLifecycleMutationTicket(this, ticket, 'pluginRuntime.init.commit')
      if (this.#initAttempt !== attempt) throw new Error(`Plugin "${this.name}" initialization was superseded`)
      this.#inited = true
      this.#destroyHookCompleted = false
    } catch (error) {
      if (this.#initAttempt === attempt) {
        this.#inited = false
        try {
          runInternalLifecycleTeardown(context)
          this.#manager.releasePluginContext(this.name, context)
          if (this.#context === context) this.#context = undefined
        } catch (disposeError) {
          throw new AggregateError([error, disposeError], `Plugin "${this.name}" init and context rollback both failed`)
        }
      }
      throw error
    } finally {
      if (this.#initAttempt === attempt) this.#initAttempt = undefined
    }
  }

  async destroy(): Promise<void> {
    assertPublicLifecycleTeardownAllowed(this, 'pluginRuntime.destroy')
    return this.#destroyInternal()
  }

  async #destroyInternal(): Promise<void> {
    if (this.#destroyPromise) return this.#destroyPromise
    const pendingInit = this.#initPromise
    this.#initAttempt = undefined
    this.#initPromise = undefined
    const destroyPromise = this.#performDestroy(pendingInit)
    this.#destroyPromise = destroyPromise
    try {
      await destroyPromise
    } finally {
      if (this.#destroyPromise === destroyPromise) this.#destroyPromise = undefined
    }
  }

  async #performDestroy(pendingInit?: Promise<void>): Promise<void> {
    if (pendingInit) await Promise.allSettled([pendingInit])
    const context = this.#context
    if (!this.#inited) {
      if (!context) return
      runInternalLifecycleTeardown(context)
      this.#manager.releasePluginContext(this.name, context)
      if (this.#context === context) this.#context = undefined
      return
    }
    this.logger.log('method destroy called')
    const errors: unknown[] = []
    const activeContext = context || this.ctx
    if (!this.#destroyHookCompleted) {
      try {
        await this.#config.destroy?.call(undefined, activeContext)
        this.#destroyHookCompleted = true
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length === 0) {
      try {
        runInternalLifecycleTeardown(activeContext)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, `Plugin "${this.name}" failed to destroy`)
    this.#inited = false
    this.#destroyHookCompleted = false
    this.#manager.releasePluginContext(this.name, activeContext)
    if (this.#context === activeContext) this.#context = undefined
  }

  #publishContextInternal(): void {
    if (this.#context) this.#manager.publishPluginContext(this.name, this, this.#context)
  }

  async prepareExtension(pluginExtend: PluginExtend): Promise<boolean> {
    assertPublicOwnedLifecycleOperationAllowed(this, 'pluginRuntime.prepareExtension')
    return this.#prepareExtensionInternal(pluginExtend)
  }

  async #prepareExtensionInternal(pluginExtend: PluginExtend): Promise<boolean> {
    const ticket = captureLifecycleMutationTicket(this, 'pluginRuntime.prepareExtension')
    if (this.#extended) return false
    this.logger.log('method extend called')
    await this.#config.extend?.call(undefined, pluginExtend)
    assertLifecycleMutationTicket(this, ticket, 'pluginRuntime.prepareExtension.commit')
    return true
  }

  markExtended(): void {
    assertPublicOwnedLifecycleOperationAllowed(this, 'pluginRuntime.markExtended')
    this.#markExtendedInternal()
  }

  #markExtendedInternal(): void {
    assertLifecycleMutationAllowed(this, 'pluginRuntime.markExtended')
    this.#extended = true
  }

  async extend(pluginExtend: PluginExtend): Promise<void> {
    assertPublicOwnedLifecycleOperationAllowed(this, 'pluginRuntime.extend')
    return this.#extendInternal(pluginExtend)
  }

  async #extendInternal(pluginExtend: PluginExtend): Promise<void> {
    if (this.#extendPromise) return this.#extendPromise
    const extendPromise = this.#performExtend(pluginExtend)
    this.#extendPromise = extendPromise
    try {
      await extendPromise
    } finally {
      if (this.#extendPromise === extendPromise) this.#extendPromise = undefined
    }
  }

  async #performExtend(pluginExtend: PluginExtend): Promise<void> {
    if (await this.#prepareExtensionInternal(pluginExtend)) this.#markExtendedInternal()
  }

  setDisabled(flag = true) {
    assertLifecycleMutationAllowed(this, 'pluginRuntime.setDisabled')
    this.#disabled = flag
  }

  async dispose() {
    assertPublicOwnedLifecycleOperationAllowed(this, 'pluginRuntime.dispose')
    assertLifecycleMutationAllowed(this, 'pluginRuntime.dispose')
    await deletePluginRuntimeFromManager(this.#manager, this)
  }

  toProxy() {
    assertLifecycleMutationAllowed(this, 'pluginRuntime.toProxy')
    if (this.#canonicalProxy) return this.#canonicalProxy
    if (!this.#inited) {
      this.logger.warn('Could not call toProxy before init')
    }

    const proxy = new Proxy(this, {
      get: (target, prop) => {
        assertLifecycleMutationAllowed(target, 'pluginRuntime.proxy.get')
        if (Reflect.has(target, prop)) {
          const runtimeValue = Reflect.get(target, prop, target)
          return typeof runtimeValue === 'function' ? runtimeValue.bind(target) : runtimeValue
        }
        const exports = this.#config.exports?.()
        if ({}.hasOwnProperty.call(exports, prop)) {
          return createLifecycleCapabilityBinder(
            target,
            `pluginRuntime.exports.${String(prop)}`,
          )(exports?.[prop as string])
        }
        return undefined
      },
    })
    this.#canonicalProxy = proxy
    inheritLifecycleMutationGuard(this, proxy)
    return proxy
  }
}
