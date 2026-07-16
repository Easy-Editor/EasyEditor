import {
  type EngineInstance,
  type RemoteAccessRequest,
  TransactionCommittedError,
  TransactionRollbackIncompleteError,
  createEngine,
} from '@easy-editor/core/instance'
import { createDashboardUmdGlobals } from '../globals'
import { createHumanActivityLease, installHumanActivityTracking } from './agent/activity/index.mjs'
import { resolveAgentRuntimeFeatureFlags } from './agent/feature-flags.mjs'
import {
  type DashboardAgentHost,
  type DashboardAgentHostAuthority,
  createDashboardAgentHost,
} from './agent/host/index.mjs'
import { createDashboardAgentPersistencePort } from './agent/persistence/agent-persistence-port.mjs'
import {
  type DashboardPersistenceInput,
  type DashboardPersistenceSaveResult,
  createDashboardPersistenceRuntime,
} from './persistence-runtime'
import { DashboardRemoteResources } from './remote/dashboard-remote-resources'

const engineReference: { current?: EngineInstance } = {}

export const remoteResources = new DashboardRemoteResources({
  authorize: (request: RemoteAccessRequest) => {
    if (!engineReference.current) throw new Error('Dashboard engine is not composed')
    return engineReference.current.remote.request(request)
  },
  environment: {
    document: window.document,
    fetch: window.fetch.bind(window),
    importModule: url => import(/* @vite-ignore */ url),
    WebSocket: window.WebSocket,
    window,
  },
  hostGlobals: createDashboardUmdGlobals(),
})

export const engine: EngineInstance = createEngine({
  trustPolicy: 'legacyTrusted',
  hostWindow: window,
  remoteAdapter: remoteResources,
})

engineReference.current = engine
remoteResources.bindEngine(engine)

export const dashboardAgentRuntimeFeatureFlags = resolveAgentRuntimeFeatureFlags(import.meta.env)

const dashboardHumanActivityLease = createHumanActivityLease()
let releaseDashboardHumanActivityTracking: (() => void) | null =
  dashboardAgentRuntimeFeatureFlags.runtime === true
    ? installHumanActivityTracking({
        lease: dashboardHumanActivityLease,
        target: window,
      })
    : null

export const dashboardPersistence = createDashboardPersistenceRuntime({
  storage: window.localStorage,
  indexedDB: window.indexedDB,
  crypto: window.crypto,
  isHumanActivityActive: () => dashboardHumanActivityLease.isActive(),
  onError: error => {
    console.error('[EasyEditor] Dashboard autosave failed:', error)
  },
  onWarning: warning => {
    console.warn(
      `[EasyEditor] Canonical draft ${warning.draftGeneration} is durable, but its compatibility snapshot failed:`,
      warning.cause,
    )
  },
})

export const dashboardAgentPersistence = createDashboardAgentPersistencePort(dashboardPersistence)

export const captureDashboardPersistenceInput = (): DashboardPersistenceInput => {
  const currentDocument = engine.project.currentDocument
  const currentIndex = currentDocument ? engine.project.documents.indexOf(currentDocument) : -1
  return {
    activeDocument: currentDocument
      ? {
          documentId: currentDocument.id,
          fileName: currentDocument.fileName,
          index: currentIndex >= 0 ? currentIndex : 0,
        }
      : null,
    projectSchema: engine.project.export() as unknown as DashboardPersistenceInput['projectSchema'],
  }
}

export const persistDashboardProject = (
  commitKind: 'autosave' | 'manual-save',
): Promise<DashboardPersistenceSaveResult> =>
  dashboardPersistence.save({ ...captureDashboardPersistenceInput(), commitKind })

export const disposeDashboardAgentActivity = () => {
  releaseDashboardHumanActivityTracking?.()
  releaseDashboardHumanActivityTracking = null
  dashboardHumanActivityLease.dispose()
}

export const composeDashboardAgentHost = (authority: DashboardAgentHostAuthority): DashboardAgentHost | null =>
  createDashboardAgentHost({
    activityLease: dashboardHumanActivityLease,
    authority,
    enabled: dashboardAgentRuntimeFeatureFlags.runtime,
    engine,
    isTransactionCommittedError: error => error instanceof TransactionCommittedError,
    isTransactionRollbackIncompleteError: error => error instanceof TransactionRollbackIncompleteError,
    persistence: dashboardPersistence,
  })

if (import.meta.hot) import.meta.hot.dispose(disposeDashboardAgentActivity)

if (import.meta.env.VITE_E2E === '1') {
  Object.defineProperty(window, '__EASY_EDITOR_E2E__', {
    configurable: true,
    value: Object.freeze({
      getEngineState: () => engine.lifecycleState,
      getPersistenceState: () => dashboardPersistence.getSnapshot(),
      flushPersistence: () => dashboardPersistence.flush(),
    }),
  })
}
