import type { Event, Materials, Project, Setters } from '..'
import type { Config } from '../config'
import { type EventBus, type Hotkey, type Logger, createEventBus } from '../utils'
import type { PluginContextApiAssembler, PluginMeta, Plugins } from './plugins'

export interface PluginContextOptions {
  pluginName: string
  meta?: PluginMeta
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

  constructor(options: PluginContextOptions, contextApiAssembler: PluginContextApiAssembler) {
    const { pluginName = 'anonymous', meta = {} } = options
    contextApiAssembler.assembleApis(this, pluginName, meta)
    this.pluginEvent = createEventBus(pluginName)
  }
}
