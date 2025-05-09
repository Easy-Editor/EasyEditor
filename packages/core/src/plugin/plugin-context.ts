import type { Designer, Editor, Event, Materials, Project, Setters, Simulator } from '..'
import type { Config } from '../config'
import { type EventBus, type Hotkey, type Logger, createEventBus } from '../utils'
import type { PluginContextApiAssembler, PluginMeta, Plugins } from './plugins'

export interface PluginContextOptions {
  pluginName: string
  meta?: PluginMeta
}

export class PluginContext {
  editor: Editor
  simulator: Simulator
  designer: Designer
  project: Project
  setters: Setters
  material: Materials
  logger: Logger
  event: Event
  pluginEvent: EventBus
  hotkey: Hotkey
  config: Config
  plugins: Plugins

  constructor(options: PluginContextOptions, contextApiAssembler: PluginContextApiAssembler) {
    const { pluginName = 'anonymous', meta = {} } = options
    contextApiAssembler.assembleApis(this, pluginName, meta)
    this.pluginEvent = createEventBus(pluginName)
  }
}
