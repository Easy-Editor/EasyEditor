import { Designer } from '../designer/designer'
import { Detecting } from '../designer/detecting'
import { Dragon } from '../designer/dragon'
import { DropLocation } from '../designer/location'
import { OffsetObserver } from '../designer/offset-observer'
import { Selection } from '../designer/selection'
import { Document } from '../document/document'
import { History } from '../document/history'
import { Node } from '../document/node/node'
import { NodeChildren } from '../document/node/node-children'
import { Prop } from '../document/prop/prop'
import { Props } from '../document/prop/props'
import {
  assertLifecycleMutationAllowed,
  assertLifecycleMutationTicket,
  captureLifecycleMutationTicket,
  inheritLifecycleMutationGuard,
  sealLifecycleMutations,
} from '../lifecycle/mutation-barrier'
import { createMutationGuardedMapView } from '../lifecycle/mutation-guarded-map'
import { lockReadonlyProperties } from '../lifecycle/readonly-properties'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import { ComponentMeta } from '../materials/component-meta'
import { Materials } from '../materials/materials'
import { Project } from '../project/project'
import { Setters } from '../setters/setters'
import { Simulator } from '../simulator/simulator'
import { Viewport } from '../simulator/viewport'
import { createLogger } from '../utils'
import type { PluginContextOptions } from './plugin-context'
import { PluginContext } from './plugin-context'
import { bindPluginContextCapabilities } from './plugin-context-boundary'
import {
  type PluginExtend,
  type PluginExtendClass,
  type PrototypeExtensionOperation,
  acquirePrototypeExtensionBatch,
  assertProcessPrototypeExtensionsAllowed,
} from './plugin-extend'
import { installPluginManagerOperations } from './plugin-manager-boundary'
import { PluginRuntime } from './plugin-runtime'
import {
  destroyPluginRuntime,
  getPluginRuntimeConfig,
  getPluginRuntimeExports,
  getPluginRuntimeSnapshot,
  initPluginRuntime,
  markPluginRuntimeExtended,
  preparePluginRuntimeExtension,
  publishPluginRuntimeContext,
  resetPluginRuntimeExtended,
  setPluginRuntimeDisabled,
} from './plugin-runtime-boundary'
import { sequencify } from './sequencify'

const logger = createLogger('PluginManager')

export interface Plugin {
  name: string
  deps?: string[]
  eventPrefix?: string
  /** Stable identity for process-wide prototype extensions. */
  extensionFingerprint?: string
  init(ctx: PluginContext): Promise<void> | void
  destroy?(ctx: PluginContext): Promise<void> | void
  extend?(ctx: PluginExtend): Promise<void> | void
  exports?(): Record<string, any>
}

export interface PluginMeta {
  /**
   * define dependencies which the plugin depends on
   */
  dependencies?: string[]

  /**
   * use 'common' as event prefix when eventPrefix is not set.
   */
  eventPrefix?: string
}

export type PluginCreator<O = any> = (options?: O) => Plugin

export interface PluginRegisterOptions {
  /**
   * Will enable plugin registered with auto-initialization immediately
   * other than plugin-manager init all plugins at certain time.
   * It is helpful when plugin register is later than plugin-manager initialization.
   */
  autoInit?: boolean

  /**
   * allow overriding existing plugin with same name when override === true
   */
  override?: boolean
}

/**
 * Assemble APIs for plugins to create context
 */
export interface PluginContextApiAssembler {
  assembleApis(context: PluginContext, pluginName: string, meta: PluginMeta): void
}

/**
 * Finite host-facing plugin capability.
 *
 * Engine lifecycle orchestration, context assembly, dependency preflight, and
 * the manager's mutable registries stay on `Plugins` and are intentionally not
 * reachable through this facade.
 */
export interface PluginRuntimeSnapshot {
  readonly name: string
  readonly dependencies: readonly string[]
  readonly disabled: boolean
  readonly initialized: boolean
  readonly extended: boolean
}

export interface PluginRegistry {
  readonly size: number
  get(pluginName: string): PluginRuntimeSnapshot | undefined
  getAll(): readonly PluginRuntimeSnapshot[]
  getExports<T extends Record<string, unknown> = Record<string, unknown>>(pluginName: string): Readonly<T> | undefined
  has(pluginName: string): boolean
}

export interface PluginManager extends PluginRegistry {
  register(pluginModel: Plugin, registerOptions?: PluginRegisterOptions): Promise<void>
  registerPlugins(plugins: Plugin[], registerOptions?: PluginRegisterOptions): Promise<void>
  delete(pluginName: string): Promise<boolean>
  setDisabled(pluginName: string, flag?: boolean): void
}

type PluginsTeardownOperation = 'clearContexts' | 'destroy' | 'dispose'

export class Plugins {
  private plugins: PluginRuntime[] = []

  private initialized = false

  private initAttempt: object | undefined = undefined

  private initPromise: Promise<void> | undefined = undefined

  private destroyPromise: Promise<void> | undefined = undefined

  private extendPromise: Promise<void> | undefined = undefined

  private prototypeExtensionOwner: object | undefined = undefined

  private prototypeExtensionRelease: (() => void) | undefined = undefined

  private canonicalProxy: PluginManager | undefined = undefined

  private readonly registeredPlugins = new Map<string, PluginRuntime>()

  private readonly pluginContexts = new Map<string, PluginContext>()

  private readonly structuralReservations = new Map<string, object>()

  private readonly structuralOperations = new Set<Promise<unknown>>()

  private structuralOperationCount = 0

  private structuralRevision = 0

  private destroying = false

  private lifecycleHookInvocationDepth = 0

  readonly pluginsMap = createMutationGuardedMapView(this.registeredPlugins, () => {
    throw new Error('pluginsMap is read-only; use the Plugins registration API')
  })

  readonly pluginContextMap = createMutationGuardedMapView(this.pluginContexts, () => {
    throw new Error('pluginContextMap is read-only; contexts are owned by their PluginRuntime')
  })

  private contextApiAssembler: PluginContextApiAssembler = {
    assembleApis() {},
  }

  private contextOptions: Omit<PluginContextOptions, 'pluginName' | 'meta'> = {}

  private assertPrototypeExtensionsAllowed: (origin: string) => void = () => {}

  constructor(
    contextApiAssembler?: PluginContextApiAssembler,
    contextOptions?: Omit<PluginContextOptions, 'pluginName' | 'meta'>,
    assertPrototypeExtensionsAllowed: (origin: string) => void = () => {},
  ) {
    this.assertPrototypeExtensionsAllowed = assertPrototypeExtensionsAllowed
    if (contextApiAssembler) this.contextApiAssembler = contextApiAssembler
    if (contextOptions) this.contextOptions = contextOptions
    installLifecycleTeardownOperation(this, (operation: PluginsTeardownOperation) => {
      if (operation === 'destroy') return this.#destroyInternal()
      if (operation === 'clearContexts') return this.#clearContextsInternal()
      if (operation === 'dispose') return this.#disposeInternal()
      throw new Error(`Unsupported plugin manager teardown operation: ${String(operation)}`)
    })
    installPluginManagerOperations(this, {
      createFacade: () => this.#getOrCreateFacade(),
      deleteRuntime: runtime => this.#deleteRuntimeInternal(runtime),
      extend: () => this.#extendInternal(),
      getPluginContext: (options, runtime) => this.#getPluginContextInternal(options, runtime),
      hasPrototypeExtensions: () => this.#hasPrototypeExtensionsInternal(),
      init: () => this.#initInternal(),
      isLifecycleHookInvocationActive: () => this.lifecycleHookInvocationDepth > 0,
      preflight: () => this.#preflightInternal(),
      publishPluginContext: (pluginName, runtime, context) =>
        this.#publishPluginContextInternal(pluginName, runtime, context),
      releasePluginContext: (pluginName, context) => this.#releasePluginContextInternal(pluginName, context),
      runLifecycleHook: operation => this.#runLifecycleHookInternal(operation),
    })
    lockReadonlyProperties(this, [
      'assertPrototypeExtensionsAllowed',
      'pluginContextMap',
      'pluginContexts',
      'plugins',
      'pluginsMap',
      'registeredPlugins',
      'structuralOperations',
      'structuralReservations',
    ])
  }

  setContextApiAssembler(contextApiAssembler: PluginContextApiAssembler) {
    assertLifecycleMutationAllowed(this, 'plugins.setContextApiAssembler')
    this.contextApiAssembler = contextApiAssembler
  }

  setContextOptions(contextOptions: Omit<PluginContextOptions, 'pluginName' | 'meta'>) {
    assertLifecycleMutationAllowed(this, 'plugins.setContextOptions')
    this.contextOptions = contextOptions
  }

  getPluginContext(options: PluginContextOptions, runtime: PluginRuntime): PluginContext {
    return this.#getPluginContextInternal(options, runtime)
  }

  #getPluginContextInternal(options: PluginContextOptions, runtime: PluginRuntime): PluginContext {
    const { pluginName } = options
    const isCommittedRuntime = this.registeredPlugins.get(pluginName) === runtime
    let context = isCommittedRuntime ? this.pluginContexts.get(pluginName) : undefined
    if (!context) {
      assertLifecycleMutationAllowed(this, 'plugins.getPluginContext')
      context = new PluginContext({ ...this.contextOptions, ...options }, this.contextApiAssembler)
      context.plugins = this.#createFacade(runtime)
      inheritLifecycleMutationGuard(this, context)
      inheritLifecycleMutationGuard(context, context.pluginEvent)
      inheritEngineTeardownOwnership(runtime, context)
      bindPluginContextCapabilities(context)
      if (isCommittedRuntime) this.pluginContexts.set(pluginName, context)
    }
    return context
  }

  /** @internal Publish a context only for the runtime currently in the registry. */
  publishPluginContext(pluginName: string, runtime: PluginRuntime, context: PluginContext): void {
    this.#publishPluginContextInternal(pluginName, runtime, context)
  }

  #publishPluginContextInternal(pluginName: string, runtime: PluginRuntime, context: PluginContext): void {
    if (this.registeredPlugins.get(pluginName) !== runtime) {
      throw new Error(`Cannot publish context for uncommitted plugin "${pluginName}"`)
    }
    this.pluginContexts.set(pluginName, context)
  }

  /** Internal cleanup hook used by PluginRuntime; deleting cannot revive state. */
  releasePluginContext(pluginName: string, context: PluginContext): void {
    this.#releasePluginContextInternal(pluginName, context)
  }

  #releasePluginContextInternal(pluginName: string, context: PluginContext): void {
    if (this.pluginContexts.get(pluginName) === context) this.pluginContexts.delete(pluginName)
  }

  async #runLifecycleHookInternal<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    this.lifecycleHookInvocationDepth += 1
    try {
      return await operation()
    } finally {
      this.lifecycleHookInvocationDepth -= 1
    }
  }

  /**
   * register a plugin
   * @param pluginConfigCreator - a creator function which returns the plugin config
   * @param options - the plugin options
   * @param registerOptions - the plugin register options
   */
  async register(pluginModel: Plugin, registerOptions?: PluginRegisterOptions): Promise<void> {
    return this.#registerInternal(pluginModel, registerOptions)
  }

  async #registerInternal(pluginModel: Plugin, registerOptions?: PluginRegisterOptions): Promise<void> {
    const ticket = captureLifecycleMutationTicket(this, 'plugins.register')
    const structuralRevision = this.structuralRevision
    const config = pluginModel
    const { name: pluginName } = config
    if (!pluginName) {
      logger.error('pluginConfigCreator.pluginName required', pluginModel)
      return
    }
    return this.#withStructuralReservation(pluginName, () =>
      this.#registerLocked(config, registerOptions, ticket, structuralRevision),
    )
  }

  async #registerLocked(
    config: Plugin,
    registerOptions: PluginRegisterOptions | undefined,
    ticket: ReturnType<typeof captureLifecycleMutationTicket>,
    structuralRevision: number,
  ): Promise<void> {
    assertLifecycleMutationTicket(this, ticket, 'plugins.register.start')
    this.#assertManagerOperationCurrent(structuralRevision, 'plugins.register.start')
    const { name: pluginName, deps = [], eventPrefix } = config
    if (typeof config.extend === 'function') {
      this.assertPrototypeExtensionsAllowed('plugins.register')
    }
    const meta: PluginMeta = { dependencies: deps, eventPrefix }
    const allowOverride = registerOptions?.override === true
    const autoInit = registerOptions?.autoInit === true
    const originalPlugin = this.registeredPlugins.get(pluginName)

    if (originalPlugin && !allowOverride) {
      throw new Error(`Plugin with name ${pluginName} exists`)
    }
    if (autoInit && !this.initialized) {
      throw new Error('Plugin autoInit requires an initialized plugin manager')
    }
    if (autoInit && typeof config.extend === 'function') {
      throw new Error('Prototype-extension plugins cannot use autoInit; restart the engine to preflight them')
    }

    const plugin = new PluginRuntime(pluginName, this, config)
    inheritLifecycleMutationGuard(this, plugin)
    inheritEngineTeardownOwnership(this, plugin)
    let committed = false
    try {
      if (autoInit) {
        const candidatePlugins = originalPlugin
          ? this.plugins.map(existing => (existing === originalPlugin ? plugin : existing))
          : [...this.plugins, plugin]
        this.#preflightPlugins(candidatePlugins)
        await initPluginRuntime(plugin)
        assertLifecycleMutationTicket(this, ticket, 'plugins.register.candidate')
        this.#assertManagerOperationCurrent(structuralRevision, 'plugins.register.candidate')
      }

      if (originalPlugin) {
        logger.log(
          'plugin override, originalPlugin with name ',
          pluginName,
          ' will be destroyed after its replacement is ready, config:',
          getPluginRuntimeConfig(originalPlugin),
        )
        await destroyPluginRuntime(originalPlugin)
        assertLifecycleMutationTicket(this, ticket, 'plugins.register.override.commit')
        this.#assertManagerOperationCurrent(structuralRevision, 'plugins.register.override.commit')
      }

      assertLifecycleMutationTicket(this, ticket, 'plugins.register.commit')
      this.#assertManagerOperationCurrent(structuralRevision, 'plugins.register.commit')
      if (originalPlugin) {
        const index = this.plugins.indexOf(originalPlugin)
        if (index < 0 || this.registeredPlugins.get(pluginName) !== originalPlugin) {
          throw new Error(`Plugin "${pluginName}" changed before its replacement could commit`)
        }
        this.plugins.splice(index, 1, plugin)
      } else {
        this.plugins.push(plugin)
      }
      this.registeredPlugins.set(pluginName, plugin)
      publishPluginRuntimeContext(plugin)
      if (originalPlugin) sealLifecycleMutations(originalPlugin, `plugin runtime "${pluginName}" was replaced`)
      committed = true
      logger.log(`plugin registered with pluginName: ${pluginName}, config: `, config, 'meta:', meta)
    } catch (error) {
      if (committed) throw error
      try {
        await destroyPluginRuntime(plugin)
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Plugin "${pluginName}" registration rollback failed`)
      }
      throw error
    }
  }

  async #withStructuralReservation<T>(pluginName: string, operation: () => Promise<T>): Promise<T> {
    if (this.destroying) throw new Error('Plugin structural operations are blocked while the manager is destroying')
    if (this.structuralReservations.has(pluginName)) {
      throw new Error(`Plugin "${pluginName}" already has a structural operation in progress`)
    }
    if (this.extendPromise) throw new Error('Plugin registration is blocked while extensions are being prepared')
    const reservation = {}
    this.structuralReservations.set(pluginName, reservation)
    this.structuralOperationCount += 1
    const operationPromise = operation()
    this.structuralOperations.add(operationPromise)
    try {
      return await operationPromise
    } finally {
      this.structuralOperations.delete(operationPromise)
      if (this.structuralReservations.get(pluginName) === reservation) {
        this.structuralReservations.delete(pluginName)
        this.structuralOperationCount -= 1
      }
    }
  }

  #assertManagerOperationCurrent(revision: number, origin: string): void {
    if (this.destroying || revision !== this.structuralRevision) {
      throw new Error(`Plugin manager operation "${origin}" was superseded by manager destroy`)
    }
  }

  /**
   * batch register plugins
   */
  async registerPlugins(plugins: Plugin[], registerOptions?: PluginRegisterOptions) {
    return this.#registerPluginsInternal(plugins, registerOptions)
  }

  async #registerPluginsInternal(plugins: Plugin[], registerOptions?: PluginRegisterOptions): Promise<void> {
    assertLifecycleMutationAllowed(this, 'plugins.registerPlugins')
    for (const plugin of plugins) {
      await this.#registerInternal(plugin, registerOptions)
    }
  }

  get(pluginName: string): PluginRuntime | undefined {
    return this.registeredPlugins.get(pluginName)
  }

  getAll() {
    return [...this.plugins]
  }

  has(pluginName: string) {
    return this.registeredPlugins.has(pluginName)
  }

  async delete(pluginName: string): Promise<boolean> {
    return this.#deleteInternal(pluginName)
  }

  async #deleteInternal(pluginName: string): Promise<boolean> {
    const ticket = captureLifecycleMutationTicket(this, 'plugins.delete')
    const structuralRevision = this.structuralRevision
    return this.#withStructuralReservation(pluginName, () => this.#deleteLocked(pluginName, ticket, structuralRevision))
  }

  #deleteRuntimeInternal(runtime: PluginRuntime): Promise<boolean> {
    const pluginName = getPluginRuntimeSnapshot(runtime).name
    const ticket = captureLifecycleMutationTicket(this, 'plugins.deleteRuntime')
    const structuralRevision = this.structuralRevision
    return this.#withStructuralReservation(pluginName, () =>
      this.#deleteLocked(pluginName, ticket, structuralRevision, runtime),
    )
  }

  async #deleteLocked(
    pluginName: string,
    ticket: ReturnType<typeof captureLifecycleMutationTicket>,
    structuralRevision: number,
    expectedRuntime?: PluginRuntime,
  ): Promise<boolean> {
    assertLifecycleMutationTicket(this, ticket, 'plugins.delete.start')
    this.#assertManagerOperationCurrent(structuralRevision, 'plugins.delete.start')
    const plugin = this.registeredPlugins.get(pluginName)
    if (!plugin) return false
    if (expectedRuntime && plugin !== expectedRuntime) return false
    await destroyPluginRuntime(plugin)
    assertLifecycleMutationTicket(this, ticket, 'plugins.delete.commit')
    this.#assertManagerOperationCurrent(structuralRevision, 'plugins.delete.commit')
    if (this.registeredPlugins.get(pluginName) !== plugin) return false
    const idx = this.plugins.indexOf(plugin)
    this.plugins.splice(idx, 1)
    const context = this.pluginContexts.get(pluginName)
    if (context) runInternalLifecycleTeardown(context)
    this.pluginContexts.delete(pluginName)
    const deleted = this.registeredPlugins.delete(pluginName)
    if (deleted) sealLifecycleMutations(plugin, `plugin runtime "${pluginName}" was deleted`)
    return deleted
  }

  async init(): Promise<void> {
    return this.#initInternal()
  }

  async #initInternal(): Promise<void> {
    if (this.initPromise) return this.initPromise
    if (this.destroyPromise) {
      await this.destroyPromise
      return this.#initInternal()
    }
    const initPromise = this.#performInit()
    this.initPromise = initPromise
    try {
      await initPromise
    } finally {
      if (this.initPromise === initPromise) this.initPromise = undefined
    }
  }

  async #performInit(): Promise<void> {
    const ticket = captureLifecycleMutationTicket(this, 'plugins.init')
    const attempt = {}
    this.initAttempt = attempt
    const initialized: PluginRuntime[] = []
    const initializedSet = new Set<PluginRuntime>()
    try {
      while (true) {
        const sequence = this.#preflightInternal()
        logger.log('load plugin sequence:', sequence)
        for (const pluginName of sequence) {
          const plugin = this.registeredPlugins.get(pluginName)!
          if (getPluginRuntimeSnapshot(plugin).initialized) continue
          await initPluginRuntime(plugin)
          assertLifecycleMutationTicket(this, ticket, 'plugins.init.commit')
          if (this.initAttempt !== attempt) throw new Error('Plugin initialization was superseded by another lifecycle')
          if (getPluginRuntimeSnapshot(plugin).initialized && !initializedSet.has(plugin)) {
            initializedSet.add(plugin)
            initialized.push(plugin)
          }
        }

        const structuralOperations = [...this.structuralOperations]
        if (structuralOperations.length > 0) {
          await Promise.allSettled(structuralOperations)
          assertLifecycleMutationTicket(this, ticket, 'plugins.init.structuralOperations')
          if (this.initAttempt !== attempt) throw new Error('Plugin initialization was superseded by another lifecycle')
          continue
        }

        assertLifecycleMutationTicket(this, ticket, 'plugins.init.commit')
        if (this.initAttempt !== attempt) throw new Error('Plugin initialization was superseded by another lifecycle')
        if (this.plugins.every(plugin => getPluginRuntimeSnapshot(plugin).initialized)) break
      }
      this.initialized = true
    } catch (error) {
      if (this.initAttempt !== attempt) throw error
      this.initialized = false
      const rollbackErrors: unknown[] = []
      for (const plugin of initialized.reverse()) {
        try {
          await destroyPluginRuntime(plugin)
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      if (rollbackErrors.length) {
        const message = error instanceof Error ? error.message : String(error)
        const aggregate = new AggregateError(
          [error, ...rollbackErrors],
          `Plugin initialization failed: ${message}; rollback also failed`,
        )
        throw aggregate
      }
      throw error
    } finally {
      if (this.initAttempt === attempt) this.initAttempt = undefined
    }
  }

  preflight(): string[] {
    return this.#preflightInternal()
  }

  #preflightInternal(): string[] {
    return this.#preflightPlugins(this.plugins)
  }

  #preflightPlugins(plugins: readonly PluginRuntime[]): string[] {
    const pluginNames: string[] = []
    const pluginObj: Record<string, { name: string; deps: string[] }> = {}
    plugins.forEach(plugin => {
      const snapshot = getPluginRuntimeSnapshot(plugin)
      pluginNames.push(snapshot.name)
      pluginObj[snapshot.name] = { deps: [...snapshot.dependencies], name: snapshot.name }
    })

    // check plugin dependency
    const { missingTasks, recursiveDependencies, sequence } = sequencify(pluginObj, pluginNames)
    if (missingTasks.length) {
      throw new Error(`Plugin dependency missing: ${missingTasks.join(', ')}`)
    }
    if (recursiveDependencies.length) {
      throw new Error(
        `Plugin dependency cycle detected: ${recursiveDependencies.map(items => items.join(' -> ')).join(', ')}`,
      )
    }
    return sequence
  }

  /**
   * destroy all plugins
   */
  async destroy(): Promise<void> {
    assertPublicLifecycleTeardownAllowed(this, 'plugins.destroy')
    return this.#destroyInternal()
  }

  async #destroyInternal(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise
    this.destroying = true
    this.structuralRevision += 1
    this.initAttempt = undefined
    this.initPromise = undefined
    const destroyPromise = this.#performDestroy([...this.structuralOperations], this.extendPromise)
    this.destroyPromise = destroyPromise
    try {
      await destroyPromise
    } finally {
      if (this.destroyPromise === destroyPromise) {
        this.destroyPromise = undefined
        this.destroying = false
      }
    }
  }

  async #performDestroy(
    structuralOperations: readonly Promise<unknown>[],
    extendPromise: Promise<void> | undefined,
  ): Promise<void> {
    await Promise.allSettled(extendPromise ? [...structuralOperations, extendPromise] : structuralOperations)
    const errors: unknown[] = []
    for (const plugin of [...this.plugins].reverse()) {
      try {
        await destroyPluginRuntime(plugin)
      } catch (error) {
        errors.push(error)
      }
    }
    if (this.prototypeExtensionRelease) {
      try {
        this.prototypeExtensionRelease()
        this.prototypeExtensionRelease = undefined
        this.prototypeExtensionOwner = undefined
        this.plugins.forEach(plugin => resetPluginRuntimeExtended(plugin))
      } catch (error) {
        errors.push(error)
      }
    }
    this.initialized = false
    if (errors.length) {
      throw new AggregateError(errors, 'One or more plugins failed to destroy')
    }
  }

  async extend(): Promise<void> {
    return this.#extendInternal()
  }

  async #extendInternal(): Promise<void> {
    if (this.extendPromise) return this.extendPromise
    if (this.destroyPromise) {
      await this.destroyPromise
      return this.#extendInternal()
    }
    const structuralRevision = this.structuralRevision
    const extendPromise = this.#performExtend(structuralRevision)
    this.extendPromise = extendPromise
    try {
      await extendPromise
    } finally {
      if (this.extendPromise === extendPromise) this.extendPromise = undefined
    }
  }

  async #performExtend(structuralRevision: number): Promise<void> {
    const ticket = captureLifecycleMutationTicket(this, 'plugins.extend')
    this.#assertManagerOperationCurrent(structuralRevision, 'plugins.extend.start')
    if (this.structuralOperationCount > 0) {
      throw new Error('Plugin extension is blocked while a structural operation is in progress')
    }
    if (this.#hasPrototypeExtensionsInternal()) {
      this.assertPrototypeExtensionsAllowed('plugins.extend')
      assertProcessPrototypeExtensionsAllowed()
    }
    const extendClass: PluginExtendClass = {
      Simulator,
      Viewport,

      Designer,
      Dragon,
      Detecting,
      Selection,
      DropLocation,
      OffsetObserver,

      Project,
      Document,
      History,
      Node,
      NodeChildren,
      Props,
      Prop,

      Materials,
      Setters,
      ComponentMeta,
    }
    const extendMap: Record<keyof PluginExtendClass, PluginExtendClass[keyof PluginExtendClass]> = extendClass

    const operations: PrototypeExtensionOperation[] = []
    const preparedPlugins: PluginRuntime[] = []
    for (const plugin of this.plugins) {
      const snapshot = getPluginRuntimeSnapshot(plugin)
      const extensionFingerprint =
        getPluginRuntimeConfig(plugin).extensionFingerprint ||
        `${snapshot.name}:${
          typeof getPluginRuntimeConfig(plugin).extend === 'function'
            ? Function.prototype.toString.call(getPluginRuntimeConfig(plugin).extend)
            : 'no-extension'
        }`
      const prepared = await preparePluginRuntimeExtension(plugin, {
        extendClass,
        extend: (targetClass, properties) =>
          operations.push({
            extendClass: targetClass,
            // The public API preserves the target-specific generic; the batch
            // stores the same runtime class map for deferred atomic application.
            extendMap: extendMap as any,
            properties,
            registration: {
              fingerprint: extensionFingerprint,
              pluginName: snapshot.name,
            },
          }),
      })
      this.#assertManagerOperationCurrent(structuralRevision, 'plugins.extend.prepare')
      if (prepared) preparedPlugins.push(plugin)
    }
    assertLifecycleMutationTicket(this, ticket, 'plugins.extend.commit')
    this.#assertManagerOperationCurrent(structuralRevision, 'plugins.extend.commit')
    if (operations.length > 0) {
      const owner = this.prototypeExtensionOwner || {}
      const release = acquirePrototypeExtensionBatch(operations, owner)
      this.prototypeExtensionOwner = owner
      this.prototypeExtensionRelease = release
    }
    preparedPlugins.forEach(plugin => markPluginRuntimeExtended(plugin))
  }

  hasPrototypeExtensions(): boolean {
    return this.#hasPrototypeExtensionsInternal()
  }

  #hasPrototypeExtensionsInternal(): boolean {
    return this.plugins.some(plugin => typeof getPluginRuntimeConfig(plugin).extend === 'function')
  }

  clearContexts(): void {
    assertPublicLifecycleTeardownAllowed(this, 'plugins.clearContexts')
    this.#clearContextsInternal()
  }

  #clearContextsInternal(): void {
    const errors: unknown[] = []
    for (const context of this.pluginContexts.values()) {
      try {
        runInternalLifecycleTeardown(context)
      } catch (error) {
        errors.push(error)
      }
    }
    this.pluginContexts.clear()
    if (errors.length) {
      throw new AggregateError(errors, 'One or more plugin contexts failed to dispose')
    }
  }

  get size() {
    return this.registeredPlugins.size
  }

  setDisabled(pluginName: string, flag = true) {
    this.#setDisabledInternal(pluginName, flag)
  }

  #setDisabledInternal(pluginName: string, flag = true): void {
    assertLifecycleMutationAllowed(this, 'plugins.setDisabled')
    logger.warn(`plugin:${pluginName} has been set disable:${flag}`)
    const runtime = this.registeredPlugins.get(pluginName)
    if (runtime) setPluginRuntimeDisabled(runtime, flag)
  }

  /**
   * reset plugin manager
   */
  async dispose() {
    assertPublicLifecycleTeardownAllowed(this, 'plugins.dispose')
    return this.#disposeInternal()
  }

  async #disposeInternal(): Promise<void> {
    let destroyError: unknown
    let contextError: unknown
    try {
      await this.#destroyInternal()
    } catch (error) {
      destroyError = error
    } finally {
      try {
        this.#clearContextsInternal()
      } catch (error) {
        contextError = error
      }
      this.plugins.length = 0
      this.registeredPlugins.clear()
    }
    const errors = [destroyError, contextError].filter(error => error !== undefined)
    if (errors.length) {
      throw new AggregateError(errors, 'Plugin manager failed to dispose cleanly')
    }
  }

  toProxy(): PluginManager {
    return this.#getOrCreateFacade()
  }

  #getOrCreateFacade(): PluginManager {
    assertLifecycleMutationAllowed(this, 'plugins.toProxy')
    if (this.canonicalProxy) return this.canonicalProxy
    this.canonicalProxy = this.#createFacade()
    return this.canonicalProxy
  }

  #createFacade(contextRuntime?: PluginRuntime): PluginManager {
    const contextRuntimeName = contextRuntime ? getPluginRuntimeSnapshot(contextRuntime).name : undefined
    const resolveRuntime = (pluginName: string): PluginRuntime | undefined =>
      pluginName === contextRuntimeName ? contextRuntime : this.registeredPlugins.get(pluginName)
    const createSnapshot = (runtime: PluginRuntime): PluginRuntimeSnapshot => getPluginRuntimeSnapshot(runtime)
    const resolveSnapshot = (pluginName: string): PluginRuntimeSnapshot | undefined => {
      const runtime = resolveRuntime(pluginName)
      return runtime ? createSnapshot(runtime) : undefined
    }
    const getAllRuntimes = (): PluginRuntime[] => {
      const current = [...this.plugins]
      if (!contextRuntime) return current
      const original = this.registeredPlugins.get(contextRuntimeName!)
      return original
        ? current.map(plugin => (plugin === original ? contextRuntime : plugin))
        : [...current, contextRuntime]
    }
    const getAll = (): readonly PluginRuntimeSnapshot[] => Object.freeze(getAllRuntimes().map(createSnapshot))
    const getExports = <T extends Record<string, unknown> = Record<string, unknown>>(
      pluginName: string,
    ): Readonly<T> | undefined => {
      const runtime = resolveRuntime(pluginName)
      if (!runtime || getPluginRuntimeSnapshot(runtime).disabled) return undefined
      return getPluginRuntimeExports(runtime) as Readonly<T> | undefined
    }

    const target = Object.create(null) as PluginRegistry & Partial<PluginManager>
    Object.defineProperties(target, {
      get: { enumerable: true, value: resolveSnapshot },
      getAll: { enumerable: true, value: getAll },
      getExports: { enumerable: true, value: getExports },
      has: {
        enumerable: true,
        value: (pluginName: string) => pluginName === contextRuntimeName || this.registeredPlugins.has(pluginName),
      },
      size: { enumerable: true, get: () => this.registeredPlugins.size },
    })
    if (!contextRuntime) {
      Object.defineProperties(target, {
        delete: { enumerable: true, value: (pluginName: string) => this.#deleteInternal(pluginName) },
        register: {
          enumerable: true,
          value: (pluginModel: Plugin, registerOptions?: PluginRegisterOptions) =>
            this.#registerInternal(pluginModel, registerOptions),
        },
        registerPlugins: {
          enumerable: true,
          value: (plugins: Plugin[], registerOptions?: PluginRegisterOptions) =>
            this.#registerPluginsInternal(plugins, registerOptions),
        },
        setDisabled: {
          enumerable: true,
          value: (pluginName: string, flag?: boolean) => this.#setDisabledInternal(pluginName, flag),
        },
      })
    }
    Object.freeze(target)

    const proxy = new Proxy(target, {
      get(facade, property, receiver) {
        if (Object.hasOwn(facade, property)) return Reflect.get(facade, property, receiver)
        if (typeof property !== 'string') return undefined
        return getExports(property)
      },
      getOwnPropertyDescriptor(facade, property) {
        return Reflect.getOwnPropertyDescriptor(facade, property)
      },
      has(facade, property) {
        return Object.hasOwn(facade, property)
      },
      ownKeys(facade) {
        return Reflect.ownKeys(facade)
      },
    })
    inheritLifecycleMutationGuard(this, proxy)
    return proxy as PluginManager
  }
}

export const isRegisterOptions = (opts: any): opts is PluginRegisterOptions => {
  return opts && ('autoInit' in opts || 'override' in opts)
}
