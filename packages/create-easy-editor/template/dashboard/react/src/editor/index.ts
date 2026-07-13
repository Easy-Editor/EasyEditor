import { getPageInfoFromLocalStorage, getPageSchemaFromLocalStorage } from '@/lib/schema'
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  type ProjectSchema,
  type RootSchema,
  validateProjectSchema,
} from '@easy-editor/core/instance'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultRootSchema } from './const'
import { Group, componentMetaMap } from './materials'
import { pluginList } from './plugins'
import { engine } from './runtime'
import { setterMap } from './setters'

import './overrides.css'

let releaseSimulatorReady: (() => void) | undefined
let destroyPromise: Promise<void> | undefined
let lifecycleDisposalInstalled = false

const uninstallLifecycleDisposal = () => {
  if (!lifecycleDisposalInstalled) return
  window.removeEventListener('pagehide', handlePageHide)
  lifecycleDisposalInstalled = false
}

export const destroyEditor = (): Promise<void> => {
  if (destroyPromise) return destroyPromise
  releaseSimulatorReady?.()
  releaseSimulatorReady = undefined
  const destroyAttempt = engine.destroy()
  destroyPromise = destroyAttempt
  void destroyAttempt.then(uninstallLifecycleDisposal, () => {
    if (destroyPromise === destroyAttempt) destroyPromise = undefined
  })
  return destroyAttempt
}

const handlePageHide = (event: PageTransitionEvent) => {
  if (event.persisted) return
  void destroyEditor().catch(error => {
    console.error('[EasyEditor] Editor disposal failed during pagehide:', error)
  })
}

const installLifecycleDisposal = () => {
  if (lifecycleDisposalInstalled) return
  window.addEventListener('pagehide', handlePageHide)
  lifecycleDisposalInstalled = true
  if (import.meta.hot) {
    import.meta.hot.dispose(() => destroyEditor())
  }
}

const createInitialProjectSchema = (): ProjectSchema => {
  const fallback: ProjectSchema = {
    componentsTree: [defaultRootSchema],
    version: CURRENT_PROJECT_SCHEMA_VERSION,
  }
  const pageInfo = getPageInfoFromLocalStorage()
  if (!pageInfo.length) return fallback

  const storedSchemas = pageInfo.map(item => getPageSchemaFromLocalStorage(item.path))
  if (storedSchemas.some(schema => !schema)) return fallback
  const loadedSchemas = storedSchemas
    .filter((schema): schema is ProjectSchema<RootSchema> => schema !== null)
    .map(schema => validateProjectSchema(schema, engine.trustPolicy) as ProjectSchema<RootSchema>)

  return {
    componentsTree: loadedSchemas.map(schema => schema.componentsTree[0]),
    version: CURRENT_PROJECT_SCHEMA_VERSION,
  }
}

const bootstrapEditor = async () => {
  try {
    await engine.plugins.registerPlugins([
      DashboardPlugin({
        group: {
          meta: Group,
          initSchema: {
            componentName: 'Group',
            title: 'Group',
            isGroup: true,
          },
        },
      }),
      HotkeyPlugin(),
      ...pluginList,
    ])
    engine.materials.buildComponentMetasMap(Object.values(componentMetaMap))
    engine.setters.registerSetter(setterMap)

    await engine.init()
    releaseSimulatorReady = engine.project.onSimulatorReady(simulator => {
      simulator.set('deviceStyle', { viewport: { width: 1920, height: 1080 } })
    })
    engine.loadProject(createInitialProjectSchema(), true)
  } catch (startupError) {
    try {
      await destroyEditor()
    } catch (cleanupError) {
      throw new AggregateError([startupError, cleanupError], 'Editor startup and cleanup both failed')
    }
    throw startupError
  }
}

installLifecycleDisposal()
export const editorReady = bootstrapEditor()
await editorReady
