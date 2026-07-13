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
import {
  type PluginExtend,
  type PluginExtendClass,
  type PrototypeExtensionOperation,
  applyPrototypeExtensionBatch,
  assertProcessPrototypeExtensionsAllowed,
} from './plugin-extend'
import { PluginRuntime } from './plugin-runtime'
import { sequencify } from './sequencify'

const logger = createLogger('PluginManager')

export interface Plugin {
  name: string
  deps?: string[]
  eventPrefix?: string
  /** Stable identity for process-wide prototype extensions. */
  extensionFingerprint?: string
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

  private initialized = false

  pluginsMap: Map<string, PluginRuntime> = new Map()
  pluginContextMap: Map<string, PluginContext> = new Map()

  private contextApiAssembler: PluginContextApiAssembler = {
    assembleApis() {},
  }

  private contextOptions: Omit<PluginContextOptions, 'pluginName' | 'meta'> = {}

  constructor(
    contextApiAssembler?: PluginContextApiAssembler,
    contextOptions?: Omit<PluginContextOptions, 'pluginName' | 'meta'>,
    private readonly assertPrototypeExtensionsAllowed: (origin: string) => void = () => {},
  ) {
    if (contextApiAssembler) {
      this.setContextApiAssembler(contextApiAssembler)
    }
    if (contextOptions) {
      this.contextOptions = contextOptions
    }
  }

  setContextApiAssembler(contextApiAssembler: PluginContextApiAssembler) {
    this.contextApiAssembler = contextApiAssembler
  }

  setContextOptions(contextOptions: Omit<PluginContextOptions, 'pluginName' | 'meta'>) {
    this.contextOptions = contextOptions
  }

  getPluginContext = (options: PluginContextOptions) => {
    const { pluginName } = options
    let context = this.pluginContextMap.get(pluginName)
    if (!context) {
      context = new PluginContext({ ...this.contextOptions, ...options }, this.contextApiAssembler)
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
    if (typeof config.extend === 'function') {
      this.assertPrototypeExtensionsAllowed('plugins.register')
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
        await originalPlugin?.destroy()
        const index = originalPlugin ? this.plugins.indexOf(originalPlugin) : -1
        if (index >= 0) {
          this.plugins.splice(index, 1)
        }
        this.pluginContextMap.get(pluginName)?.dispose()
        this.pluginContextMap.delete(pluginName)
        this.pluginsMap.delete(pluginName)
      } else {
        throw new Error(`Plugin with name ${pluginName} exists`)
      }
    }

    const plugin = new PluginRuntime(pluginName, this, config)
    this.plugins.push(plugin)
    this.pluginsMap.set(pluginName, plugin)
    if (registerOptions?.autoInit) {
      try {
        if (!this.initialized) {
          throw new Error('Plugin autoInit requires an initialized plugin manager')
        }
        if (typeof config.extend === 'function') {
          throw new Error('Prototype-extension plugins cannot use autoInit; restart the engine to preflight them')
        }
        this.preflight()
        await plugin.init()
      } catch (error) {
        this.plugins.pop()
        this.pluginsMap.delete(pluginName)
        this.pluginContextMap.get(pluginName)?.dispose()
        this.pluginContextMap.delete(pluginName)
        throw error
      }
    }
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
    this.pluginContextMap.get(pluginName)?.dispose()
    this.pluginContextMap.delete(pluginName)
    return this.pluginsMap.delete(pluginName)
  }

  async init() {
    const sequence = this.preflight()

    logger.log('load plugin sequence:', sequence)

    const initialized: PluginRuntime[] = []
    try {
      for (const pluginName of sequence) {
        const plugin = this.pluginsMap.get(pluginName)!
        const wasInited = plugin.isInited()
        await plugin.init()
        if (!wasInited && plugin.isInited()) {
          initialized.push(plugin)
        }
      }
      this.initialized = true
    } catch (error) {
      this.initialized = false
      const rollbackErrors: unknown[] = []
      for (const plugin of initialized.reverse()) {
        try {
          await plugin.destroy()
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      if (rollbackErrors.length) {
        const message = error instanceof Error ? error.message : String(error)
        const aggregate = new AggregateError(
          [error, ...rollbackErrors],
          `Plugin initialization failed: ${message}; rollback also failed`,
        )
        throw aggregate
      }
      throw error
    }
  }

  preflight(): string[] {
    const pluginNames: string[] = []
    const pluginObj: Record<string, PluginRuntime> = {}
    this.plugins.forEach(plugin => {
      pluginNames.push(plugin.name)
      pluginObj[plugin.name] = plugin
    })

    // check plugin dependency
    const { missingTasks, recursiveDependencies, sequence } = sequencify(pluginObj, pluginNames)
    if (missingTasks.length) {
      throw new Error(`Plugin dependency missing: ${missingTasks.join(', ')}`)
    }
    if (recursiveDependencies.length) {
      throw new Error(
        `Plugin dependency cycle detected: ${recursiveDependencies.map(items => items.join(' -> ')).join(', ')}`,
      )
    }
    return sequence
  }

  /**
   * destroy all plugins
   */
  async destroy() {
    const errors: unknown[] = []
    for (const plugin of [...this.plugins].reverse()) {
      try {
        await plugin.destroy()
      } catch (error) {
        errors.push(error)
      }
    }
    this.initialized = false
    if (errors.length) {
      throw new AggregateError(errors, 'One or more plugins failed to destroy')
    }
  }

  async extend() {
    if (this.hasPrototypeExtensions()) {
      this.assertPrototypeExtensionsAllowed('plugins.extend')
      assertProcessPrototypeExtensionsAllowed()
    }
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

    const operations: PrototypeExtensionOperation[] = []
    const preparedPlugins: PluginRuntime[] = []
    for (const plugin of this.plugins) {
      const extensionFingerprint =
        plugin.config.extensionFingerprint ||
        `${plugin.name}:${typeof plugin.config.extend === 'function' ? Function.prototype.toString.call(plugin.config.extend) : 'no-extension'}`
      const prepared = await plugin.prepareExtension({
        extendClass,
        extend: (targetClass, properties) =>
          operations.push({
            extendClass: targetClass,
            // The public API preserves the target-specific generic; the batch
            // stores the same runtime class map for deferred atomic application.
            extendMap: extendMap as any,
            properties,
            registration: {
              fingerprint: extensionFingerprint,
              pluginName: plugin.name,
            },
          }),
      })
      if (prepared) preparedPlugins.push(plugin)
    }
    applyPrototypeExtensionBatch(operations)
    preparedPlugins.forEach(plugin => plugin.markExtended())
  }

  hasPrototypeExtensions(): boolean {
    return this.plugins.some(plugin => typeof plugin.config.extend === 'function')
  }

  clearContexts(): void {
    const errors: unknown[] = []
    for (const context of this.pluginContextMap.values()) {
      try {
        context.dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    this.pluginContextMap.clear()
    if (errors.length) {
      throw new AggregateError(errors, 'One or more plugin contexts failed to dispose')
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
    let destroyError: unknown
    let contextError: unknown
    try {
      await this.destroy()
    } catch (error) {
      destroyError = error
    } finally {
      try {
        this.clearContexts()
      } catch (error) {
        contextError = error
      }
      this.plugins = []
      this.pluginsMap.clear()
    }
    const errors = [destroyError, contextError].filter(error => error !== undefined)
    if (errors.length) {
      throw new AggregateError(errors, 'Plugin manager failed to dispose cleanly')
    }
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
