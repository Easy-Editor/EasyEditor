import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  type ComponentsMap,
  DESIGNER_EVENT,
  DragObjectType,
  type NpmInfo,
  type ProjectSchema,
  validateProjectSchema,
} from '@easy-editor/core/instance'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import HotkeyPlugin from '@easy-editor/plugin-hotkey'
import type { CanonicalWorkingDraftV1 } from '../lib/storage/contracts.mjs'
import {
  DASHBOARD_ONLINE_COMPONENT_BRIDGE_KEY,
  createDashboardOnlineComponentSurfaceBridge,
  dispatchDashboardOnlineComponentRuntimeEvent,
  isDashboardOnlineComponentSurfaceEnabled,
  resolveDashboardOnlineComponentSafeBoot,
  startDashboardOnlineComponentSurface,
} from '../runtime/online-components/surface-bridge.mjs'
import {
  DASHBOARD_NODE_ADD_EVENT,
  DASHBOARD_NODE_REMOVE_EVENT,
  type DashboardObservedMutationAttribution,
} from './agent/persistence/mutation-attribution.mjs'
import { defaultRootSchema } from './const'
import {
  createDashboardDataRuntime,
  createDashboardDataSourceRenderReducer,
  dashboardDataSourceRenderStage,
} from './data'
import { dashboardExpressionEvaluator } from './expression-policy'
import { Group, componentMetaMap } from './materials'
import { pluginList } from './plugins'
import type { RemotePackageLoadFailure, RemotePackageLoadResult } from './remote/remote-load-batch.js'
import {
  captureDashboardPersistenceInput,
  composeDashboardAgentHost,
  dashboardAgentRuntimeFeatureFlags,
  dashboardMaterialGcRuntime,
  dashboardPersistence,
  disposeDashboardAgentActivity,
  engine,
  remoteResources,
} from './runtime'
import { setterMap } from './setters'
import { dashboardEditorSurfaceLifecycle } from './surface-lifecycle.mjs'

import './overrides.css'

export { composeDashboardAgentHost, dashboardAgentRuntimeFeatureFlags }
export { dashboardEditorSurfaceLifecycle }
export type { DashboardEditorSurfacePhase } from './surface-lifecycle.mjs'
export type { DashboardAgentHostAuthority } from './agent/host/index.mjs'

const dashboardDataRuntime = createDashboardDataRuntime({
  expressionEvaluator: dashboardExpressionEvaluator,
  getProjectId: () => dashboardPersistence.getSnapshot().projectId,
  safeDataEnabled: dashboardAgentRuntimeFeatureFlags.data,
})
const dashboardDataSourceRenderReducer = createDashboardDataSourceRenderReducer({
  safeDataEnabled: dashboardAgentRuntimeFeatureFlags.data,
})
const dashboardOnlineComponentSurfaceEnabled = isDashboardOnlineComponentSurfaceEnabled(
  dashboardAgentRuntimeFeatureFlags,
)
const dashboardOnlineComponentSurfaceBridge = dashboardOnlineComponentSurfaceEnabled
  ? createDashboardOnlineComponentSurfaceBridge({
      onError: error => console.error('[EasyEditor] Dashboard online component editor surface failed:', error),
    })
  : null

let releaseSimulatorReady: (() => void) | undefined
let releasePersistenceListeners: Array<() => void> = []
const dashboardEditorDisposers = new Set<() => void | Promise<void>>()
let disposePromise: Promise<void> | undefined
let editorDisposalStarted = false
let lifecycleDisposalInstalled = false

dashboardEditorDisposers.add(() => dashboardDataRuntime.dispose())

export const registerDashboardEditorDisposer = (disposer: () => void | Promise<void>): (() => void) => {
  if (editorDisposalStarted) throw new Error('Dashboard editor disposal has already started')
  dashboardEditorDisposers.add(disposer)
  let registered = true
  return () => {
    if (!registered) return
    registered = false
    dashboardEditorDisposers.delete(disposer)
  }
}

const uninstallLifecycleDisposal = () => {
  if (!lifecycleDisposalInstalled) return
  window.removeEventListener('pagehide', handlePageHide)
  lifecycleDisposalInstalled = false
}

export const disposeDashboardEditor = (): Promise<void> => {
  if (disposePromise) return disposePromise
  editorDisposalStarted = true
  releaseSimulatorReady?.()
  releaseSimulatorReady = undefined
  for (const release of releasePersistenceListeners.splice(0)) release()
  const registeredDisposers = [...dashboardEditorDisposers].reverse()
  dashboardEditorDisposers.clear()
  const disposalAttempt = (async () => {
    const failures: unknown[] = []
    for (const dispose of registeredDisposers) {
      try {
        await dispose()
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      disposeDashboardAgentActivity()
    } catch (error) {
      failures.push(error)
    }
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
    if (failures.length > 1) throw new AggregateError(failures, 'Dashboard editor disposal failed')
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

const recordAttributedMutation = (attribution: DashboardObservedMutationAttribution | null) => {
  if (!attribution) return
  dashboardPersistence.recordMutationAttribution(attribution)
  scheduleDashboardAutosave()
}

const scheduleUnattributedDashboardAutosave = () => {
  if (dashboardPersistence.getMutationAttribution().activeAgentCallId !== null) return
  scheduleDashboardAutosave()
}

const installPersistenceListeners = () => {
  if (releasePersistenceListeners.length) return
  const attribution = dashboardPersistence.getMutationAttribution()
  releasePersistenceListeners = [
    engine.designer.onEvent(DESIGNER_EVENT.NODE_PROPS_CHANGE, value => {
      recordAttributedMutation(attribution.captureFieldMutation(value))
    }),
    engine.designer.onEvent(DESIGNER_EVENT.NODE_VISIBLE_CHANGE, node => {
      recordAttributedMutation(attribution.captureBuiltinFieldMutation(node, 'hidden'))
    }),
    engine.designer.onEvent(DESIGNER_EVENT.NODE_LOCK_CHANGE, node => {
      recordAttributedMutation(attribution.captureBuiltinFieldMutation(node, 'locked'))
    }),
    engine.designer.onEvent(DESIGNER_EVENT.NODE_CHILDREN_CHANGE, value => {
      recordAttributedMutation(attribution.captureStructuralMutation(value, 'children'))
    }),
    engine.designer.onEvent(DESIGNER_EVENT.NODE_REMOVE, value => {
      recordAttributedMutation(attribution.captureStructuralMutation(value))
    }),
    engine.designer.onEvent(DASHBOARD_NODE_ADD_EVENT, value => {
      recordAttributedMutation(attribution.captureStructuralMutation(value))
    }),
    engine.designer.onEvent(DASHBOARD_NODE_REMOVE_EVENT, value => {
      recordAttributedMutation(attribution.captureStructuralMutation(value))
    }),
    engine.designer.onEvent(DESIGNER_EVENT.CURRENT_DOCUMENT_CHANGE, scheduleUnattributedDashboardAutosave),
    engine.designer.onEvent(DESIGNER_EVENT.CURRENT_HISTORY_CHANGE, scheduleUnattributedDashboardAutosave),
    engine.designer.onEvent(DESIGNER_EVENT.INSERT_NODE_BEFORE, scheduleUnattributedDashboardAutosave),
    engine.designer.onEvent(DESIGNER_EVENT.INSERT_NODE_AFTER, scheduleUnattributedDashboardAutosave),
  ]
  releasePersistenceListeners.push(
    engine.project.onDocumentAdd(() => recordAttributedMutation(attribution.captureUnknownMutation())),
    engine.project.onDocumentRemove(() => recordAttributedMutation(attribution.captureUnknownMutation())),
    engine.project.onCurrentDocumentChange(scheduleUnattributedDashboardAutosave),
  )
}

/**
 * Stops editor-originated persistence writes while a branch restore owns the
 * canonical project binding. The caller must always either reattach the
 * listeners to the old binding or finish loading the restored binding.
 */
export const detachDashboardPersistenceListeners = async (): Promise<void> => {
  for (const release of releasePersistenceListeners.splice(0)) release()
  try {
    await dashboardEditorSurfaceLifecycle.suspend()
  } catch (error) {
    installPersistenceListeners()
    throw error
  }
}

export const reattachDashboardPersistenceListeners = async (): Promise<void> => {
  await dashboardEditorSurfaceLifecycle.resume()
  installPersistenceListeners()
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

/**
 * Loads a canonical, already-durable draft into the editor. Validation and
 * remote material discovery happen before the project swap so a rejected
 * restore leaves the currently rendered project untouched.
 */
export const loadDashboardEditorDraft = async (draft: CanonicalWorkingDraftV1): Promise<void> => {
  const schema = validateProjectSchema(
    draft.projectSchema as unknown as ProjectSchema,
    engine.trustPolicy,
  ) as ProjectSchema
  await loadRemoteMaterialsFromComponentsMap(schema.componentsMap)
  engine.loadProject(schema, true)
  restoreActiveDocument(draft.activeDocument)
}

const bootstrapDashboardEditor = async () => {
  try {
    await engine.plugins.registerPlugins([
      dashboardDataRuntime.plugin,
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
    engine.designer.addPropsReducer(dashboardDataSourceRenderReducer, dashboardDataSourceRenderStage)
    engine.materials.buildComponentMetasMap(Object.values(componentMetaMap))

    await engine.init({
      appHelper: {
        expressionEvaluator: dashboardExpressionEvaluator,
        ...(dashboardOnlineComponentSurfaceBridge
          ? { [DASHBOARD_ONLINE_COMPONENT_BRIDGE_KEY]: dashboardOnlineComponentSurfaceBridge }
          : {}),
      },
    })
    releaseSimulatorReady = engine.project.onSimulatorReady(simulator => {
      simulator.set('deviceStyle', { viewport: { width: 1920, height: 1080 } })
    })

    const remoteResult = await remoteResources.loadAllRemoteResources()
    reportOptionalRemoteFailures('material metadata', remoteResult.materials)
    reportOptionalRemoteFailures('setter package', remoteResult.setters)
    registerMissingLocalSetters()

    const initialProject = await createInitialProjectSchema()
    if (dashboardOnlineComponentSurfaceEnabled && dashboardOnlineComponentSurfaceBridge) {
      const persistenceSnapshot = dashboardPersistence.getSnapshot()
      if (!persistenceSnapshot.projectId || !persistenceSnapshot.branchId) {
        throw new Error('Dashboard online component editor surface requires an active persistence scope')
      }
      const surface = startDashboardOnlineComponentSurface({
        enabled: true,
        safeBoot: resolveDashboardOnlineComponentSafeBoot(window.location.search),
        mode: 'editor',
        projectId: persistenceSnapshot.projectId,
        branchId: persistenceSnapshot.branchId,
        surfaceId: 'dashboard-editor-online',
        bridge: dashboardOnlineComponentSurfaceBridge,
        markerStore: window.localStorage,
        persistence: dashboardPersistence,
        document: window.document,
        bindTrustedShell: (shell, instanceId) =>
          engine.designer.dragon.from(
            shell,
            () => {
              const node = engine.project.currentDocument?.getNode(instanceId)
              return node ? { type: DragObjectType.Node, nodes: [node] } : null
            },
            'mouse',
          ),
        onSelection: event => {
          if (event.type === 'select' || event.type === 'drag-start') {
            engine.designer.selection.select(event.instanceId)
          }
        },
        onRuntimeEvent: event => dispatchDashboardOnlineComponentRuntimeEvent(window, event),
      })
      registerDashboardEditorDisposer(() => surface.dispose())
    }
    engine.loadProject(initialProject.schema, true)
    restoreActiveDocument(initialProject.activeDocument)
    installPersistenceListeners()
    dashboardMaterialGcRuntime.trigger('startup')

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
