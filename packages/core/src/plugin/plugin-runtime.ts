import { type Logger, createLogger } from '../utils'
import type { Plugin, PluginManager, PluginMeta } from './plugin-manager'

export class PluginRuntime {
  config: Plugin

  logger: Logger

  private manager: PluginManager

  private _inited: boolean

  private pluginName: string

  meta: PluginMeta

  /**
   * indicates whether the plugin is disabled
   */
  private _disabled: boolean

  get ctx() {
    return this.manager.getPluginContext({ pluginName: this.pluginName, meta: this.meta })
  }

  constructor(pluginName: string, manager: PluginManager, config: Plugin) {
    this.manager = manager
    this.config = config
    this.pluginName = pluginName
    this.meta = {
      dependencies: config?.deps || [],
      eventPrefix: config.eventPrefix,
    }
    this.logger = createLogger(`plugin:${pluginName}`)
  }

  get name() {
    return this.pluginName
  }

  get deps() {
    if (typeof this.meta.dependencies === 'string') {
      return [this.meta.dependencies]
    }

    return this.meta.dependencies || []
  }

  get disabled() {
    return this._disabled
  }

  isInited() {
    return this._inited
  }

  async init(forceInit?: boolean) {
    if (this._inited && !forceInit) return
    this.logger.log('method init called')
    await this.config.init?.call(undefined, this.ctx)
    this._inited = true
  }

  async destroy() {
    if (!this._inited) return
    this.logger.log('method destroy called')
    await this.config?.destroy?.call(undefined, this.ctx)
    this._inited = false
  }

  setDisabled(flag = true) {
    this._disabled = flag
  }

  async dispose() {
    await this.manager.delete(this.name)
  }
}
