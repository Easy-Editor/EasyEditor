import EventEmitter from 'events'
import { runInAction } from 'mobx'
import { CommandManager, TransactionCommittedError, TransactionManager } from '../commands'
import { isTransactionBoundaryActive, transactionManagerConstructionAuthority } from '../commands/transaction-boundary'
import { Config, type ConfigOptions } from '../config'
import { Clipboard } from '../designer/clipboard'
import { Designer } from '../designer/designer'
import type { Document } from '../document'
import { DisposalLedger } from '../lifecycle'
import {
  advanceLifecycleMutationEpoch,
  hasLifecycleMutationOwner,
  installLifecycleMutationGuard,
  sharesLifecycleMutationOwner,
} from '../lifecycle/mutation-barrier'
import { lockReadonlyProperties } from '../lifecycle/readonly-properties'
import { claimEngineTeardownOwnership, runInternalLifecycleTeardown } from '../lifecycle/teardown-boundary'
import { ComponentMeta, MaterialRegistry, Materials } from '../materials'
import {
  type PluginContext,
  type PluginContextApiAssembler,
  type PluginManager,
  type PluginMeta,
  Plugins,
  establishRestrictedPluginBoundary,
  getProcessPrototypeExtensionIntegrityIssues,
  hasProcessPrototypeExtensions,
} from '../plugin'
import {
  blockPluginContextTargetProperties,
  installPluginContextBlockedPropertyResolver,
} from '../plugin/plugin-context-boundary'
import {
  createPluginManagerFacade,
  extendPluginManager,
  initPluginManager,
  isPluginLifecycleHookInvocationActive,
  pluginManagerHasPrototypeExtensions,
  preflightPluginManager,
} from '../plugin/plugin-manager-boundary'
import { createRestrictedPluginContextCapabilities } from '../plugin/restricted-context-capabilities'
import {
  ProjectMutationCommittedError,
  isProjectCallbackInvocationActive,
  withProjectMutationAuthority,
} from '../project/mutation-authority'
import { LoadingStateManager } from '../remote/state/loading-state'
import { ResourceRegistry } from '../remote/state/resource-registry'
import { SchemaValidator } from '../schema'
import { Setters } from '../setters'
import { PolicyViolation, type TrustPolicy, type TrustPolicyPreset, resolveTrustPolicy } from '../trust'
import type { ProjectSchema } from '../types'
import { Event } from '../utils/event'
import { EventBus } from '../utils/event-bus'
import { claimEngineEventBusDeliveryScheduler } from '../utils/event-bus-boundary'
import { EventTransactionCoordinator } from '../utils/event-transaction'
import { Hotkey } from '../utils/hotkey'
import { createLogger } from '../utils/logger'
import { Editor } from './editor'

export type EngineLifecycleState = 'created' | 'initializing' | 'ready' | 'disposing' | 'disposed' | 'failed'

const engineLifecycleStates = new WeakMap<EngineInstance, EngineLifecycleState>()

const engineInnerPlugins = new WeakMap<EngineInstance, Plugins>()

const allowedEngineLifecycleTransitions: Readonly<Record<EngineLifecycleState, ReadonlySet<EngineLifecycleState>>> = {
  created: new Set(['disposing', 'initializing']),
  disposing: new Set(['disposed', 'failed']),
  disposed: new Set(['initializing']),
  failed: new Set(['disposing']),
  initializing: new Set(['created', 'failed', 'ready']),
  ready: new Set(['disposing']),
}

const getEngineLifecycleState = (engine: EngineInstance): EngineLifecycleState => {
  const state = engineLifecycleStates.get(engine)
  if (!state) throw new Error('Engine lifecycle state is not initialized')
  return state
}

interface DeferredPromise<T> {
  readonly promise: Promise<T>
  readonly reject: (reason?: unknown) => void
  readonly resolve: (value: T | PromiseLike<T>) => void
}

const createDeferredPromise = <T>(): DeferredPromise<T> => {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    reject = innerReject
    resolve = innerResolve
  })
  return { promise, reject, resolve }
}

const restrictedAuthorityReferenceProperties = new Set<PropertyKey>([
  'clipboard',
  'commands',
  'config',
  'designer',
  'editor',
  'emitter',
  'engine',
  'eventBus',
  'hotkey',
  'materials',
  'plugins',
  'project',
  'registry',
  'remote',
  'setters',
  'transactions',
  'waits',
])

const pluginComponentMetaCapabilityProperties = new Set<PropertyKey>([
  'advanced',
  'componentName',
  'configure',
  'descriptor',
  'getMetadata',
  'icon',
  'isComponentMeta',
  'isContainer',
  'isMinimalRenderUnit',
  'isRemoteMaterial',
  'npm',
  'onMetadataChange',
  'snippets',
  'title',
])

export interface RemoteAccessRequest {
  name: string
  type: string
  url?: string
  [key: string]: unknown
}

export interface RemoteAdapter {
  /**
   * Trusted host callback. It must not call this Engine's init/destroy methods;
   * lifecycle requests remain blocked for the callback's full async lifetime.
   */
  init?(): void | Promise<void>
  request?(request: RemoteAccessRequest): unknown
  /** @see RemoteAdapter.init */
  dispose?(): void | Promise<void>
}

interface EngineServices {
  clipboard: Clipboard
  config: Config
  eventBus: EventBus
  loadingState: LoadingStateManager
  registry: ResourceRegistry
}

export interface EngineInstanceOptions {
  hostWindow?: Window | null
  remoteAdapter?: RemoteAdapter
  trustPolicy?: TrustPolicyPreset | TrustPolicy
}

interface EngineInstanceConstructionOptions extends EngineInstanceOptions {
  /** Package-private compatibility injection used by the legacy default facade. */
  services?: Partial<EngineServices>
}

/**
 * Host-owned EasyEditor engine contract.
 *
 * Instances are created exclusively through `createEngine()`. Concrete
 * construction, compatibility service injection, and lifecycle guards remain
 * implementation details rather than framework dependencies.
 */
export interface EngineInstance {
  readonly lifecycleState: EngineLifecycleState
  readonly trustPolicy: TrustPolicy
  readonly config: Config
  readonly editor: Editor
  readonly designer: Designer
  readonly project: Designer['project']
  readonly hotkey: Hotkey
  readonly clipboard: Clipboard
  readonly setters: Setters
  readonly materials: Materials
  readonly eventBus: EventBus
  readonly event: Event
  readonly logger: ReturnType<typeof createLogger>
  readonly plugins: PluginManager
  readonly remote: {
    readonly registry: ResourceRegistry
    readonly loadingState: LoadingStateManager
    readonly request: (request: RemoteAccessRequest) => unknown
  }
  readonly transactions: TransactionManager
  readonly commands: CommandManager

  init(options?: ConfigOptions): Promise<void>
  destroy(): Promise<void>
  loadProject(schema?: ProjectSchema, autoOpen?: boolean | string): void
  unloadProject(): void
  undo(documentOrId?: Document | string): void
  redo(documentOrId?: Document | string): void
}

const appendFlattenedErrors = (target: unknown[], error: unknown): void => {
  if (error instanceof AggregateError) {
    for (const cause of error.errors) appendFlattenedErrors(target, cause)
    return
  }
  target.push(error)
}

class EngineInstanceImpl implements EngineInstance {
  get lifecycleState(): EngineLifecycleState {
    return getEngineLifecycleState(this)
  }

  readonly trustPolicy: TrustPolicy

  readonly config: Config

  readonly editor: Editor

  readonly designer: Designer

  readonly project: Designer['project']

  readonly hotkey: Hotkey

  readonly clipboard: Clipboard

  readonly setters: Setters

  readonly materials: Materials

  readonly eventBus: EventBus

  readonly event: Event

  readonly logger = createLogger('common')

  readonly plugins: PluginManager

  readonly remote: {
    readonly registry: ResourceRegistry
    readonly loadingState: LoadingStateManager
    readonly request: (request: RemoteAccessRequest) => unknown
  }

  readonly transactions: TransactionManager

  readonly commands: CommandManager

  readonly #hostWindow?: Window | null

  readonly #remoteAdapter?: RemoteAdapter

  readonly #eventTransactions = new EventTransactionCoordinator()

  #initScope?: DisposalLedger

  #initPromise?: Promise<void>

  #destroyPromise?: Promise<void>

  #remoteAdapterActive = false

  #remoteLifecycleHookInvocationDepth = 0

  #hostModelMutationDepth = 0

  #restrictedPluginBoundaryRelease?: () => void

  readonly #innerPlugins: Plugins

  readonly #assertLifecycleMutationAllowed = (origin: string): void => {
    const state = getEngineLifecycleState(this)
    if (state === 'disposing' || state === 'disposed' || state === 'failed') {
      throw new Error(`Cannot ${origin} while engine is ${state}`)
    }
  }

  constructor(options: EngineInstanceConstructionOptions = {}) {
    engineLifecycleStates.set(this, 'created')
    Object.defineProperty(this, 'lifecycleState', {
      configurable: false,
      enumerable: true,
      get: () => getEngineLifecycleState(this),
    })
    this.trustPolicy = resolveTrustPolicy(options.trustPolicy)
    this.#ensureRestrictedPluginBoundary('engine.constructor')
    try {
      this.config = options.services?.config || new Config()
      this.eventBus = options.services?.eventBus || new EventBus(new EventEmitter())
      claimEngineEventBusDeliveryScheduler(this.eventBus, this.#eventTransactions.defer)
      this.event = new Event(this.eventBus, { prefix: 'common' })
      this.hotkey = new Hotkey()
      this.clipboard = options.services?.clipboard || new Clipboard()
      this.editor = new Editor(undefined, this.config, this.#eventTransactions.defer)
      this.editor.set('trustPolicy', this.trustPolicy)

      const schemaValidator = new SchemaValidator(this.trustPolicy, origin =>
        this.#assertTrustBoundaryIntegrity(origin),
      )
      this.designer = new Designer({
        editor: this.editor,
        eventDelivery: this.#eventTransactions.defer,
        schemaValidator,
      })
      this.project = this.designer.project
      this.setters = new Setters()
      this.materials = new Materials(this.editor)

      this.#remoteAdapter = options.remoteAdapter
      this.#remoteAdapterActive = !!this.#remoteAdapter
      const registry = options.services?.registry || new ResourceRegistry()
      const remoteLoadingState = options.services?.loadingState || new LoadingStateManager()
      this.remote = Object.freeze({
        loadingState: remoteLoadingState,
        registry,
        request: request => {
          this.#assertRemoteAccess(request)
          return this.#remoteAdapter?.request?.(request)
        },
      })

      const pluginContextApiAssembler: PluginContextApiAssembler = {
        assembleApis: (context: PluginContext, pluginName: string, meta: PluginMeta) => {
          blockPluginContextTargetProperties(context, this, new Set(['destroy', 'init']))
          const eventPrefix = meta?.eventPrefix || 'common'
          const event = new Event(this.eventBus, { prefix: eventPrefix })
          const logger = createLogger(`plugin:${pluginName}`)
          if (this.trustPolicy.name === 'legacyTrusted') {
            context.engine = this
            context.hotkey = this.hotkey
            context.clipboard = this.clipboard
            context.project = this.project
            context.setters = this.setters
            context.materials = this.materials
            context.event = event
            context.config = this.config
            context.logger = logger
          } else {
            const restrictedRoots = new Set<object>([
              this,
              this.clipboard,
              this.commands,
              this.config,
              this.designer,
              this.editor,
              this.eventBus,
              this.hotkey,
              this.materials,
              this.plugins,
              this.project,
              this.remote,
              this.remote.loadingState,
              this.remote.registry,
              this.setters,
              this.#innerPlugins,
              this.transactions,
            ])
            installPluginContextBlockedPropertyResolver(context, (target, property) => {
              // Component metadata is the one reviewed engine-owned value
              // returned by the finite materials capability. Keep that value
              // useful while withholding teardown and implementation details.
              if (target instanceof ComponentMeta) {
                if (hasLifecycleMutationOwner(target) && !sharesLifecycleMutationOwner(this, target)) return true
                return !pluginComponentMetaCapabilityProperties.has(property)
              }

              // A raw engine/service delivered through a host callback is not
              // a plugin capability. Plugins already receive the reviewed
              // finite facade for each supported root above, so raw roots are
              // opaque instead of being re-synthesized ad hoc here.
              if (restrictedRoots.has(target) || hasLifecycleMutationOwner(target)) return true
              if (!restrictedAuthorityReferenceProperties.has(property)) return false

              let value: unknown
              try {
                value = Reflect.get(target, property, target)
              } catch {
                return false
              }
              if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false
              return (
                restrictedRoots.has(value as object) ||
                value instanceof EventBus ||
                value instanceof MaterialRegistry ||
                value instanceof Plugins
              )
            })
            const capabilities = createRestrictedPluginContextCapabilities({
              clipboard: this.clipboard,
              config: this.config,
              event,
              hotkey: this.hotkey,
              logger,
              materials: this.materials,
              project: this.project,
              setters: this.setters,
            })
            context.clipboard = capabilities.clipboard
            context.config = capabilities.config
            context.event = capabilities.event
            context.hotkey = capabilities.hotkey
            context.logger = capabilities.logger
            context.materials = capabilities.materials
            context.project = capabilities.project
            context.setters = capabilities.setters
          }
          context.trustPolicy = this.trustPolicy
        },
      }

      this.#innerPlugins = new Plugins(
        pluginContextApiAssembler,
        { eventDelivery: this.#eventTransactions.defer },
        origin => this.#assertPluginExtensionsAllowed(origin),
      )
      this.plugins = createPluginManagerFacade(this.#innerPlugins)

      const engine = this
      const transactionHost = Object.freeze({
        assertCompositionMutationAllowed: (origin: string) => this.#assertHostCompositionMutationAllowed(origin),
        assertTrustBoundaryIntegrity: (origin: string) => this.#assertTrustBoundaryIntegrity(origin),
        get lifecycleState() {
          return engine.lifecycleState
        },
        materials: this.materials,
        project: this.project,
        trustPolicy: this.trustPolicy,
      })
      this.transactions = new TransactionManager(
        transactionHost,
        this.#eventTransactions,
        transactionManagerConstructionAuthority,
      )
      this.commands = new CommandManager(this.transactions, transactionManagerConstructionAuthority)
      engineInnerPlugins.set(this, this.#innerPlugins)
      this.#wireEditorContext()

      this.#hostWindow = options.hostWindow
      this.#claimLifecycleMutationOwnership()
      lockReadonlyProperties(this, [
        'clipboard',
        'commands',
        'config',
        'designer',
        'editor',
        'event',
        'eventBus',
        'hotkey',
        'logger',
        'materials',
        'plugins',
        'project',
        'remote',
        'setters',
        'transactions',
        'trustPolicy',
      ])
    } catch (error) {
      this.#releaseRestrictedPluginBoundary()
      throw error
    }
  }

  init(options?: ConfigOptions): Promise<void> {
    this.#assertLifecycleRequestOutsideLifecycleHook('init')
    this.#assertNoActiveTransaction('initialize')
    return this.#requestInit(options)
  }

  async #requestInit(options?: ConfigOptions): Promise<void> {
    const state = this.lifecycleState
    if (state === 'ready') return
    if (state === 'initializing' || this.#initPromise) {
      this.#throwLifecycleConflict('init', 'initialization is already in progress')
    }
    if (state === 'disposing' || this.#destroyPromise) {
      this.#throwLifecycleConflict('init', 'disposal is in progress; wait for destroy() and retry explicitly')
    }
    if (state === 'failed') {
      this.#throwLifecycleConflict('init', 'the failed generation must be destroyed before it can restart')
    }

    this.#ensureRestrictedPluginBoundary('engine.init')

    const deferredInit = createDeferredPromise<void>()
    const initPromise = deferredInit.promise
    this.#initPromise = initPromise
    void this.#initialize(options).then(deferredInit.resolve, deferredInit.reject)
    try {
      await initPromise
    } finally {
      if (this.#initPromise === initPromise) this.#initPromise = undefined
    }
  }

  async #initialize(options?: ConfigOptions): Promise<void> {
    this.#transitionLifecycle('initializing')
    this.#initScope = new DisposalLedger()
    try {
      if (options) this.config.setEngineOptions(options)
      this.#wireEditorContext()
      this.designer.mount()
      this.#assertTrustBoundaryIntegrity('engine.init')

      if (!this.trustPolicy.allowPluginExtensions && pluginManagerHasPrototypeExtensions(this.#innerPlugins)) {
        throw new PolicyViolation({
          capability: 'plugin.extension',
          message: 'Plugin prototype extensions are disabled by the engine trust policy',
          origin: 'engine.init',
          rule: `${this.trustPolicy.name}.plugin.extension.deny`,
        })
      }

      preflightPluginManager(this.#innerPlugins)
      if (this.#remoteAdapter?.dispose) {
        this.#remoteAdapterActive = true
        this.#initScope.add(() => this.#disposeRemoteAdapter(), 'engine.remoteAdapter')
      }
      await this.#runRemoteLifecycleHook(() => this.#remoteAdapter?.init?.())

      const hostWindow = this.#resolveHostWindow()
      if (hostWindow) {
        this.#initScope.add(this.hotkey.mount(hostWindow), 'engine.hotkey')
      }

      await extendPluginManager(this.#innerPlugins)
      await initPluginManager(this.#innerPlugins)
      this.#transitionLifecycle('ready')
      this.logger.info('Engine initialization successfully')
    } catch (error) {
      const rollbackErrors: unknown[] = []
      try {
        await runInternalLifecycleTeardown<['destroy'], Promise<void>>(this.#innerPlugins, 'destroy')
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      try {
        await this.#initScope.dispose()
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      // A multi-listener mount can fail before its returned disposer reaches
      // initScope. The Hotkey owns provisional registrations itself, so always
      // include its root cleanup in initialization rollback. Any incomplete
      // cleanup leaves the engine failed and forces destroy() before retry.
      try {
        runInternalLifecycleTeardown(this.hotkey)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      this.#initScope = undefined
      this.#transitionLifecycle(rollbackErrors.length ? 'failed' : 'created')
      if (rollbackErrors.length) {
        throw new AggregateError([error, ...rollbackErrors], 'Engine initialization and rollback both failed')
      }
      throw error
    }
  }

  destroy(): Promise<void> {
    this.#assertLifecycleRequestOutsideLifecycleHook('destroy')
    this.#assertNoActiveTransaction('destroy')
    return this.#requestDestroy()
  }

  async #requestDestroy(): Promise<void> {
    const state = this.lifecycleState
    if (state === 'disposed') return
    if (state === 'disposing' || this.#destroyPromise) {
      this.#throwLifecycleConflict('destroy', 'disposal is already in progress')
    }
    if (state === 'initializing' || this.#initPromise) {
      this.#throwLifecycleConflict('destroy', 'initialization is in progress; wait for init() and retry explicitly')
    }
    const deferredDestroy = createDeferredPromise<void>()
    const destroyPromise = deferredDestroy.promise
    this.#destroyPromise = destroyPromise
    void this.#disposeEngine().then(deferredDestroy.resolve, deferredDestroy.reject)
    try {
      await destroyPromise
    } finally {
      if (this.#destroyPromise === destroyPromise) this.#destroyPromise = undefined
    }
  }

  /** Validate and replace the project through the engine-owned host boundary. */
  loadProject(schema?: ProjectSchema, autoOpen?: boolean | string): void {
    this.#runHostModelMutation('engine.loadProject', () => this.project.load(schema, autoOpen))
  }

  /** Remove all project documents through the engine-owned host boundary. */
  unloadProject(): void {
    this.#runHostModelMutation('engine.unloadProject', () => this.project.unload())
  }

  /** Undo one committed history unit without exposing raw History mutation authority. */
  undo(documentOrId?: Document | string): void {
    this.#runHostModelMutation('engine.undo', () => this.#resolveOwnedDocument(documentOrId).history.back())
  }

  /** Redo one committed history unit without exposing raw History mutation authority. */
  redo(documentOrId?: Document | string): void {
    this.#runHostModelMutation('engine.redo', () => this.#resolveOwnedDocument(documentOrId).history.forward())
  }

  async #disposeEngine(): Promise<void> {
    this.#transitionLifecycle('disposing')
    const failures: unknown[] = []
    const cleanup = async (operation: () => void | Promise<void>) => {
      try {
        await operation()
      } catch (error) {
        failures.push(error)
      }
    }

    const initScope = this.#initScope
    await cleanup(() => initScope?.dispose())
    this.#initScope = undefined
    // The mounted renderer depends on both plugin-provided helpers and the
    // Designer. Settle that UI generation before revoking either dependency.
    await cleanup(() => runInternalLifecycleTeardown<['simulator'], Promise<void>>(this.project, 'simulator'))
    await cleanup(() => runInternalLifecycleTeardown<['destroy'], Promise<void>>(this.#innerPlugins, 'destroy'))
    await cleanup(() => runInternalLifecycleTeardown(this.designer))
    await cleanup(() => runInternalLifecycleTeardown<['model'], Promise<void>>(this.project, 'model'))
    if (!initScope) {
      await cleanup(() => this.#disposeRemoteAdapter())
    }
    await cleanup(() => runInternalLifecycleTeardown(this.hotkey))
    await cleanup(() => runInternalLifecycleTeardown(this.clipboard))
    await cleanup(() => runInternalLifecycleTeardown(this.materials))
    await cleanup(() => runInternalLifecycleTeardown(this.setters))
    await cleanup(() => runInternalLifecycleTeardown(this.remote.loadingState))
    await cleanup(() => runInternalLifecycleTeardown(this.remote.registry))
    await cleanup(() => runInternalLifecycleTeardown<['clearContexts']>(this.#innerPlugins, 'clearContexts'))
    await cleanup(() => runInternalLifecycleTeardown(this.editor))
    await cleanup(() => runInternalLifecycleTeardown(this.eventBus))
    await cleanup(() => runInternalLifecycleTeardown(this.config, { preserve: ['VERSION'] }))

    if (failures.length > 0) {
      this.#transitionLifecycle('failed')
      throw new AggregateError(failures, 'Engine disposal completed with errors')
    }
    this.#releaseRestrictedPluginBoundary()
    this.#transitionLifecycle('disposed')
    this.logger.info('Engine destruction successfully')
  }

  #assertTrustBoundaryIntegrity(origin: string): void {
    if (this.trustPolicy.allowPluginExtensions) return
    const issues = getProcessPrototypeExtensionIntegrityIssues()
    if (!issues.length && !hasProcessPrototypeExtensions()) return
    throw new PolicyViolation({
      capability: 'plugin.extension',
      details: issues,
      message: 'A restricted engine cannot share a realm with process-wide prototype extensions',
      origin,
      rule: `${this.trustPolicy.name}.plugin.extension.integrity`,
    })
  }

  #assertLifecycleRequestOutsideLifecycleHook(operation: 'destroy' | 'init'): void {
    if (
      !isPluginLifecycleHookInvocationActive(this.#innerPlugins) &&
      this.#remoteLifecycleHookInvocationDepth === 0 &&
      this.#hostModelMutationDepth === 0 &&
      !isProjectCallbackInvocationActive(this.project)
    ) {
      return
    }
    const error = new Error(`Cannot ${operation} the engine from an engine-owned lifecycle callback`)
    error.name = 'LifecycleReentrancyError'
    throw error
  }

  #throwLifecycleConflict(operation: 'destroy' | 'init', reason: string): never {
    const error = new Error(`Cannot ${operation} the engine because ${reason}`)
    error.name = 'LifecycleReentrancyError'
    throw error
  }

  #assertNoActiveTransaction(operation: string): void {
    if (!isTransactionBoundaryActive(this.transactions)) return
    const error = new Error(`Cannot ${operation} the engine while a transaction is active`)
    error.name = 'LifecycleReentrancyError'
    throw error
  }

  #assertPluginExtensionsAllowed(origin: string): void {
    if (this.trustPolicy.allowPluginExtensions) return
    throw new PolicyViolation({
      capability: 'plugin.extension',
      message: 'Plugin prototype extensions are disabled by the engine trust policy',
      origin,
      rule: `${this.trustPolicy.name}.plugin.extension.deny`,
    })
  }

  #ensureRestrictedPluginBoundary(origin: string): void {
    if (this.trustPolicy.allowPluginExtensions || this.#restrictedPluginBoundaryRelease) return
    const release = establishRestrictedPluginBoundary()
    if (release) {
      this.#restrictedPluginBoundaryRelease = release
      return
    }
    throw new PolicyViolation({
      capability: 'plugin.extension',
      details: {
        integrityIssues: getProcessPrototypeExtensionIntegrityIssues(),
        processExtensionsRegistered: hasProcessPrototypeExtensions(),
      },
      message: 'Cannot establish an agentRestricted boundary in a realm with process-wide prototype extensions',
      origin,
      rule: `${this.trustPolicy.name}.plugin.extension.realm-isolation`,
    })
  }

  #releaseRestrictedPluginBoundary(): void {
    this.#restrictedPluginBoundaryRelease?.()
    this.#restrictedPluginBoundaryRelease = undefined
  }

  #assertRemoteAccess(request: RemoteAccessRequest): true {
    if (this.lifecycleState === 'disposing' || this.lifecycleState === 'disposed' || this.lifecycleState === 'failed') {
      throw new Error(`Cannot access remote resources while engine is ${this.lifecycleState}`)
    }
    if (!this.trustPolicy.allowRemoteAccess) {
      throw new PolicyViolation({
        capability: 'remote',
        details: request,
        message: `Remote access to "${request.name}" is disabled by the engine trust policy`,
        origin: 'engine.remote',
        rule: `${this.trustPolicy.name}.remote.deny`,
      })
    }
    return true
  }

  async #disposeRemoteAdapter(): Promise<void> {
    if (!this.#remoteAdapterActive) return
    await this.#runRemoteLifecycleHook(() => this.#remoteAdapter?.dispose?.())
    this.#remoteAdapterActive = false
  }

  async #runRemoteLifecycleHook<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    this.#remoteLifecycleHookInvocationDepth += 1
    try {
      return await operation()
    } finally {
      this.#remoteLifecycleHookInvocationDepth -= 1
    }
  }

  #resolveHostWindow(): Window | undefined {
    if (this.#hostWindow === null) return undefined
    if (this.#hostWindow) return this.#hostWindow
    return typeof window === 'undefined' ? undefined : window
  }

  #runHostModelMutation<T>(origin: string, operation: () => T): T {
    this.#assertHostCompositionMutationAllowed(origin)
    this.#hostModelMutationDepth += 1
    try {
      return this.#runHostModelMutationInternal(origin, operation)
    } finally {
      this.#hostModelMutationDepth -= 1
    }
  }

  #runHostModelMutationInternal<T>(origin: string, operation: () => T): T {
    this.#assertTrustBoundaryIntegrity(origin)
    this.#assertNoActiveTransaction(origin)
    if (this.lifecycleState === 'disposing' || this.lifecycleState === 'disposed' || this.lifecycleState === 'failed') {
      throw new Error(`Cannot mutate the project while engine is ${this.lifecycleState}`)
    }
    const eventScope = this.#eventTransactions.begin()
    const postCommitErrors: unknown[] = []
    let operationCompleted = false
    let result!: T
    try {
      // Keep host writes inside one outer MobX batch, but release the ambient
      // authority before that batch flushes reactions. Synchronous observers
      // therefore cannot inherit host mutation authority.
      runInAction(() => {
        result = withProjectMutationAuthority(this.project, operation)
        operationCompleted = true
      })
    } catch (error) {
      if (error instanceof ProjectMutationCommittedError) {
        operationCompleted = true
        result = error.result as T
        appendFlattenedErrors(postCommitErrors, error)
      } else if (operationCompleted) {
        // The host operation returned before MobX flushed reactions, so the
        // model mutation is already committed and must never be reported as a
        // retry-safe failure.
        appendFlattenedErrors(postCommitErrors, error)
      } else {
        this.#eventTransactions.rollback(eventScope)
        throw error
      }
    }
    try {
      this.#eventTransactions.commit(eventScope)
    } catch (error) {
      appendFlattenedErrors(postCommitErrors, error)
    }
    if (postCommitErrors.length) throw new TransactionCommittedError(postCommitErrors, result)
    return result
  }

  #assertHostCompositionMutationAllowed(origin: string): void {
    if (this.#hostModelMutationDepth === 0) return
    const error = new Error(`Cannot start ${origin} while another host model mutation is settling`)
    error.name = 'LifecycleReentrancyError'
    throw error
  }

  #resolveOwnedDocument(documentOrId?: Document | string): Document {
    const document =
      documentOrId === undefined
        ? this.project.currentDocument
        : typeof documentOrId === 'string'
          ? this.project.getDocument(documentOrId)
          : documentOrId
    if (!document || this.project.getDocument(document.id) !== document) {
      throw new Error('The history document does not belong to this engine project')
    }
    return document
  }

  #wireEditorContext() {
    this.editor.set('engine', this)
    this.editor.set('designer', this.designer)
    this.editor.set('project', this.project)
    this.editor.set('setters', this.setters)
    this.editor.set('materials', this.materials)
    this.editor.set('hotkey', this.hotkey)
    this.editor.set('clipboard', this.clipboard)
    this.editor.set('remote', this.remote)
    this.editor.set('trustPolicy', this.trustPolicy)
    this.editor.set('plugins', this.plugins)
    this.editor.set('transactions', this.transactions)
    this.editor.set('commands', this.commands)
  }

  #claimLifecycleMutationOwnership(): void {
    const ownedMutationRoots = [
      this,
      this.clipboard,
      this.commands,
      this.config,
      this.designer,
      this.editor,
      this.editor.eventBus,
      this.eventBus,
      this.hotkey,
      this.#innerPlugins,
      this.plugins,
      this.materials,
      this.project,
      this.remote,
      this.remote.loadingState,
      this.remote.registry,
      this.setters,
      this.transactions,
    ]
    for (const root of ownedMutationRoots) {
      installLifecycleMutationGuard(root, this.#assertLifecycleMutationAllowed)
    }

    const ownedTeardownRoots = [
      this.clipboard,
      this.config,
      this.designer,
      this.editor,
      this.editor.eventBus,
      this.eventBus,
      this.hotkey,
      this.#innerPlugins,
      this.materials,
      this.project,
      this.remote.loadingState,
      this.remote.registry,
      this.setters,
    ]
    for (const root of ownedTeardownRoots) {
      claimEngineTeardownOwnership(root)
    }
  }

  #transitionLifecycle(nextState: EngineLifecycleState): void {
    const previousState = getEngineLifecycleState(this)
    if (!allowedEngineLifecycleTransitions[previousState].has(nextState)) {
      const error = new Error(`Invalid engine lifecycle transition: ${previousState} -> ${nextState}`)
      error.name = 'LifecycleTransitionError'
      throw error
    }
    engineLifecycleStates.set(this, nextState)
    // A generation starts when initialization begins and ends when disposal
    // starts or initialization rolls back. Entering `ready` is still the same
    // generation: plugin capabilities acquired during init must remain usable
    // for the lifetime of that ready engine.
    if (
      nextState === 'initializing' ||
      nextState === 'disposing' ||
      (previousState === 'initializing' && nextState !== 'ready')
    ) {
      advanceLifecycleMutationEpoch(this)
    }
  }
}

Object.defineProperty(EngineInstanceImpl.prototype, 'constructor', {
  configurable: false,
  enumerable: false,
  value: undefined,
  writable: false,
})

export const createEngine = (options: EngineInstanceOptions = {}): EngineInstance => {
  const { hostWindow, remoteAdapter, trustPolicy = 'agentRestricted' } = options
  return new EngineInstanceImpl({ hostWindow, remoteAdapter, trustPolicy })
}

/** @internal Compatibility-only constructor used by the legacy root facade. */
export const createLegacyEngine = (options: EngineInstanceConstructionOptions): EngineInstance =>
  new EngineInstanceImpl(options)

/** @internal Test-only access for white-box kernel regressions. */
export const getEngineInnerPlugins = (engine: EngineInstance): Plugins => {
  const plugins = engineInnerPlugins.get(engine)
  if (!plugins) throw new TypeError('Internal plugins require an EasyEditor engine instance')
  return plugins
}
