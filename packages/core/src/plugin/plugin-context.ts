import type { Config } from '../config'
import type { Clipboard } from '../designer/clipboard'
import { assertLifecycleMutationAllowed, sealLifecycleMutations } from '../lifecycle/mutation-barrier'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import type { ComponentMeta } from '../materials/component-meta'
import type { Materials } from '../materials/materials'
import type { Project } from '../project/project'
import type { Setters } from '../setters/setters'
import type { TrustPolicy } from '../trust'
import type { Event } from '../utils/event'
import { type EventBus, type EventDeliveryScheduler, createEventBus } from '../utils/event-bus'
import type { Disposable, Hotkey } from '../utils/hotkey'
import type { Logger } from '../utils/logger'
import {
  installPluginContextOperations,
  pluginContextCapabilityKeys,
  unwrapPluginContextCapability,
} from './plugin-context-boundary'
import type { PluginContextApiAssembler, PluginMeta, PluginRegistry } from './plugins'

export interface PluginClipboardCapability {
  readonly initCopyPaster: Clipboard['initCopyPaster']
  readonly injectCopyPaster: Clipboard['injectCopyPaster']
  readonly isCopyPasteEvent: Clipboard['isCopyPasteEvent']
  readonly setData: Clipboard['setData']
  readonly waitPasteData: Clipboard['waitPasteData']
}

export interface PluginConfigCapability {
  readonly get: Config['get']
  readonly has: Config['has']
  readonly onGot: Config['onGot']
  readonly onceGot: Config['onceGot']
  readonly set: Config['set']
  readonly setConfig: Config['setConfig']
}

export interface PluginEventCapability {
  readonly emit: Event['emit']
  readonly off: Event['off']
  readonly on: Event['on']
  readonly prependListener: Event['prependListener']
}

export interface PluginHotkeyCapability {
  readonly acquireBinding: Hotkey['acquireBinding']
  readonly activate: Hotkey['activate']
  readonly bind: (...args: Parameters<Hotkey['bind']>) => PluginHotkeyCapability
  readonly callBacks: Hotkey['callBacks']
  readonly unbind: Hotkey['unbind']
}

export interface PluginLoggerCapability {
  readonly debug: Logger['debug']
  readonly error: Logger['error']
  readonly info: Logger['info']
  readonly log: Logger['log']
  readonly warn: Logger['warn']
}

export interface PluginComponentMetaCapability {
  readonly advanced: ComponentMeta['advanced']
  readonly componentName: ComponentMeta['componentName']
  readonly configure: ComponentMeta['configure']
  readonly descriptor: ComponentMeta['descriptor']
  readonly getMetadata: ComponentMeta['getMetadata']
  readonly icon: ComponentMeta['icon']
  readonly isComponentMeta: ComponentMeta['isComponentMeta']
  readonly isContainer: ComponentMeta['isContainer']
  readonly isMinimalRenderUnit: ComponentMeta['isMinimalRenderUnit']
  readonly isRemoteMaterial: ComponentMeta['isRemoteMaterial']
  readonly npm: ComponentMeta['npm']
  readonly onMetadataChange: ComponentMeta['onMetadataChange']
  readonly snippets: ComponentMeta['snippets']
  readonly title: ComponentMeta['title']
}

export interface PluginMaterialsCapability {
  readonly buildComponentMetasMap: Materials['buildComponentMetasMap']
  readonly canUnload: Materials['canUnload']
  readonly componentMetasMap: Materials['componentMetasMap']
  readonly componentsMap: Materials['componentsMap']
  readonly createComponentMeta: (
    ...args: Parameters<Materials['createComponentMeta']>
  ) => PluginComponentMetaCapability | null
  readonly decrementUsage: Materials['decrementUsage']
  readonly getComponentMeta: (...args: Parameters<Materials['getComponentMeta']>) => PluginComponentMetaCapability
  readonly getComponentMetasMap: () => Map<string, PluginComponentMetaCapability>
  readonly getComponentSnippets: Materials['getComponentSnippets']
  readonly getUsageCount: Materials['getUsageCount']
  readonly incrementUsage: Materials['incrementUsage']
  readonly isComponentMeta: (value: unknown) => value is PluginComponentMetaCapability
  readonly refreshComponentMetasMap: Materials['refreshComponentMetasMap']
  readonly removeComponentMeta: Materials['removeComponentMeta']
  readonly version: Materials['version']
}

export interface PluginProjectCapability {
  readonly allowsDirectModelMutation: Project['allowsDirectModelMutation']
  readonly config: Project['config']
  readonly export: Project['export']
  readonly get: Project['get']
}

export interface PluginSettersCapability {
  readonly createSetterContent: Setters['createSetterContent']
  readonly getSetter: Setters['getSetter']
  readonly getSettersMap: Setters['getSettersMap']
  readonly registerSetter: Setters['registerSetter']
  readonly settersMap: Setters['settersMap']
}

export interface RestrictedPluginContextCapabilities {
  readonly clipboard: PluginClipboardCapability
  readonly config: PluginConfigCapability
  readonly event: PluginEventCapability
  readonly hotkey: PluginHotkeyCapability
  readonly logger: PluginLoggerCapability
  readonly materials: PluginMaterialsCapability
  readonly project: PluginProjectCapability
  readonly setters: PluginSettersCapability
}

/**
 * Raw same-realm services available only when the host deliberately selects
 * `legacyTrusted`. Legacy plugins must assert this boundary before relying on
 * reverse references or direct model mutation APIs.
 */
export interface LegacyTrustedPluginContext extends PluginContext {
  clipboard: Clipboard
  config: Config
  event: Event
  hotkey: Hotkey
  logger: Logger
  materials: Materials
  project: Project
  setters: Setters
  trustPolicy: TrustPolicy & { readonly name: 'legacyTrusted' }
}

export interface PluginContextOptions {
  pluginName: string
  meta?: PluginMeta
  engine?: unknown
  clipboard?: PluginClipboardCapability
  trustPolicy?: TrustPolicy
  onDispose?: (disposer: Disposable) => void
  eventDelivery?: EventDeliveryScheduler
}

export class PluginContext {
  project: PluginProjectCapability
  plugins: PluginRegistry
  setters: PluginSettersCapability
  materials: PluginMaterialsCapability
  event: PluginEventCapability
  pluginEvent: EventBus
  hotkey: PluginHotkeyCapability
  config: PluginConfigCapability
  logger: PluginLoggerCapability
  engine?: unknown
  clipboard?: PluginClipboardCapability
  trustPolicy?: TrustPolicy

  #disposers = new Set<Disposable>()

  #externalOnDispose?: (disposer: Disposable) => void

  #disposeStarted = false

  #disposeCompleted = false

  #pluginEventDisposed = false

  constructor(options: PluginContextOptions, contextApiAssembler: PluginContextApiAssembler) {
    // Establish own capability slots before any host assignment or assembler
    // callback. This prevents inherited accessors from observing the raw host
    // capabilities before the lifecycle membrane replaces these values.
    for (const key of pluginContextCapabilityKeys) {
      Object.defineProperty(this, key, {
        configurable: true,
        enumerable: true,
        value: undefined,
        writable: true,
      })
    }
    installPluginContextOperations(this, {
      dispose: () => this.#disposePublic(),
      onDispose: disposer => this.#onDisposeInternal(disposer),
    })
    installLifecycleTeardownOperation(this, () => this.#disposeInternal())
    const { pluginName = 'anonymous', meta = {} } = options
    this.engine = options.engine
    this.clipboard = options.clipboard
    this.trustPolicy = options.trustPolicy
    this.#externalOnDispose = options.onDispose
    contextApiAssembler.assembleApis(this, pluginName, meta)
    this.pluginEvent = createEventBus(pluginName, undefined, options.eventDelivery)
    inheritEngineTeardownOwnership(this, this.pluginEvent)
  }

  onDispose(disposer: Disposable): Disposable {
    return this.#onDisposeInternal(disposer)
  }

  #onDisposeInternal(disposer: Disposable): Disposable {
    if (this.#disposeStarted) throw new Error('Cannot register disposal on a disposed plugin context')
    assertLifecycleMutationAllowed(this, 'pluginContext.onDispose')
    const teardownDisposer = unwrapPluginContextCapability(disposer)
    this.#disposers.add(teardownDisposer)
    this.#externalOnDispose?.(teardownDisposer)
    return disposer
  }

  dispose(): void {
    this.#disposePublic()
  }

  #disposePublic(): void {
    assertPublicLifecycleTeardownAllowed(this, 'pluginContext.dispose')
    this.#disposeInternal()
  }

  #disposeInternal(): void {
    if (this.#disposeCompleted) return
    if (!this.#disposeStarted) {
      this.#disposeStarted = true
      sealLifecycleMutations(this, 'plugin context is disposed')
      sealLifecycleMutations(this.pluginEvent, 'plugin context is disposed')
    }
    const errors: unknown[] = []
    for (const disposer of [...this.#disposers].reverse()) {
      try {
        disposer()
        this.#disposers.delete(disposer)
      } catch (error) {
        errors.push(error)
      }
    }
    if (!this.#pluginEventDisposed) {
      try {
        runInternalLifecycleTeardown(this.pluginEvent)
        this.#pluginEventDisposed = true
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, 'One or more plugin context resources failed to dispose')
    }
    this.#disposeCompleted = true
  }
}

export function assertLegacyTrustedPluginContext(
  context: PluginContext,
): asserts context is LegacyTrustedPluginContext {
  if (context.trustPolicy?.name === 'legacyTrusted') return
  throw new Error('This plugin requires a legacyTrusted PluginContext with direct host-model authority')
}
