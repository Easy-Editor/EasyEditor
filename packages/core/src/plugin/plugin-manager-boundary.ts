import type { PluginRuntime } from './plugin-runtime'
import type { Plugins } from './plugins'

interface PluginManagerOperations {
  deleteRuntime(runtime: PluginRuntime): Promise<boolean>
}

const managerOperations = new WeakMap<Plugins, PluginManagerOperations>()

export function installPluginManagerOperations(manager: Plugins, operations: PluginManagerOperations): void {
  if (managerOperations.has(manager)) throw new Error('Plugin manager operations are already installed')
  managerOperations.set(manager, operations)
}

export function deletePluginRuntimeFromManager(manager: Plugins, runtime: PluginRuntime): Promise<boolean> {
  const operations = managerOperations.get(manager)
  if (!operations) throw new Error('Plugin manager operations are not installed')
  return operations.deleteRuntime(runtime)
}
