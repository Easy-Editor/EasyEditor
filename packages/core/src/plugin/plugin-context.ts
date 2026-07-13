import type { Event, Materials, Project, Setters } from '..'
import type { Config } from '../config'
import type { Clipboard } from '../designer/clipboard'
import {
  type Disposable,
  type EventBus,
  type EventDeliveryScheduler,
  type Hotkey,
  type Logger,
  createEventBus,
} from '../utils'
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

  private disposers = new Set<Disposable>()

  private externalOnDispose?: (disposer: Disposable) => void

  constructor(options: PluginContextOptions, contextApiAssembler: PluginContextApiAssembler) {
    const { pluginName = 'anonymous', meta = {} } = options
    this.engine = options.engine
    this.clipboard = options.clipboard
    this.trustPolicy = options.trustPolicy
    this.externalOnDispose = options.onDispose
    contextApiAssembler.assembleApis(this, pluginName, meta)
    this.pluginEvent = createEventBus(pluginName, undefined, options.eventDelivery)
  }

  onDispose(disposer: Disposable): Disposable {
    this.disposers.add(disposer)
    this.externalOnDispose?.(disposer)
    return disposer
  }

  dispose(): void {
    const errors: unknown[] = []
    for (const disposer of [...this.disposers].reverse()) {
      try {
        disposer()
      } catch (error) {
        errors.push(error)
      } finally {
        this.disposers.delete(disposer)
      }
    }
    this.pluginEvent.dispose()
    if (errors.length) {
      throw new AggregateError(errors, 'One or more plugin context resources failed to dispose')
    }
  }
}
