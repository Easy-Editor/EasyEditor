import type { ConfigOptions } from '../config'
import { EngineInstance } from './engine-instance'
import { clipboard, commonEvent, config, loadingState, resourceRegistry } from './legacy-services'

export { clipboard, commonEvent, config, loadingState, resourceRegistry } from './legacy-services'

export const defaultEngine = new EngineInstance({
  services: {
    clipboard,
    config,
    eventBus: commonEvent,
    loadingState,
    registry: resourceRegistry,
  },
  trustPolicy: 'legacyTrusted',
})

export const init = (options?: ConfigOptions) => defaultEngine.init(options)
export const destroy = () => defaultEngine.destroy()

export const editor = defaultEngine.editor
export const event = defaultEngine.event
export const hotkey = defaultEngine.hotkey
export const logger = defaultEngine.logger
export const materials = defaultEngine.materials
export const plugins = defaultEngine.plugins
export const project = defaultEngine.project
export const setters = defaultEngine.setters
export const commands = defaultEngine.commands
export const transactions = defaultEngine.transactions
