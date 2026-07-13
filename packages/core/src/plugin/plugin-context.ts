import type { Config } from '../config'
import type { Clipboard } from '../designer/clipboard'
import { assertLifecycleMutationAllowed, sealLifecycleMutations } from '../lifecycle/mutation-barrier'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import type { Materials } from '../materials/materials'
import type { Project } from '../project/project'
import type { Setters } from '../setters/setters'
import type { Event } from '../utils/event'
import { type EventBus, type EventDeliveryScheduler, createEventBus } from '../utils/event-bus'
import type { Disposable, Hotkey } from '../utils/hotkey'
import type { Logger } from '../utils/logger'
import { unwrapPluginContextCapability } from './plugin-context-boundary'
import type { PluginContextApiAssembler, PluginMeta, Plugins } from './plugins'

export interface PluginContextOptions {
  pluginName: string
  meta?: PluginMeta
  engine?: unknown
  clipboard?: Clipboard
  trustPolicy?: unknown
  onDispose?: (disposer: Disposable) => void
  eventDelivery?: EventDeliveryScheduler
}

export class PluginContext {
  project: Project
  plugins: Plugins
  setters: Setters
  materials: Materials
  event: Event
  pluginEvent: EventBus
  hotkey: Hotkey
  config: Config
  logger: Logger
  engine?: unknown
  clipboard?: Clipboard
  trustPolicy?: unknown

  #disposers = new Set<Disposable>()

  #externalOnDispose?: (disposer: Disposable) => void

  #disposeStarted = false

  #disposeCompleted = false

  #pluginEventDisposed = false

  constructor(options: PluginContextOptions, contextApiAssembler: PluginContextApiAssembler) {
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
    if (this.#disposeStarted) throw new Error('Cannot register disposal on a disposed plugin context')
    assertLifecycleMutationAllowed(this, 'pluginContext.onDispose')
    const teardownDisposer = unwrapPluginContextCapability(disposer)
    this.#disposers.add(teardownDisposer)
    this.#externalOnDispose?.(teardownDisposer)
    return disposer
  }

  dispose(): void {
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
