import { getPageInfoFromLocalStorage, getPageSchemaFromLocalStorage } from '@/lib/schema'
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  type ComponentsMap,
  type NpmInfo,
  type ProjectSchema,
  type RootSchema,
  validateProjectSchema,
} from '@easy-editor/core/instance'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultRootSchema } from './const'
import { dashboardExpressionEvaluator } from './expression-policy'
import { Group, componentMetaMap } from './materials'
import { pluginList } from './plugins'
import type { RemotePackageLoadFailure, RemotePackageLoadResult } from './remote/remote-load-batch.js'
import { engine, remoteResources } from './runtime'
import { setterMap } from './setters'

import './overrides.css'

let releaseSimulatorReady: (() => void) | undefined
let disposePromise: Promise<void> | undefined
let lifecycleDisposalInstalled = false

const uninstallLifecycleDisposal = () => {
  if (!lifecycleDisposalInstalled) return
  window.removeEventListener('pagehide', handlePageHide)
  lifecycleDisposalInstalled = false
}

export const disposeDashboardEditor = (): Promise<void> => {
  if (disposePromise) return disposePromise
  releaseSimulatorReady?.()
  releaseSimulatorReady = undefined
  const destroyAttempt = engine.destroy()
  disposePromise = destroyAttempt
  void destroyAttempt.then(uninstallLifecycleDisposal, () => {
    if (disposePromise === destroyAttempt) disposePromise = undefined
  })
  return destroyAttempt
}

const handlePageHide = (event: PageTransitionEvent) => {
  if (event.persisted) return
  void disposeDashboardEditor().catch(error => {
    console.error('[EasyEditor] Dashboard disposal failed during pagehide:', error)
  })
}

const installLifecycleDisposal = () => {
  if (lifecycleDisposalInstalled) return
  window.addEventListener('pagehide', handlePageHide)
  lifecycleDisposalInstalled = true
  if (import.meta.hot) {
    import.meta.hot.dispose(() => disposeDashboardEditor())
  }
}

const formatRemoteFailure = (failure: RemotePackageLoadFailure): string =>
  `${failure.package}@${failure.version} (${failure.globalName}): ${failure.error.message}`

const reportOptionalRemoteFailures = (kind: string, result: RemotePackageLoadResult): void => {
  for (const failure of result.failures) {
    console.warn(`[EasyEditor] Optional remote ${kind} failed: ${formatRemoteFailure(failure)}`, failure.error)
  }
}

const assertRequiredRemoteMaterialsLoaded = (result: RemotePackageLoadResult): void => {
  if (!result.failed) return
  throw new AggregateError(
    result.failures.map(failure => new Error(`Required remote material failed: ${formatRemoteFailure(failure)}`)),
    'Required remote materials from the project schema failed to load',
  )
}

const registerMissingLocalSetters = (): void => {
  for (const [type, setter] of Object.entries(setterMap)) {
    if (!engine.setters.getSetter(type)) engine.setters.registerSetter(type, setter)
  }
}

const loadRemoteMaterialsFromComponentsMap = async (componentsMap?: ComponentsMap) => {
  if (!componentsMap?.length) return

  const remoteMaterials: Array<{ package: string; version?: string; globalName: string }> = []
  const seenPackages = new Set<string>()
  for (const component of componentsMap) {
    if (!('package' in component) || !('globalName' in component)) continue
    const npmInfo = component as NpmInfo
    const packageKey = `${npmInfo.package}@${npmInfo.version || 'latest'}`
    if (seenPackages.has(packageKey) || !npmInfo.globalName) continue
    seenPackages.add(packageKey)
    remoteMaterials.push({
      package: npmInfo.package,
      version: npmInfo.version || 'latest',
      globalName: npmInfo.globalName,
    })
  }

  if (!remoteMaterials.length) return
  const result = await remoteResources.materialManager.loadMetaMultiple(remoteMaterials)
  assertRequiredRemoteMaterialsLoaded(result)
}

const autoLoadAllRemoteComponents = async () => {
  const pendingPackages = remoteResources.materialManager.getLoadedPackages().filter(pkg => !pkg.hasComponent)
  if (!pendingPackages.length) return
  const results = await Promise.allSettled(
    pendingPackages.map(pkg => remoteResources.materialManager.addComponent(pkg.name)),
  )
  const failed = results.filter(result => result.status === 'rejected').length
  if (failed) console.warn(`[EasyEditor] ${failed} remote components failed to auto-load`)
}

const createInitialProjectSchema = async (): Promise<ProjectSchema> => {
  const fallback: ProjectSchema = {
    componentsTree: [defaultRootSchema],
    version: CURRENT_PROJECT_SCHEMA_VERSION,
  }
  const pageInfo = getPageInfoFromLocalStorage()
  if (!pageInfo?.length) return fallback

  const schemas = pageInfo.map(item => getPageSchemaFromLocalStorage(item.path) as ProjectSchema<RootSchema> | null)
  if (schemas.some(schema => !schema)) return fallback

  const loadedSchemas = schemas
    .filter((schema): schema is ProjectSchema<RootSchema> => schema !== null)
    .map(schema => validateProjectSchema(schema, engine.trustPolicy) as ProjectSchema<RootSchema>)
  if (!loadedSchemas.length) return fallback

  const componentsMap: ComponentsMap = []
  const seenComponents = new Set<string>()
  for (const schema of loadedSchemas) {
    for (const component of schema.componentsMap || []) {
      const key =
        'package' in component ? `${component.package}@${component.componentName || ''}` : component.componentName || ''
      if (seenComponents.has(key)) continue
      seenComponents.add(key)
      componentsMap.push(component)
    }
  }

  await loadRemoteMaterialsFromComponentsMap(componentsMap)
  return {
    componentsTree: loadedSchemas.map(schema => schema.componentsTree[0]),
    componentsMap,
    version: CURRENT_PROJECT_SCHEMA_VERSION,
  }
}

const bootstrapDashboardEditor = async () => {
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

    await engine.init({
      appHelper: { expressionEvaluator: dashboardExpressionEvaluator },
    })
    releaseSimulatorReady = engine.project.onSimulatorReady(simulator => {
      simulator.set('deviceStyle', { viewport: { width: 1920, height: 1080 } })
    })

    const remoteResult = await remoteResources.loadAllRemoteResources()
    reportOptionalRemoteFailures('material metadata', remoteResult.materials)
    reportOptionalRemoteFailures('setter package', remoteResult.setters)
    registerMissingLocalSetters()

    const projectSchema = await createInitialProjectSchema()
    engine.loadProject(projectSchema, true)

    void remoteResources
      .runBackground('auto-load remote component implementations', autoLoadAllRemoteComponents)
      .catch(error => {
        if (remoteResources.scope.isActive) {
          console.error('[EasyEditor] Failed to auto-load remote components:', error)
        }
      })
  } catch (startupError) {
    try {
      await disposeDashboardEditor()
    } catch (cleanupError) {
      throw new AggregateError([startupError, cleanupError], 'Dashboard startup and cleanup both failed')
    }
    throw startupError
  }
}

installLifecycleDisposal()
export const editorReady = bootstrapDashboardEditor()
await editorReady
