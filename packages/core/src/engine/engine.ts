import EventEmitter from 'events'
import { CommandManager, TransactionManager } from '../commands'
import { Config, type ConfigOptions, config as legacyConfig } from '../config'
import { Clipboard, Designer, clipboard as legacyClipboard } from '../designer'
import { DisposalLedger } from '../lifecycle'
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
import { LoadingStateManager, ResourceRegistry, loadingState, resourceRegistry } from '../remote'
import { SchemaValidator } from '../schema'
import { Setters } from '../setters'
import { PolicyViolation, type TrustPolicy, type TrustPolicyPreset, resolveTrustPolicy } from '../trust'
import { Event, EventBus, Hotkey, commonEvent, createLogger } from '../utils'
import { EventTransactionCoordinator } from '../utils/event-transaction'
import { Editor } from './editor'

export type EngineLifecycleState = 'created' | 'initializing' | 'ready' | 'disposing' | 'disposed' | 'failed'

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

export class EngineInstance {
  lifecycleState: EngineLifecycleState = 'created'

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
    registry: ResourceRegistry
    loadingState: LoadingStateManager
    request: (request: RemoteAccessRequest) => unknown
  }

  readonly transactions: TransactionManager

  readonly commands: CommandManager

  private readonly hostWindow?: Window | null

  private readonly remoteAdapter?: RemoteAdapter

  private readonly eventTransactions = new EventTransactionCoordinator()

  private initScope?: DisposalLedger

  private initPromise?: Promise<void>

  private destroyPromise?: Promise<void>

  private remoteAdapterActive: boolean

  private restrictedPluginBoundaryRelease?: () => void

  constructor(options: EngineInstanceOptions = {}) {
    this.trustPolicy = resolveTrustPolicy(options.trustPolicy)
    this.ensureRestrictedPluginBoundary('engine.constructor')
    this.config = options.services?.config || new Config()
    this.eventBus = options.services?.eventBus || new EventBus(new EventEmitter())
    this.eventBus.setDeliveryScheduler(this.eventTransactions.defer)
    this.event = new Event(this.eventBus, { prefix: 'common' })
    this.hotkey = new Hotkey()
    this.clipboard = options.services?.clipboard || new Clipboard()
    this.editor = new Editor(undefined, this.config, this.eventTransactions.defer)

    const schemaValidator = new SchemaValidator(this.trustPolicy, origin => this.assertTrustBoundaryIntegrity(origin))
    this.designer = new Designer({ editor: this.editor, eventDelivery: this.eventTransactions.defer, schemaValidator })
    this.project = this.designer.project
    this.setters = new Setters()
    this.materials = new Materials(this.editor)

    this.remoteAdapter = options.remoteAdapter
    this.remoteAdapterActive = !!this.remoteAdapter
    const registry = options.services?.registry || new ResourceRegistry()
    const remoteLoadingState = options.services?.loadingState || new LoadingStateManager()
    this.remote = {
      loadingState: remoteLoadingState,
      registry,
      request: request => {
        this.assertRemoteAccess(request)
        return this.remoteAdapter?.request?.(request)
      },
    }

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

    this.wireEditorContext()
    this.transactions = new TransactionManager(this, this.eventTransactions)
    this.commands = new CommandManager(this.transactions)
    this.editor.set('transactions', this.transactions)
    this.editor.set('commands', this.commands)

    this.hostWindow = options.hostWindow
  }

  async init(options?: ConfigOptions): Promise<void> {
    if (this.lifecycleState === 'initializing') {
      return this.initPromise
    }
    if (this.lifecycleState === 'ready') {
      await this.destroy()
    } else if (this.lifecycleState === 'disposing') {
      await this.destroyPromise
    } else if (this.lifecycleState === 'failed') {
      await this.destroy()
    }

    // Concurrent callers waiting for the same teardown join the first restart.
    const settledState = this.lifecycleState as EngineLifecycleState
    if (settledState === 'initializing') return this.initPromise
    if (settledState === 'ready') return

    this.ensureRestrictedPluginBoundary('engine.init')

    this.initPromise = this.initialize(options)
    try {
      await this.initPromise
    } finally {
      this.initPromise = undefined
    }
  }

  private async initialize(options?: ConfigOptions): Promise<void> {
    this.lifecycleState = 'initializing'
    this.initScope = new DisposalLedger()
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
        this.remoteAdapterActive = true
        this.initScope.add(() => this.disposeRemoteAdapter(), 'engine.remoteAdapter')
      }
      await this.remoteAdapter?.init?.()

      const hostWindow = this.resolveHostWindow()
      if (hostWindow) {
        this.initScope.add(this.hotkey.mount(hostWindow), 'engine.hotkey')
      }

      await this.plugins.extend()
      await this.plugins.init()
      this.lifecycleState = 'ready'
      this.logger.info('Engine initialization successfully')
    } catch (error) {
      const rollbackErrors: unknown[] = []
      try {
        await this.plugins.destroy()
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      try {
        await this.initScope.dispose()
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      this.initScope = undefined
      this.lifecycleState = rollbackErrors.length ? 'failed' : 'created'
      if (rollbackErrors.length) {
        throw new AggregateError([error, ...rollbackErrors], 'Engine initialization and rollback both failed')
      }
      throw error
    }
  }

  async destroy(): Promise<void> {
    if (this.lifecycleState === 'disposed') return
    if (this.lifecycleState === 'disposing') {
      return this.destroyPromise
    }
    if (this.lifecycleState === 'initializing') {
      try {
        await this.initPromise
      } catch {
        // Initialization already rolled its partial resources back.
      }
      const settledState = this.lifecycleState as EngineLifecycleState
      if (settledState === 'disposed') return
      if (settledState === 'disposing') return this.destroyPromise
    }

    this.destroyPromise = this.disposeEngine()
    try {
      await this.destroyPromise
    } finally {
      this.destroyPromise = undefined
    }
  }

  private async disposeEngine(): Promise<void> {
    this.lifecycleState = 'disposing'
    const failures: unknown[] = []
    const cleanup = async (operation: () => void | Promise<void>) => {
      try {
        await operation()
      } catch (error) {
        failures.push(error)
      }
    }

    const initScope = this.initScope
    await cleanup(() => initScope?.dispose())
    this.initScope = undefined
    await cleanup(() => this.plugins.destroy())
    await cleanup(() => this.designer.purge())
    await cleanup(() => this.project.dispose())
    if (!initScope) {
      await cleanup(() => this.disposeRemoteAdapter())
    }
    await cleanup(() => this.hotkey.dispose())
    await cleanup(() => this.clipboard.dispose())
    await cleanup(() => this.materials.dispose())
    await cleanup(() => this.setters.dispose())
    await cleanup(() => this.remote.loadingState.dispose())
    await cleanup(() => this.remote.registry.dispose())
    await cleanup(() => this.innerPlugins.clearContexts())
    await cleanup(() => this.editor.destroy())
    await cleanup(() => this.eventBus.dispose())
    await cleanup(() => this.config.dispose({ preserve: ['VERSION'] }))

    if (failures.length > 0) {
      this.lifecycleState = 'failed'
      throw new AggregateError(failures, 'Engine disposal completed with errors')
    }
    this.releaseRestrictedPluginBoundary()
    this.lifecycleState = 'disposed'
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
    if (this.trustPolicy.allowPluginExtensions || this.restrictedPluginBoundaryRelease) return
    const release = establishRestrictedPluginBoundary()
    if (release) {
      this.restrictedPluginBoundaryRelease = release
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
    this.restrictedPluginBoundaryRelease?.()
    this.restrictedPluginBoundaryRelease = undefined
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
    if (!this.remoteAdapterActive) return
    await this.remoteAdapter?.dispose?.()
    this.remoteAdapterActive = false
  }

  private resolveHostWindow(): Window | undefined {
    if (this.hostWindow === null) return undefined
    if (this.hostWindow) return this.hostWindow
    return typeof window === 'undefined' ? undefined : window
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
  }
}

export const createEngine = (options: EngineInstanceOptions = {}): EngineInstance => {
  return new EngineInstance({ trustPolicy: 'agentRestricted', ...options })
}

export const defaultEngine = new EngineInstance({
  services: {
    clipboard: legacyClipboard,
    config: legacyConfig,
    eventBus: commonEvent,
    loadingState,
    registry: resourceRegistry,
  },
  trustPolicy: 'legacyTrusted',
})

export const init = (options?: ConfigOptions) => defaultEngine.init(options)
export const destroy = () => defaultEngine.destroy()

export const editor = defaultEngine.editor
export const event = defaultEngine.event
export const hotkey = defaultEngine.hotkey
export const logger = defaultEngine.logger
export const materials = defaultEngine.materials
export const plugins = defaultEngine.plugins
export const project = defaultEngine.project
export const setters = defaultEngine.setters
export const commands = defaultEngine.commands
export const transactions = defaultEngine.transactions
