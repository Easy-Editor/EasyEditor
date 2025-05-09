import {
  ComponentMeta,
  Designer,
  Detecting,
  Document,
  Dragon,
  DropLocation,
  History,
  Materials,
  Node,
  NodeChildren,
  OffsetObserver,
  Project,
  Prop,
  Props,
  Selection,
  Setters,
  Simulator,
  Viewport,
} from '..'
import { createLogger } from '../utils'
import type { PluginContextOptions } from './plugin-context'
import { PluginContext } from './plugin-context'
import { type PluginExtend, type PluginExtendClass, extend } from './plugin-extend'
import { PluginRuntime } from './plugin-runtime'
import { sequencify } from './sequencify'

const logger = createLogger('PluginManager')

export interface Plugin {
  name: string
  deps?: string[]
  eventPrefix?: string
  init(ctx: PluginContext): Promise<void> | void
  destroy?(ctx: PluginContext): Promise<void> | void
  extend?(ctx: PluginExtend): void
  exports?(): Record<string, any>
}

export interface PluginMeta {
  /**
   * define dependencies which the plugin depends on
   */
  dependencies?: string[]

  /**
   * use 'common' as event prefix when eventPrefix is not set.
   */
  eventPrefix?: string
}

export type PluginCreator<O = any> = (options?: O) => Plugin

export interface PluginRegisterOptions {
  /**
   * Will enable plugin registered with auto-initialization immediately
   * other than plugin-manager init all plugins at certain time.
   * It is helpful when plugin register is later than plugin-manager initialization.
   */
  autoInit?: boolean

  /**
   * allow overriding existing plugin with same name when override === true
   */
  override?: boolean
}

/**
 * Assemble APIs for plugins to create context
 */
export interface PluginContextApiAssembler {
  assembleApis(context: PluginContext, pluginName: string, meta: PluginMeta): void
}

export class Plugins {
  private plugins: PluginRuntime[] = []

  pluginsMap: Map<string, PluginRuntime> = new Map()
  pluginContextMap: Map<string, PluginContext> = new Map()

  private contextApiAssembler: PluginContextApiAssembler

  constructor(contextApiAssembler?: PluginContextApiAssembler) {
    if (contextApiAssembler) {
      this.setContextApiAssembler(contextApiAssembler)
    }
  }

  setContextApiAssembler(contextApiAssembler: PluginContextApiAssembler) {
    this.contextApiAssembler = contextApiAssembler
  }

  getPluginContext = (options: PluginContextOptions) => {
    const { pluginName } = options
    let context = this.pluginContextMap.get(pluginName)
    if (!context) {
      context = new PluginContext(options, this.contextApiAssembler)
      this.pluginContextMap.set(pluginName, context)
    }
    return context
  }

  /**
   * register a plugin
   * @param pluginConfigCreator - a creator function which returns the plugin config
   * @param options - the plugin options
   * @param registerOptions - the plugin register options
   */
  async register(pluginModel: Plugin, registerOptions?: PluginRegisterOptions): Promise<void> {
    const config = pluginModel
    const { name: pluginName, deps = [], eventPrefix } = config
    if (!pluginName) {
      logger.error('pluginConfigCreator.pluginName required', pluginModel)
      return
    }
    const meta: PluginMeta = { dependencies: deps, eventPrefix }
    const allowOverride = registerOptions?.override === true

    if (this.pluginsMap.has(pluginName)) {
      if (allowOverride) {
        const originalPlugin = this.pluginsMap.get(pluginName)
        logger.log(
          'plugin override, originalPlugin with name ',
          pluginName,
          ' will be destroyed, config:',
          originalPlugin?.config,
        )
        originalPlugin?.destroy()
        this.pluginsMap.delete(pluginName)
      } else {
        throw new Error(`Plugin with name ${pluginName} exists`)
      }
    }

    const plugin = new PluginRuntime(pluginName, this, config)
    if (registerOptions?.autoInit) {
      await plugin.init()
    }
    this.plugins.push(plugin)
    this.pluginsMap.set(pluginName, plugin)
    logger.log(`plugin registered with pluginName: ${pluginName}, config: `, config, 'meta:', meta)
  }

  /**
   * batch register plugins
   */
  async registerPlugins(plugins: Plugin[], registerOptions?: PluginRegisterOptions) {
    for (const plugin of plugins) {
      await this.register(plugin, registerOptions)
    }
  }

  get(pluginName: string): PluginRuntime | undefined {
    return this.pluginsMap.get(pluginName)
  }

  getAll() {
    return this.plugins
  }

  has(pluginName: string) {
    return this.pluginsMap.has(pluginName)
  }

  async delete(pluginName: string): Promise<boolean> {
    const plugin = this.plugins.find(({ name }) => name === pluginName)
    if (!plugin) return false
    await plugin.destroy()
    const idx = this.plugins.indexOf(plugin)
    this.plugins.splice(idx, 1)
    return this.pluginsMap.delete(pluginName)
  }

  async init() {
    const pluginNames: string[] = []
    const pluginObj: Record<string, PluginRuntime> = {}
    this.plugins.forEach(plugin => {
      pluginNames.push(plugin.name)
      pluginObj[plugin.name] = plugin
    })

    // check plugin dependency
    const { missingTasks, sequence } = sequencify(pluginObj, pluginNames)
    if (missingTasks.length) {
      logger.error('plugin dependency missing', missingTasks)
      return
    }
    logger.log('load plugin sequence:', sequence)

    for (const pluginName of sequence) {
      try {
        await this.pluginsMap.get(pluginName)!.init()
      } catch (e) {
        logger.error(`Failed to init plugin:${pluginName}, it maybe affect those plugins which depend on this.`)
        logger.error(e)
      }
    }
  }

  /**
   * destroy all plugins
   */
  async destroy() {
    for (const plugin of this.plugins) {
      await plugin.destroy()
    }
  }

  async extend() {
    const extendClass: PluginExtendClass = {
      Simulator,
      Viewport,

      Designer,
      Dragon,
      Detecting,
      Selection,
      DropLocation,
      OffsetObserver,

      Project,
      Document,
      History,
      Node,
      NodeChildren,
      Props,
      Prop,

      Materials,
      Setters,
      ComponentMeta,
    }
    const extendMap: Record<keyof PluginExtendClass, PluginExtendClass[keyof PluginExtendClass]> = extendClass

    for (const plugin of this.plugins) {
      await plugin.extend({
        extendClass,
        // @ts-ignore
        extend: (extendClass, properties) => extend(extendMap, extendClass, properties),
      })
    }
  }

  get size() {
    return this.pluginsMap.size
  }

  setDisabled(pluginName: string, flag = true) {
    logger.warn(`plugin:${pluginName} has been set disable:${flag}`)
    this.pluginsMap.get(pluginName)?.setDisabled(flag)
  }

  /**
   * reset plugin manager
   */
  async dispose() {
    await this.destroy()
    this.plugins = []
    this.pluginsMap.clear()
  }

  toProxy() {
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (target.pluginsMap.has(prop as string)) {
          // 禁用态的插件，直接返回 undefined
          if (target.pluginsMap.get(prop as string)!.disabled) {
            return undefined
          }
          return target.pluginsMap.get(prop as string)?.toProxy()
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  }
}

export const isRegisterOptions = (opts: any): opts is PluginRegisterOptions => {
  return opts && ('autoInit' in opts || 'override' in opts)
}
