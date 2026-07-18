import { createAgentTelemetryChangeSetId } from '@easy-editor/agent-runtime'
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
  createDashboardMutationQuiescenceGate,
  createHumanActivityLease,
  installHumanActivityTracking,
} from './agent/activity/index.mjs'
import {
  createDashboardOnlineArtifactCapabilityService,
  createDashboardOnlineArtifactCoreAdapter,
  createDashboardOnlineArtifactPersistenceAdapter,
} from './agent/capabilities/artifact/index.mjs'
import {
  type DashboardMaterialGcAdmissionInput,
  type DashboardMaterialGcAdmissionReceiptV1,
  type LocalMaterialPromotionGrantIdentity,
  createDashboardLocalMaterialCatalogRuntime,
  createDashboardLocalMaterialPromotionCoreAdapter,
  createDashboardLocalMaterialPromotionPersistenceAdapter,
  createDashboardLocalMaterialPromotionRuntime,
  createDashboardMaterialGcCrossTabCoordinator,
  createDashboardMaterialGcReplicaState,
  createDashboardMaterialGcRuntime,
  createDashboardSameOriginLocalMaterialCatalogClient,
  createDashboardSameOriginLocalMaterialPromotionClient,
  createDashboardSameOriginMaterialGcClient,
  resolveDashboardMaterialGcEnabled,
} from './agent/capabilities/promotion/index.mjs'
import { resolveAgentRuntimeFeatureFlags } from './agent/feature-flags.mjs'
import {
  type DashboardAgentHost,
  type DashboardAgentHostAuthority,
  createDashboardAgentHost,
} from './agent/host/index.mjs'
import { createDashboardHostPersistenceFacade } from './agent/host/persistence-facade.mjs'
import {
  type DashboardAgentSessionHost,
  type DashboardAgentSessionHostAuthority,
  createDashboardAgentSessionHost,
} from './agent/host/session-host.mjs'
import { createDashboardOnlineComponentDependencyResolver } from './agent/online-components/dependency-resolver.mjs'
import { createDashboardAgentPersistencePort } from './agent/persistence/agent-persistence-port.mjs'
import { type DashboardAgentTelemetryQuery, createDashboardAgentTelemetryLedger } from './agent/telemetry/index.mjs'
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
const dashboardAgentTelemetryLedger = dashboardAgentRuntimeFeatureFlags.runtime
  ? createDashboardAgentTelemetryLedger({ capacity: 4096 })
  : null
export const dashboardAgentTelemetry = dashboardAgentTelemetryLedger
  ? Object.freeze({ record: (event: unknown) => dashboardAgentTelemetryLedger.record(event) })
  : null
export const dashboardAgentWorkerTelemetry = dashboardAgentTelemetryLedger
  ? Object.freeze({
      sink: Object.freeze({ emit: dashboardAgentTelemetryLedger.sink.emit }),
    })
  : null
export const dashboardMaterialGcEnabled = resolveDashboardMaterialGcEnabled(import.meta.env)
export const dashboardMutationQuiescenceGate = dashboardMaterialGcEnabled
  ? createDashboardMutationQuiescenceGate({ inputTarget: window })
  : null
export const dashboardMaterialGcCrossTabCoordinator = dashboardMaterialGcEnabled
  ? createDashboardMaterialGcCrossTabCoordinator({
      enabled: true,
      lockManager: window.navigator.locks,
    })
  : null

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
  dashboardAgentRuntimeFeatureFlags.runtime === true || dashboardMaterialGcEnabled
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

const createDashboardE2EPostIntentGate = () => {
  let gate:
    | {
        readonly reached: Promise<string>
        readonly release: Promise<void>
        markReached(callId: string): void
        releaseGate(): void
      }
    | undefined
  return Object.freeze({
    arm() {
      if (gate) throw new Error('Dashboard Agent post-intent gate is already armed')
      let markReached: (callId: string) => void = () => {}
      let releaseGate: () => void = () => {}
      const reached = new Promise<string>(resolve => {
        markReached = resolve
      })
      const release = new Promise<void>(resolve => {
        releaseGate = resolve
      })
      gate = { reached, release, markReached, releaseGate }
    },
    waitUntilReached() {
      if (!gate) throw new Error('Dashboard Agent post-intent gate is not armed')
      return gate.reached
    },
    release() {
      if (!gate) throw new Error('Dashboard Agent post-intent gate is not armed')
      gate.releaseGate()
    },
    async holdAfterIntent(callId: string) {
      const active = gate
      if (!active) return
      active.markReached(callId)
      await active.release
      if (gate === active) gate = undefined
    },
  })
}

const dashboardE2EPostIntentGate =
  import.meta.env.VITE_E2E === '1' && dashboardAgentRuntimeFeatureFlags.runtime
    ? createDashboardE2EPostIntentGate()
    : null

const createDashboardE2EPostCommitGate = () => {
  let gate:
    | {
        readonly reached: Promise<string>
        readonly release: Promise<void>
        markReached(callId: string): void
        releaseGate(): void
      }
    | undefined
  return Object.freeze({
    arm() {
      if (gate) throw new Error('Dashboard Agent post-commit gate is already armed')
      let markReached: (callId: string) => void = () => {}
      let releaseGate: () => void = () => {}
      const reached = new Promise<string>(resolve => {
        markReached = resolve
      })
      const release = new Promise<void>(resolve => {
        releaseGate = resolve
      })
      gate = { reached, release, markReached, releaseGate }
    },
    waitUntilReached() {
      if (!gate) throw new Error('Dashboard Agent post-commit gate is not armed')
      return gate.reached
    },
    release() {
      if (!gate) throw new Error('Dashboard Agent post-commit gate is not armed')
      gate.releaseGate()
    },
    async holdAfterCommit(callId: string) {
      const active = gate
      if (!active) return
      active.markReached(callId)
      await active.release
      if (gate === active) gate = undefined
    },
  })
}

const dashboardE2EPostCommitGate =
  import.meta.env.VITE_E2E === '1' && dashboardAgentRuntimeFeatureFlags.runtime
    ? createDashboardE2EPostCommitGate()
    : null

const dashboardHostPersistence = createDashboardHostPersistenceFacade(dashboardPersistence, {
  ...(dashboardE2EPostIntentGate
    ? { afterRecordIntent: intent => dashboardE2EPostIntentGate.holdAfterIntent(intent.callId) }
    : {}),
  ...(dashboardE2EPostCommitGate
    ? { afterCommitBatch: result => dashboardE2EPostCommitGate.holdAfterCommit(result.receipt.callId) }
    : {}),
})

export const dashboardAgentPersistence = createDashboardAgentPersistencePort(dashboardPersistence, {
  ...(dashboardAgentTelemetry ? { telemetry: dashboardAgentTelemetry } : {}),
})

export const dashboardMaterialGcClient = dashboardMaterialGcEnabled
  ? createDashboardSameOriginMaterialGcClient({ fetchImpl: window.fetch.bind(window) })
  : null
export const dashboardMaterialGcReplicaState = dashboardMaterialGcEnabled
  ? createDashboardMaterialGcReplicaState({
      storage: window.localStorage,
      crypto: window.crypto,
      coordinator: dashboardMaterialGcCrossTabCoordinator!,
    })
  : null
export const dashboardMaterialGcRuntime = dashboardMaterialGcEnabled
  ? createDashboardMaterialGcRuntime({
      enabled: true,
      crypto: window.crypto,
      client: dashboardMaterialGcClient!,
      replicaState: dashboardMaterialGcReplicaState!,
      coordinator: dashboardMaterialGcCrossTabCoordinator!,
      persistence: dashboardPersistence,
      humanActivity: dashboardHumanActivityLease,
      invocationActivity: dashboardInvocationActivity,
      mutationGate: dashboardMutationQuiescenceGate!,
      onError: error => {
        console.error('[EasyEditor] Durable material GC failed closed:', error)
      },
    })
  : createDashboardMaterialGcRuntime({ enabled: false })

export const dashboardMaterialGcAdmissionPort = dashboardMaterialGcEnabled
  ? Object.freeze({
      admitMaterialRefsUnderSharedMutation: (input: DashboardMaterialGcAdmissionInput) =>
        dashboardMaterialGcRuntime.admitMaterialRefsUnderSharedMutation(input),
      withMaterialAdmission: <Result>(
        input: DashboardMaterialGcAdmissionInput,
        operation: (
          receipt: Readonly<DashboardMaterialGcAdmissionReceiptV1 | { readonly status: 'disabled' }>,
        ) => Result | PromiseLike<Result>,
      ) => dashboardMaterialGcRuntime.withMaterialAdmission(input, operation),
    })
  : null

export const dashboardLocalMaterialCatalogRuntime = createDashboardLocalMaterialCatalogRuntime({
  enabled:
    dashboardAgentRuntimeFeatureFlags.runtime &&
    dashboardAgentRuntimeFeatureFlags.online &&
    dashboardAgentRuntimeFeatureFlags.promotion,
  client: createDashboardSameOriginLocalMaterialCatalogClient({ fetchImpl: window.fetch.bind(window) }),
  persistence: dashboardPersistence,
  ...(dashboardMaterialGcAdmissionPort
    ? { withMaterialAdmission: dashboardMaterialGcAdmissionPort.withMaterialAdmission }
    : {}),
})

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
  dashboardMaterialGcRuntime.dispose()
  releaseDashboardHumanActivityTracking?.()
  releaseDashboardHumanActivityTracking = null
  dashboardHumanActivityLease.dispose()
  dashboardInvocationActivity.dispose()
  dashboardMutationQuiescenceGate?.dispose()
}

const createBoundDashboardAgentHost = (
  authority: DashboardAgentHostAuthority,
  grantIdentity?: LocalMaterialPromotionGrantIdentity,
): DashboardAgentHost => {
  const dataResolver = dashboardAgentRuntimeFeatureFlags.data
    ? createDashboardSameOriginDataResolver({ fetchImpl: window.fetch.bind(window) })
    : undefined
  const artifactService =
    dashboardAgentRuntimeFeatureFlags.runtime && dashboardAgentRuntimeFeatureFlags.online
      ? createDashboardOnlineArtifactCapabilityService({
          authority,
          core: createDashboardOnlineArtifactCoreAdapter({
            engine,
            projectId: authority.projectId,
            branchId: authority.branchId,
            runAgentMutation: (callId, operation) => dashboardPersistence.runAgentMutation(callId, operation),
            isTransactionCommittedError: error => error instanceof TransactionCommittedError,
            isTransactionRollbackIncompleteError: error => error instanceof TransactionRollbackIncompleteError,
          }),
          persistence: createDashboardOnlineArtifactPersistenceAdapter(dashboardPersistence),
          resolver: createDashboardOnlineComponentDependencyResolver({ fetchImpl: window.fetch.bind(window) }),
          crypto: window.crypto,
          ...(dashboardAgentTelemetry ? { telemetry: dashboardAgentTelemetry } : {}),
          isTransactionCommittedError: error => error instanceof TransactionCommittedError,
          isTransactionRollbackIncompleteError: error => error instanceof TransactionRollbackIncompleteError,
        })
      : undefined
  const promotionRuntime =
    dashboardAgentRuntimeFeatureFlags.runtime &&
    dashboardAgentRuntimeFeatureFlags.online &&
    dashboardAgentRuntimeFeatureFlags.promotion &&
    dashboardMaterialGcEnabled &&
    dashboardMaterialGcAdmissionPort
      ? createDashboardLocalMaterialPromotionRuntime({
          authority,
          featureFlags: dashboardAgentRuntimeFeatureFlags,
          client: createDashboardSameOriginLocalMaterialPromotionClient({
            projectId: authority.projectId,
            fetchImpl: window.fetch.bind(window),
          }),
          core: createDashboardLocalMaterialPromotionCoreAdapter({
            engine,
            projectId: authority.projectId,
            branchId: authority.branchId,
            runAgentMutation: (callId, operation) => dashboardPersistence.runAgentMutation(callId, operation),
            isTransactionCommittedError: error => error instanceof TransactionCommittedError,
            isTransactionRollbackIncompleteError: error => error instanceof TransactionRollbackIncompleteError,
          }),
          persistence: createDashboardLocalMaterialPromotionPersistenceAdapter({
            authority,
            persistence: dashboardPersistence,
          }),
          crypto: window.crypto,
          ...(dashboardAgentTelemetry ? { telemetry: dashboardAgentTelemetry } : {}),
          admitMaterialRefsUnderSharedMutation: dashboardMaterialGcAdmissionPort.admitMaterialRefsUnderSharedMutation,
          ...(grantIdentity ? { grantIdentity } : {}),
          onPromotionApplied: async () => {
            await dashboardLocalMaterialCatalogRuntime.refresh()
            dashboardMaterialGcRuntime.trigger('promotion-applied')
          },
          isTransactionCommittedError: error => error instanceof TransactionCommittedError,
          isTransactionRollbackIncompleteError: error => error instanceof TransactionRollbackIncompleteError,
        })
      : null
  const host = createDashboardAgentHost({
    activityLease: dashboardHumanActivityLease,
    authority,
    createTelemetryChangeSetId: createAgentTelemetryChangeSetId,
    enabled: true,
    engine,
    invocationActivity: dashboardInvocationActivity,
    ...(dashboardMutationQuiescenceGate ? { mutationGate: dashboardMutationQuiescenceGate } : {}),
    ...(dashboardMaterialGcAdmissionPort
      ? {
          admitMaterialRefsUnderSharedMutation: dashboardMaterialGcAdmissionPort.admitMaterialRefsUnderSharedMutation,
        }
      : {}),
    isTransactionCommittedError: error => error instanceof TransactionCommittedError,
    isTransactionRollbackIncompleteError: error => error instanceof TransactionRollbackIncompleteError,
    persistence: dashboardHostPersistence,
    ...(dashboardAgentTelemetry ? { telemetry: dashboardAgentTelemetry } : {}),
    ...(artifactService ? { artifactService } : {}),
    ...(dataResolver ? { dataResolver } : {}),
    ...(promotionRuntime
      ? {
          promotionService: promotionRuntime.promotionService ?? undefined,
          promotionAvailability: promotionRuntime.promotionAvailability,
        }
      : {}),
  })
  if (!host) throw new Error('Dashboard Agent Host could not be composed while enabled')
  return host
}

export const composeDashboardAgentHost = (
  authority: DashboardAgentHostAuthority,
  grantIdentity?: LocalMaterialPromotionGrantIdentity,
): DashboardAgentHost | null =>
  dashboardAgentRuntimeFeatureFlags.runtime ? createBoundDashboardAgentHost(authority, grantIdentity) : null

export const composeDashboardAgentSessionHost = (
  authority: DashboardAgentSessionHostAuthority,
  grantIdentity?: LocalMaterialPromotionGrantIdentity,
): DashboardAgentSessionHost | null =>
  createDashboardAgentSessionHost({
    authority,
    createHost: hostAuthority => createBoundDashboardAgentHost(hostAuthority, grantIdentity),
    enabled: dashboardAgentRuntimeFeatureFlags.runtime,
  })

if (import.meta.env.VITE_E2E === '1') {
  const e2eProbe = {
    getEngineState: () => engine.lifecycleState,
    getHumanActivityGeneration: () => dashboardHumanActivityLease.generation,
    getPersistenceState: () => dashboardPersistence.getSnapshot(),
    getAgentWorkspaceState: () => dashboardAgentWorkspaceE2EProbe?.() ?? null,
    getAgentTelemetryState: (query: DashboardAgentTelemetryQuery) =>
      dashboardAgentTelemetryLedger
        ? {
            events: structuredClone(dashboardAgentTelemetryLedger.query(query)),
            stats: structuredClone(dashboardAgentTelemetryLedger.stats()),
          }
        : null,
    flushPersistence: () => dashboardPersistence.flush(),
    ...(dashboardMaterialGcEnabled
      ? {
          getMaterialGcState: () => dashboardMaterialGcRuntime.getSnapshot(),
          triggerMaterialGc: async () => {
            dashboardMaterialGcRuntime.trigger('manual-save')
            return dashboardMaterialGcRuntime.waitForIdle()
          },
        }
      : {}),
  }
  Object.defineProperties(e2eProbe, {
    armDashboardAgentPostIntentGate: {
      value: () => {
        if (!dashboardE2EPostIntentGate) throw new Error('Dashboard Agent post-intent gate is E2E-only')
        dashboardE2EPostIntentGate.arm()
      },
    },
    waitForDashboardAgentPostIntent: {
      value: () => {
        if (!dashboardE2EPostIntentGate) throw new Error('Dashboard Agent post-intent gate is E2E-only')
        return dashboardE2EPostIntentGate.waitUntilReached()
      },
    },
    releaseDashboardAgentPostIntentGate: {
      value: () => {
        if (!dashboardE2EPostIntentGate) throw new Error('Dashboard Agent post-intent gate is E2E-only')
        dashboardE2EPostIntentGate.release()
      },
    },
    armDashboardAgentPostCommitGate: {
      value: () => {
        if (!dashboardE2EPostCommitGate) throw new Error('Dashboard Agent post-commit gate is E2E-only')
        dashboardE2EPostCommitGate.arm()
      },
    },
    waitForDashboardAgentPostCommit: {
      value: () => {
        if (!dashboardE2EPostCommitGate) throw new Error('Dashboard Agent post-commit gate is E2E-only')
        return dashboardE2EPostCommitGate.waitUntilReached()
      },
    },
    releaseDashboardAgentPostCommitGate: {
      value: () => {
        if (!dashboardE2EPostCommitGate) throw new Error('Dashboard Agent post-commit gate is E2E-only')
        dashboardE2EPostCommitGate.release()
      },
    },
  })
  Object.defineProperty(window, '__EASY_EDITOR_E2E__', {
    configurable: true,
    value: Object.freeze(e2eProbe),
  })
}
