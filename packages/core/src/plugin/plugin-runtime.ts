import { type Logger, createLogger } from '../utils'
import type { PluginExtend } from './plugin-extend'
import type { Plugin, PluginMeta, Plugins } from './plugins'

export class PluginRuntime {
  config: Plugin

  logger: Logger

  private manager: Plugins

  private _inited: boolean

  private _extended: boolean

  private pluginName: string

  meta: PluginMeta

  /**
   * indicates whether the plugin is disabled
   */
  private _disabled: boolean

  get ctx() {
    return this.manager.getPluginContext({ pluginName: this.pluginName, meta: this.meta })
  }

  constructor(pluginName: string, manager: Plugins, config: Plugin) {
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

  isExtended() {
    return this._extended
  }

  async init(forceInit?: boolean) {
    if (this._inited && !forceInit) return
    this.logger.log('method init called')
    try {
      await this.config.init?.call(undefined, this.ctx)
      this._inited = true
    } catch (error) {
      this._inited = false
      try {
        this.ctx.dispose()
      } catch (disposeError) {
        throw new AggregateError([error, disposeError], `Plugin "${this.name}" init and context rollback both failed`)
      }
      throw error
    }
  }

  async destroy() {
    if (!this._inited) return
    this.logger.log('method destroy called')
    const errors: unknown[] = []
    try {
      await this.config?.destroy?.call(undefined, this.ctx)
    } catch (error) {
      errors.push(error)
    }
    try {
      this.ctx.dispose()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) {
      throw new AggregateError(errors, `Plugin "${this.name}" failed to destroy`)
    } else {
      this._inited = false
    }
  }

  async prepareExtension(pluginExtend: PluginExtend): Promise<boolean> {
    if (this._extended) return false
    this.logger.log('method extend called')
    await this.config?.extend?.call(undefined, pluginExtend)
    return true
  }

  markExtended(): void {
    this._extended = true
  }

  async extend(pluginExtend: PluginExtend) {
    if (await this.prepareExtension(pluginExtend)) this.markExtended()
  }

  setDisabled(flag = true) {
    this._disabled = flag
  }

  async dispose() {
    await this.manager.delete(this.name)
  }

  toProxy() {
    if (!this._inited) {
      this.logger.warn('Could not call toProxy before init')
    }

    const exports = this.config.exports?.()
    return new Proxy(this, {
      get(target, prop, receiver) {
        if ({}.hasOwnProperty.call(exports, prop)) {
          return exports?.[prop as string]
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  }
}
