import type { PluginContext, PluginContextOptions } from './plugin-context'
import type { PluginRuntime } from './plugin-runtime'
import type { PluginManager, Plugins } from './plugins'

interface PluginManagerOperations {
  createFacade(): PluginManager
  deleteRuntime(runtime: PluginRuntime): Promise<boolean>
  extend(): Promise<void>
  getPluginContext(options: PluginContextOptions, runtime: PluginRuntime): PluginContext
  hasPrototypeExtensions(): boolean
  init(): Promise<void>
  isLifecycleHookInvocationActive(): boolean
  preflight(): string[]
  publishPluginContext(pluginName: string, runtime: PluginRuntime, context: PluginContext): void
  releasePluginContext(pluginName: string, context: PluginContext): void
  runLifecycleHook<T>(operation: () => T | PromiseLike<T>): Promise<T>
}

const managerOperations = new WeakMap<Plugins, PluginManagerOperations>()

export function installPluginManagerOperations(manager: Plugins, operations: PluginManagerOperations): void {
  if (managerOperations.has(manager)) throw new Error('Plugin manager operations are already installed')
  managerOperations.set(manager, operations)
}

export function deletePluginRuntimeFromManager(manager: Plugins, runtime: PluginRuntime): Promise<boolean> {
  return getOperations(manager).deleteRuntime(runtime)
}

const getOperations = (manager: Plugins): PluginManagerOperations => {
  const operations = managerOperations.get(manager)
  if (!operations) throw new Error('Plugin manager operations are not installed')
  return operations
}

export const createPluginManagerFacade = (manager: Plugins): PluginManager => getOperations(manager).createFacade()

export const extendPluginManager = (manager: Plugins): Promise<void> => getOperations(manager).extend()

export const getPluginContextFromManager = (
  manager: Plugins,
  options: PluginContextOptions,
  runtime: PluginRuntime,
): PluginContext => getOperations(manager).getPluginContext(options, runtime)

export const initPluginManager = (manager: Plugins): Promise<void> => getOperations(manager).init()

export const isPluginLifecycleHookInvocationActive = (manager: Plugins): boolean =>
  getOperations(manager).isLifecycleHookInvocationActive()

export const pluginManagerHasPrototypeExtensions = (manager: Plugins): boolean =>
  getOperations(manager).hasPrototypeExtensions()

export const preflightPluginManager = (manager: Plugins): string[] => getOperations(manager).preflight()

export const publishPluginContextToManager = (
  manager: Plugins,
  pluginName: string,
  runtime: PluginRuntime,
  context: PluginContext,
): void => getOperations(manager).publishPluginContext(pluginName, runtime, context)

export const releasePluginContextFromManager = (manager: Plugins, pluginName: string, context: PluginContext): void =>
  getOperations(manager).releasePluginContext(pluginName, context)

export const runPluginLifecycleHook = <T>(manager: Plugins, operation: () => T | PromiseLike<T>): Promise<T> =>
  getOperations(manager).runLifecycleHook(operation)
