import {
  type EngineInstance,
  type RemoteAccessRequest,
  TransactionCommittedError,
  TransactionRollbackIncompleteError,
  createEngine,
} from '@easy-editor/core/instance'
import { createDashboardUmdGlobals } from '../globals'
import {
  createDashboardInvocationActivity,
  createHumanActivityLease,
  installHumanActivityTracking,
} from './agent/activity/index.mjs'
import { resolveAgentRuntimeFeatureFlags } from './agent/feature-flags.mjs'
import {
  type DashboardAgentHost,
  type DashboardAgentHostAuthority,
  createDashboardAgentHost,
} from './agent/host/index.mjs'
import {
  type DashboardAgentSessionHost,
  type DashboardAgentSessionHostAuthority,
  createDashboardAgentSessionHost,
} from './agent/host/session-host.mjs'
import { createDashboardAgentPersistencePort } from './agent/persistence/agent-persistence-port.mjs'
import { createDashboardSameOriginDataResolver } from './data/contract.mjs'
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

export interface DashboardAgentWorkspaceE2EProbeState {
  readonly binding: Readonly<{
    projectId: string
    branchId: string
    sessionId?: string
  }>
  readonly snapshot: unknown
}

let dashboardAgentWorkspaceE2EProbe: (() => DashboardAgentWorkspaceE2EProbeState) | null = null

export const registerDashboardAgentWorkspaceE2EProbe = (
  probe: () => DashboardAgentWorkspaceE2EProbeState,
): (() => void) => {
  if (import.meta.env.VITE_E2E !== '1') return () => undefined
  if (dashboardAgentWorkspaceE2EProbe) throw new Error('Dashboard Agent Workspace E2E probe is already registered')
  dashboardAgentWorkspaceE2EProbe = probe
  return () => {
    if (dashboardAgentWorkspaceE2EProbe === probe) dashboardAgentWorkspaceE2EProbe = null
  }
}

const dashboardHumanActivityLease = createHumanActivityLease()
export const dashboardInvocationActivity = createDashboardInvocationActivity()
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
  dashboardInvocationActivity.dispose()
}

const createBoundDashboardAgentHost = (authority: DashboardAgentHostAuthority): DashboardAgentHost => {
  const dataResolver = dashboardAgentRuntimeFeatureFlags.data
    ? createDashboardSameOriginDataResolver({ fetchImpl: window.fetch.bind(window) })
    : undefined
  const host = createDashboardAgentHost({
    activityLease: dashboardHumanActivityLease,
    authority,
    enabled: true,
    engine,
    invocationActivity: dashboardInvocationActivity,
    isTransactionCommittedError: error => error instanceof TransactionCommittedError,
    isTransactionRollbackIncompleteError: error => error instanceof TransactionRollbackIncompleteError,
    persistence: dashboardPersistence,
    ...(dataResolver ? { dataResolver } : {}),
  })
  if (!host) throw new Error('Dashboard Agent Host could not be composed while enabled')
  return host
}

export const composeDashboardAgentHost = (authority: DashboardAgentHostAuthority): DashboardAgentHost | null =>
  dashboardAgentRuntimeFeatureFlags.runtime ? createBoundDashboardAgentHost(authority) : null

export const composeDashboardAgentSessionHost = (
  authority: DashboardAgentSessionHostAuthority,
): DashboardAgentSessionHost | null =>
  createDashboardAgentSessionHost({
    authority,
    createHost: createBoundDashboardAgentHost,
    enabled: dashboardAgentRuntimeFeatureFlags.runtime,
  })

if (import.meta.env.VITE_E2E === '1') {
  Object.defineProperty(window, '__EASY_EDITOR_E2E__', {
    configurable: true,
    value: Object.freeze({
      getEngineState: () => engine.lifecycleState,
      getPersistenceState: () => dashboardPersistence.getSnapshot(),
      getAgentWorkspaceState: () => dashboardAgentWorkspaceE2EProbe?.() ?? null,
      flushPersistence: () => dashboardPersistence.flush(),
    }),
  })
}
