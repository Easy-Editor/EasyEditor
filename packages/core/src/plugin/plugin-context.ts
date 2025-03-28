import type { ComponentMetaManager, Designer, Editor, Project, SetterManager, Simulator } from '..'
import type { EventBus, Hotkey, Logger } from '../utils'
import type { PluginContextApiAssembler, PluginMeta } from './plugin-manager'

import { createEventBus } from '../utils'

export interface PluginContextOptions {
  pluginName: string
  meta?: PluginMeta
}

export class PluginContext {
  editor: Editor
  simulator: Simulator
  designer: Designer
  project: Project
  setterManager: SetterManager
  componentMetaManager: ComponentMetaManager
  logger: Logger
  event: EventBus
  pluginEvent: EventBus
  hotkey: Hotkey

  constructor(options: PluginContextOptions, contextApiAssembler: PluginContextApiAssembler) {
    const { pluginName = 'anonymous', meta = {} } = options
    contextApiAssembler.assembleApis(this, pluginName, meta)
    this.pluginEvent = createEventBus(pluginName)
  }
}
