import {
  type ConfigOptions,
  Designer,
  Event,
  Hotkey,
  Materials,
  type PluginContext,
  type PluginContextApiAssembler,
  type PluginMeta,
  Plugins,
  Setters,
  commonEvent,
  config,
  createLogger,
} from '@easy-editor/core'
import { Editor } from './editor'

const editor = new Editor()
const designer = new Designer({ editor })
const { project } = designer
const hotkey = new Hotkey()
const setters = new Setters()
const material = new Materials(editor)

editor.set('designer', designer)
editor.set('project', project)
editor.set('setters', setters)
editor.set('materials', material)
editor.set('hotkey', hotkey)

const event = new Event(commonEvent, { prefix: 'common' })
const logger = createLogger('common')
let plugins: Plugins

const pluginContextApiAssembler: PluginContextApiAssembler = {
  assembleApis: (context: PluginContext, pluginName: string, meta: PluginMeta) => {
    context.hotkey = hotkey
    context.project = project
    context.setters = setters
    context.material = material
    const eventPrefix = meta?.eventPrefix || 'common'
    context.event = new Event(commonEvent, { prefix: eventPrefix })
    context.config = config
    context.plugins = plugins
    context.logger = createLogger(`plugin:${pluginName}`)
  },
}

const innerPlugins = new Plugins(pluginContextApiAssembler)
plugins = innerPlugins.toProxy()
editor.set('innerPlugins', innerPlugins)
editor.set('plugins', plugins)

export const version = '_EASY_EDITOR_ENGINE_VERSION_'
config.set('ENGINE_VERSION', version)

export const init = async (options?: ConfigOptions) => {
  // await destroy()

  if (options) {
    config.setEngineOptions(options)
  }

  await plugins.extend()

  await plugins.init()
}

export const destroy = async () => {
  // remove all documents
  const { documents } = project
  if (Array.isArray(documents) && documents.length > 0) {
    documents.forEach(doc => project.removeDocument(doc))
  }

  await plugins.destroy()
}

export { config, event, hotkey, logger, material, plugins, project, setters }
