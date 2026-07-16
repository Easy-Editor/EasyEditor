import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  type ComponentsMap,
  DESIGNER_EVENT,
  type NpmInfo,
  type ProjectSchema,
  validateProjectSchema,
} from '@easy-editor/core/instance'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import { defaultRootSchema } from './const'
import { dashboardExpressionEvaluator } from './expression-policy'
import { Group, componentMetaMap } from './materials'
import { pluginList } from './plugins'
import type { RemotePackageLoadFailure, RemotePackageLoadResult } from './remote/remote-load-batch.js'
import {
  captureDashboardPersistenceInput,
  composeDashboardAgentHost,
  dashboardAgentRuntimeFeatureFlags,
  dashboardPersistence,
  engine,
  remoteResources,
} from './runtime'
import { setterMap } from './setters'

import './overrides.css'

export { composeDashboardAgentHost, dashboardAgentRuntimeFeatureFlags }
export type { DashboardAgentHostAuthority } from './agent/host/index.mjs'

let releaseSimulatorReady: (() => void) | undefined
let releasePersistenceListeners: Array<() => void> = []
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
  for (const release of releasePersistenceListeners.splice(0)) release()
  const disposalAttempt = (async () => {
    const failures: unknown[] = []
    try {
      await dashboardPersistence.dispose()
    } catch (error) {
      failures.push(error)
    }
    try {
      await engine.destroy()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Dashboard persistence and engine disposal failed')
  })()
  disposePromise = disposalAttempt
  void disposalAttempt.then(uninstallLifecycleDisposal, () => {
    if (disposePromise === disposalAttempt) disposePromise = undefined
  })
  return disposalAttempt
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

const createInitialProjectSchema = async () => {
  const fallback: ProjectSchema = {
    componentsTree: [defaultRootSchema],
    version: CURRENT_PROJECT_SCHEMA_VERSION,
  }
  const draft = await dashboardPersistence.initialize(
    fallback as unknown as Parameters<typeof dashboardPersistence.initialize>[0],
  )
  const schema = validateProjectSchema(
    draft.projectSchema as unknown as ProjectSchema,
    engine.trustPolicy,
  ) as ProjectSchema
  await loadRemoteMaterialsFromComponentsMap(schema.componentsMap)
  return { activeDocument: draft.activeDocument, schema }
}

const scheduleDashboardAutosave = () => {
  dashboardPersistence.scheduleAutosave(captureDashboardPersistenceInput)
}

const installPersistenceListeners = () => {
  if (releasePersistenceListeners.length) return
  const mutationEvents = [
    DESIGNER_EVENT.CURRENT_DOCUMENT_CHANGE,
    DESIGNER_EVENT.CURRENT_HISTORY_CHANGE,
    DESIGNER_EVENT.INSERT_NODE_BEFORE,
    DESIGNER_EVENT.INSERT_NODE_AFTER,
    DESIGNER_EVENT.NODE_VISIBLE_CHANGE,
    DESIGNER_EVENT.NODE_LOCK_CHANGE,
    DESIGNER_EVENT.NODE_CHILDREN_CHANGE,
    DESIGNER_EVENT.NODE_PROPS_CHANGE,
    DESIGNER_EVENT.NODE_REMOVE,
  ]
  releasePersistenceListeners = mutationEvents.map(event => engine.designer.onEvent(event, scheduleDashboardAutosave))
  releasePersistenceListeners.push(
    engine.project.onDocumentAdd(scheduleDashboardAutosave),
    engine.project.onDocumentRemove(scheduleDashboardAutosave),
    engine.project.onCurrentDocumentChange(scheduleDashboardAutosave),
  )
}

const restoreActiveDocument = (
  activeDocument: Awaited<ReturnType<typeof dashboardPersistence.initialize>>['activeDocument'],
) => {
  if (!activeDocument) return
  const document =
    engine.project.getDocument(activeDocument.documentId) ??
    engine.project.getDocumentByFileName(activeDocument.fileName) ??
    engine.project.documents[activeDocument.index]
  if (!document) throw new Error('Canonical Dashboard active document cannot be restored')
  engine.project.open(document)
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

    const initialProject = await createInitialProjectSchema()
    engine.loadProject(initialProject.schema, true)
    restoreActiveDocument(initialProject.activeDocument)
    installPersistenceListeners()

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
