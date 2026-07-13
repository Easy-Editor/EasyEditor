import type { PluginExtend } from './plugin-extend'
import type { PluginRuntime } from './plugin-runtime'
import type { Plugin } from './plugins'

interface PluginRuntimeOperations {
  destroy(): Promise<void>
  getConfig(): Plugin
  init(forceInit?: boolean): Promise<void>
  markExtended(): void
  prepareExtension(pluginExtend: PluginExtend): Promise<boolean>
  publishContext(): void
}

const runtimeOperations = new WeakMap<PluginRuntime, PluginRuntimeOperations>()

export function installPluginRuntimeOperations(runtime: PluginRuntime, operations: PluginRuntimeOperations): void {
  if (runtimeOperations.has(runtime)) throw new Error('Plugin runtime operations are already installed')
  runtimeOperations.set(runtime, operations)
}

const getOperations = (runtime: PluginRuntime): PluginRuntimeOperations => {
  const operations = runtimeOperations.get(runtime)
  if (!operations) throw new Error('Plugin runtime operations are not installed')
  return operations
}

export const getPluginRuntimeConfig = (runtime: PluginRuntime): Plugin => getOperations(runtime).getConfig()

export const initPluginRuntime = (runtime: PluginRuntime, forceInit = false): Promise<void> =>
  getOperations(runtime).init(forceInit)

export const destroyPluginRuntime = (runtime: PluginRuntime): Promise<void> => getOperations(runtime).destroy()

export const preparePluginRuntimeExtension = (runtime: PluginRuntime, pluginExtend: PluginExtend): Promise<boolean> =>
  getOperations(runtime).prepareExtension(pluginExtend)

export const markPluginRuntimeExtended = (runtime: PluginRuntime): void => getOperations(runtime).markExtended()

export const publishPluginRuntimeContext = (runtime: PluginRuntime): void => getOperations(runtime).publishContext()
