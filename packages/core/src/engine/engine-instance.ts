import EventEmitter from 'events'
import { runInAction } from 'mobx'
import { AgentCapabilityManager } from '../agent'
import { CommandManager, TransactionCommittedError, TransactionManager } from '../commands'
import { Config, type ConfigOptions } from '../config'
import { Clipboard } from '../designer/clipboard'
import { Designer } from '../designer/designer'
import type { Document } from '../document'
import { DisposalLedger } from '../lifecycle'
import { advanceLifecycleMutationEpoch, installLifecycleMutationGuard } from '../lifecycle/mutation-barrier'
import { lockReadonlyProperties } from '../lifecycle/readonly-properties'
import { claimEngineTeardownOwnership, runInternalLifecycleTeardown } from '../lifecycle/teardown-boundary'
import { Materials } from '../materials'
import {
  type PluginContext,
  type PluginContextApiAssembler,
  type PluginMeta,
  Plugins,
  establishRestrictedPluginBoundary,
  getProcessPrototypeExtensionIntegrityIssues,
  hasProcessPrototypeExtensions,
} from '../plugin'
import { withProjectMutationAuthority } from '../project/mutation-authority'
import { LoadingStateManager } from '../remote/state/loading-state'
import { ResourceRegistry } from '../remote/state/resource-registry'
import { SchemaValidator } from '../schema'
import { Setters } from '../setters'
import { PolicyViolation, type TrustPolicy, type TrustPolicyPreset, resolveTrustPolicy } from '../trust'
import type { ProjectSchema } from '../types'
import { Event } from '../utils/event'
import { EventBus } from '../utils/event-bus'
import { EventTransactionCoordinator } from '../utils/event-transaction'
import { Hotkey } from '../utils/hotkey'
import { createLogger } from '../utils/logger'
import { Editor } from './editor'

export type EngineLifecycleState = 'created' | 'initializing' | 'ready' | 'disposing' | 'disposed' | 'failed'

const engineLifecycleStates = new WeakMap<EngineInstance, EngineLifecycleState>()

const getEngineLifecycleState = (engine: EngineInstance): EngineLifecycleState => {
  const state = engineLifecycleStates.get(engine)
  if (!state) throw new Error('Engine lifecycle state is not initialized')
  return state
}

export interface RemoteAccessRequest {
  name: string
  type: string
  url?: string
  [key: string]: unknown
}

export interface RemoteAdapter {
  init?(): void | Promise<void>
  request?(request: RemoteAccessRequest): unknown
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
  /** Internal compatibility injection used by the legacy default facade. */
  services?: Partial<EngineServices>
}

const appendFlattenedErrors = (target: unknown[], error: unknown): void => {
  if (error instanceof AggregateError) {
    for (const cause of error.errors) appendFlattenedErrors(target, cause)
    return
  }
  target.push(error)
}

export class EngineInstance {
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

  readonly plugins: Plugins

  readonly innerPlugins: Plugins

  readonly remote: {
    readonly registry: ResourceRegistry
    readonly loadingState: LoadingStateManager
    readonly request: (request: RemoteAccessRequest) => unknown
  }

  readonly transactions: TransactionManager

  readonly commands: CommandManager

  readonly agentCapabilities: AgentCapabilityManager

  private readonly hostWindow?: Window | null

  private readonly remoteAdapter?: RemoteAdapter

  private readonly eventTransactions = new EventTransactionCoordinator()

  #initScope?: DisposalLedger

  #initPromise?: Promise<void>

  #destroyPromise?: Promise<void>

  #remoteAdapterActive = false

  #restrictedPluginBoundaryRelease?: () => void

  private readonly assertLifecycleMutationAllowed = (origin: string): void => {
    const state = getEngineLifecycleState(this)
    if (state === 'disposing' || state === 'disposed' || state === 'failed') {
      throw new Error(`Cannot ${origin} while engine is ${state}`)
    }
  }

  constructor(options: EngineInstanceOptions = {}) {
    engineLifecycleStates.set(this, 'created')
    Object.defineProperty(this, 'lifecycleState', {
      configurable: false,
      enumerable: true,
      get: () => getEngineLifecycleState(this),
    })
    this.trustPolicy = resolveTrustPolicy(options.trustPolicy)
    this.ensureRestrictedPluginBoundary('engine.constructor')
    try {
      this.config = options.services?.config || new Config()
      this.eventBus = options.services?.eventBus || new EventBus(new EventEmitter())
      this.eventBus.setDeliveryScheduler(this.eventTransactions.defer)
      this.event = new Event(this.eventBus, { prefix: 'common' })
      this.hotkey = new Hotkey()
      this.clipboard = options.services?.clipboard || new Clipboard()
      this.editor = new Editor(undefined, this.config, this.eventTransactions.defer)
      this.editor.set('trustPolicy', this.trustPolicy)

      const schemaValidator = new SchemaValidator(this.trustPolicy, origin => this.assertTrustBoundaryIntegrity(origin))
      this.designer = new Designer({
        editor: this.editor,
        eventDelivery: this.eventTransactions.defer,
        schemaValidator,
      })
      this.project = this.designer.project
      this.setters = new Setters()
      this.materials = new Materials(this.editor)

      this.remoteAdapter = options.remoteAdapter
      this.#remoteAdapterActive = !!this.remoteAdapter
      const registry = options.services?.registry || new ResourceRegistry()
      const remoteLoadingState = options.services?.loadingState || new LoadingStateManager()
      this.remote = Object.freeze({
        loadingState: remoteLoadingState,
        registry,
        request: request => {
          this.assertRemoteAccess(request)
          return this.remoteAdapter?.request?.(request)
        },
      })

      const pluginContextApiAssembler: PluginContextApiAssembler = {
        assembleApis: (context: PluginContext, pluginName: string, meta: PluginMeta) => {
          context.engine = this
          context.hotkey = this.hotkey
          context.clipboard = this.clipboard
          context.project = this.project
          context.setters = this.setters
          context.materials = this.materials
          const eventPrefix = meta?.eventPrefix || 'common'
          context.event = new Event(this.eventBus, { prefix: eventPrefix })
          context.config = this.config
          context.plugins = this.plugins
          context.trustPolicy = this.trustPolicy
          context.logger = createLogger(`plugin:${pluginName}`)
        },
      }

      this.innerPlugins = new Plugins(
        pluginContextApiAssembler,
        { eventDelivery: this.eventTransactions.defer },
        origin => this.assertPluginExtensionsAllowed(origin),
      )
      this.plugins = this.innerPlugins.toProxy()

      this.transactions = new TransactionManager(this, this.eventTransactions)
      this.commands = new CommandManager(this.transactions)
      this.agentCapabilities = new AgentCapabilityManager(this)
      this.wireEditorContext()

      this.hostWindow = options.hostWindow
      this.claimLifecycleMutationOwnership()
      lockReadonlyProperties(this, [
        'agentCapabilities',
        'assertLifecycleMutationAllowed',
        'clipboard',
        'commands',
        'config',
        'designer',
        'editor',
        'event',
        'eventBus',
        'eventTransactions',
        'hostWindow',
        'hotkey',
        'innerPlugins',
        'logger',
        'materials',
        'plugins',
        'project',
        'remote',
        'remoteAdapter',
        'setters',
        'transactions',
        'trustPolicy',
      ])
    } catch (error) {
      this.releaseRestrictedPluginBoundary()
      throw error
    }
  }

  async init(options?: ConfigOptions): Promise<void> {
    if (this.lifecycleState === 'initializing') {
      return this.#initPromise
    }
    if (this.lifecycleState === 'ready') {
      await this.destroy()
    } else if (this.lifecycleState === 'disposing') {
      await this.#destroyPromise
    } else if (this.lifecycleState === 'failed') {
      await this.destroy()
    }

    // Concurrent callers waiting for the same teardown join the first restart.
    const settledState = this.lifecycleState as EngineLifecycleState
    if (settledState === 'initializing') return this.#initPromise
    if (settledState === 'ready') return

    this.ensureRestrictedPluginBoundary('engine.init')

    this.#initPromise = this.initialize(options)
    try {
      await this.#initPromise
    } finally {
      this.#initPromise = undefined
    }
  }

  private async initialize(options?: ConfigOptions): Promise<void> {
    this.#transitionLifecycle('initializing')
    this.#initScope = new DisposalLedger()
    try {
      if (options) this.config.setEngineOptions(options)
      this.wireEditorContext()
      this.designer.mount()
      this.assertTrustBoundaryIntegrity('engine.init')

      if (!this.trustPolicy.allowPluginExtensions && this.innerPlugins.hasPrototypeExtensions()) {
        throw new PolicyViolation({
          capability: 'plugin.extension',
          message: 'Plugin prototype extensions are disabled by the engine trust policy',
          origin: 'engine.init',
          rule: `${this.trustPolicy.name}.plugin.extension.deny`,
        })
      }

      this.innerPlugins.preflight()
      if (this.remoteAdapter?.dispose) {
        this.#remoteAdapterActive = true
        this.#initScope.add(() => this.disposeRemoteAdapter(), 'engine.remoteAdapter')
      }
      await this.remoteAdapter?.init?.()

      const hostWindow = this.resolveHostWindow()
      if (hostWindow) {
        this.#initScope.add(this.hotkey.mount(hostWindow), 'engine.hotkey')
      }

      await this.plugins.extend()
      await this.plugins.init()
      this.#transitionLifecycle('ready')
      this.agentCapabilities.activate()
      this.logger.info('Engine initialization successfully')
    } catch (error) {
      const rollbackErrors: unknown[] = []
      try {
        await runInternalLifecycleTeardown<['destroy'], Promise<void>>(this.innerPlugins, 'destroy')
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

  async destroy(): Promise<void> {
    if (this.lifecycleState === 'disposed') return
    if (this.lifecycleState === 'disposing') {
      return this.#destroyPromise
    }
    if (this.lifecycleState === 'initializing') {
      try {
        await this.#initPromise
      } catch {
        // Initialization already rolled its partial resources back.
      }
      const settledState = this.lifecycleState as EngineLifecycleState
      if (settledState === 'disposed') return
      if (settledState === 'disposing') return this.#destroyPromise
    }

    this.#destroyPromise = this.disposeEngine()
    try {
      await this.#destroyPromise
    } finally {
      this.#destroyPromise = undefined
    }
  }

  /** Validate and replace the project through the engine-owned host boundary. */
  loadProject(schema?: ProjectSchema, autoOpen?: boolean | string): void {
    this.runHostModelMutation('engine.loadProject', () => this.project.load(schema, autoOpen))
  }

  /** Remove all project documents through the engine-owned host boundary. */
  unloadProject(): void {
    this.runHostModelMutation('engine.unloadProject', () => this.project.unload())
  }

  /** Undo one committed history unit without exposing raw History mutation authority. */
  undo(documentOrId?: Document | string): void {
    this.runHostModelMutation('engine.undo', () => this.resolveOwnedDocument(documentOrId).history.back())
  }

  /** Redo one committed history unit without exposing raw History mutation authority. */
  redo(documentOrId?: Document | string): void {
    this.runHostModelMutation('engine.redo', () => this.resolveOwnedDocument(documentOrId).history.forward())
  }

  private async disposeEngine(): Promise<void> {
    this.#transitionLifecycle('disposing')
    const failures: unknown[] = []
    const cleanup = async (operation: () => void | Promise<void>) => {
      try {
        await operation()
      } catch (error) {
        failures.push(error)
      }
    }

    await cleanup(() => runInternalLifecycleTeardown<[string]>(this.agentCapabilities, 'engine.lifecycle'))
    const initScope = this.#initScope
    await cleanup(() => initScope?.dispose())
    this.#initScope = undefined
    await cleanup(() => runInternalLifecycleTeardown<['destroy'], Promise<void>>(this.innerPlugins, 'destroy'))
    await cleanup(() => runInternalLifecycleTeardown(this.designer))
    await cleanup(() => runInternalLifecycleTeardown<[], Promise<void>>(this.project))
    if (!initScope) {
      await cleanup(() => this.disposeRemoteAdapter())
    }
    await cleanup(() => runInternalLifecycleTeardown(this.hotkey))
    await cleanup(() => runInternalLifecycleTeardown(this.clipboard))
    await cleanup(() => runInternalLifecycleTeardown(this.materials))
    await cleanup(() => runInternalLifecycleTeardown(this.setters))
    await cleanup(() => runInternalLifecycleTeardown(this.remote.loadingState))
    await cleanup(() => runInternalLifecycleTeardown(this.remote.registry))
    await cleanup(() => runInternalLifecycleTeardown<['clearContexts']>(this.innerPlugins, 'clearContexts'))
    await cleanup(() => runInternalLifecycleTeardown(this.editor))
    await cleanup(() => runInternalLifecycleTeardown(this.eventBus))
    await cleanup(() => runInternalLifecycleTeardown(this.config, { preserve: ['VERSION'] }))
    // Plugins can run arbitrary teardown hooks; finish with a final capability
    // and audit-subscriber sweep so no late teardown registration survives.
    await cleanup(() => runInternalLifecycleTeardown<[string]>(this.agentCapabilities, 'engine.lifecycle.finalize'))

    if (failures.length > 0) {
      this.#transitionLifecycle('failed')
      throw new AggregateError(failures, 'Engine disposal completed with errors')
    }
    this.releaseRestrictedPluginBoundary()
    this.#transitionLifecycle('disposed')
    this.logger.info('Engine destruction successfully')
  }

  assertTrustBoundaryIntegrity(origin: string): void {
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

  private assertPluginExtensionsAllowed(origin: string): void {
    if (this.trustPolicy.allowPluginExtensions) return
    throw new PolicyViolation({
      capability: 'plugin.extension',
      message: 'Plugin prototype extensions are disabled by the engine trust policy',
      origin,
      rule: `${this.trustPolicy.name}.plugin.extension.deny`,
    })
  }

  private ensureRestrictedPluginBoundary(origin: string): void {
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

  private releaseRestrictedPluginBoundary(): void {
    this.#restrictedPluginBoundaryRelease?.()
    this.#restrictedPluginBoundaryRelease = undefined
  }

  assertRemoteAccess(request: RemoteAccessRequest): true {
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

  private async disposeRemoteAdapter(): Promise<void> {
    if (!this.#remoteAdapterActive) return
    await this.remoteAdapter?.dispose?.()
    this.#remoteAdapterActive = false
  }

  private resolveHostWindow(): Window | undefined {
    if (this.hostWindow === null) return undefined
    if (this.hostWindow) return this.hostWindow
    return typeof window === 'undefined' ? undefined : window
  }

  private runHostModelMutation<T>(origin: string, operation: () => T): T {
    this.assertTrustBoundaryIntegrity(origin)
    if (this.lifecycleState === 'disposing' || this.lifecycleState === 'disposed' || this.lifecycleState === 'failed') {
      throw new Error(`Cannot mutate the project while engine is ${this.lifecycleState}`)
    }
    const eventScope = this.eventTransactions.begin()
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
      if (!operationCompleted) {
        this.eventTransactions.rollback(eventScope)
        throw error
      }
      // The host operation returned before MobX flushed reactions, so the
      // model mutation is already committed and must never be reported as a
      // retry-safe failure.
      appendFlattenedErrors(postCommitErrors, error)
    }
    try {
      this.eventTransactions.commit(eventScope)
    } catch (error) {
      appendFlattenedErrors(postCommitErrors, error)
    }
    if (postCommitErrors.length) throw new TransactionCommittedError(postCommitErrors, result)
    return result
  }

  private resolveOwnedDocument(documentOrId?: Document | string): Document {
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

  private wireEditorContext() {
    this.editor.set('engine', this)
    this.editor.set('designer', this.designer)
    this.editor.set('project', this.project)
    this.editor.set('setters', this.setters)
    this.editor.set('materials', this.materials)
    this.editor.set('hotkey', this.hotkey)
    this.editor.set('clipboard', this.clipboard)
    this.editor.set('remote', this.remote)
    this.editor.set('trustPolicy', this.trustPolicy)
    this.editor.set('innerPlugins', this.innerPlugins)
    this.editor.set('plugins', this.plugins)
    this.editor.set('transactions', this.transactions)
    this.editor.set('commands', this.commands)
    this.editor.set('agentCapabilities', this.agentCapabilities)
  }

  private claimLifecycleMutationOwnership(): void {
    const ownedMutationRoots = [
      this,
      this.clipboard,
      this.agentCapabilities,
      this.config,
      this.designer,
      this.editor,
      this.editor.eventBus,
      this.eventBus,
      this.hotkey,
      this.innerPlugins,
      this.plugins,
      this.materials,
      this.project,
      this.remote.loadingState,
      this.remote.registry,
      this.setters,
    ]
    for (const root of ownedMutationRoots) {
      installLifecycleMutationGuard(root, this.assertLifecycleMutationAllowed)
    }

    const ownedTeardownRoots = [
      this.clipboard,
      this.agentCapabilities,
      this.config,
      this.designer,
      this.editor,
      this.editor.eventBus,
      this.eventBus,
      this.hotkey,
      this.innerPlugins,
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

export const createEngine = (options: EngineInstanceOptions = {}): EngineInstance => {
  return new EngineInstance({ trustPolicy: 'agentRestricted', ...options })
}
