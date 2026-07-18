import type {
  AgentHost,
  AgentPersistencePort,
  AgentRuntime,
  AgentRuntimeOptions,
  AgentWorkerEndpoint,
  BoundAgentRuntimeBinding,
} from '@easy-editor/agent-runtime'
import type { ReceiptRecoveryResult } from '../../../editor/agent/persistence/receipt-ledger.mjs'
import type { DashboardPersistenceSnapshot } from '../../../editor/persistence-runtime'
import type {
  CanonicalWorkingDraftV1,
  DashboardCompensationRunListRecordV1,
  DashboardCompensationRunListRequestV1,
} from '../../../lib/storage/contracts.mjs'
import type {
  DashboardAgentSessionMutationResultV1,
  DashboardAgentSessionRecordV1,
  DashboardAgentSessionSaveV1,
  DashboardAgentSessionScopeV1,
  DashboardArtifactRootEnumerationV1,
  DashboardLocalGrantAuthorizeV1,
  DashboardLocalGrantCheckV1,
  DashboardLocalGrantDecisionV1,
  DashboardLocalGrantListV1,
  DashboardLocalGrantMutationResultV1,
  DashboardLocalGrantRecordV1,
  DashboardLocalGrantRevokeV1,
  DashboardProjectListV1,
  DashboardProjectVersionCreateV1,
  DashboardProjectVersionMutationResultV1,
  DashboardProjectVersionRecordV1,
  DashboardProjectVersionRestoreResultV1,
  DashboardProjectVersionRestoreV1,
} from '../../../lib/storage/lifecycle.mjs'
import {
  type AgentWorkspaceBinding,
  type AgentWorkspaceCommandPortAdapter,
  type AgentWorkspaceInvocationActivity,
  type AgentWorkspacePersistenceLifecycle,
  type AgentWorkspacePersistenceProjection,
  type AgentWorkspacePersistenceRecovery,
  type AgentWorkspaceRecoveryAction,
  createAgentWorkspaceCommandPortAdapter,
} from './command-port-adapter.ts'
import { AgentWorkspaceController } from './controller.ts'
import {
  AGENT_WORKSPACE_GRANT_SCOPES,
  type AgentWorkspaceCommandPort,
  type AgentWorkspaceControllerContract,
  type AgentWorkspaceGrantScope,
  type AgentWorkspaceIntentMode,
  type AgentWorkspaceRecoveryProjection,
  type AgentWorkspaceSnapshot,
  type AgentWorkspaceVersionIdentity,
  type AgentWorkspaceViewState,
} from './types.ts'

const PRODUCTION_WORKER_UNAVAILABLE = 'Agent Runtime 尚未接入生产 Gateway Worker。'
const COMPOSITION_INITIALIZING = 'Agent Workspace 正在组合运行时。'
const COMPOSITION_FAILED_CLOSED = 'Agent Workspace 已进入 fail-closed 状态。'

type MaybePromise<Value> = Value | Promise<Value>

export interface DashboardAgentWorkspacePersistence {
  getSnapshot(): DashboardPersistenceSnapshot
  subscribe(listener: () => void): () => void
  flush(): Promise<void>
  readWorkingDraft(): Promise<CanonicalWorkingDraftV1 | null>
  resolveAgentSession(request: DashboardAgentSessionScopeV1): Promise<DashboardAgentSessionRecordV1 | null>
  saveAgentSession(request: DashboardAgentSessionSaveV1): Promise<DashboardAgentSessionMutationResultV1>
  listProjectVersions(request: DashboardProjectListV1): Promise<readonly DashboardProjectVersionRecordV1[]>
  createProjectVersion(request: DashboardProjectVersionCreateV1): Promise<DashboardProjectVersionMutationResultV1>
  restoreProjectVersion(request: DashboardProjectVersionRestoreV1): Promise<DashboardProjectVersionRestoreResultV1>
  listLocalGrants(request: DashboardLocalGrantListV1): Promise<readonly DashboardLocalGrantRecordV1[]>
  checkLocalGrant(request: DashboardLocalGrantCheckV1): Promise<DashboardLocalGrantDecisionV1>
  authorizeLocalGrant(request: DashboardLocalGrantAuthorizeV1): Promise<DashboardLocalGrantMutationResultV1>
  revokeLocalGrant(request: DashboardLocalGrantRevokeV1): Promise<DashboardLocalGrantMutationResultV1>
  enumerateArtifactRoots(request: DashboardProjectListV1): Promise<DashboardArtifactRootEnumerationV1>
  listCompensationRuns(
    request: DashboardCompensationRunListRequestV1,
  ): Promise<readonly DashboardCompensationRunListRecordV1[]>
  recoverDurableAgentReceipt(request: {
    readonly projectId: string
    readonly branchId: string
    readonly callId: string
  }): Promise<ReceiptRecoveryResult>
}

export interface DashboardAgentWorkspaceSessionHost extends AgentHost {
  dispose(): void
}

export interface DashboardAgentWorkspaceGrantAuthority {
  readonly userId: string
  readonly policyVersion: string | number
  readonly providerId: string
  readonly providerFingerprint: string
  readonly providerLabel?: string
}

export interface DashboardAgentWorkspaceRecoveryBridge {
  list(input: {
    readonly binding: BoundAgentRuntimeBinding
    readonly runtime?: AgentRuntime
  }): Promise<readonly AgentWorkspacePersistenceRecovery[]>
  retry(input: {
    readonly binding: BoundAgentRuntimeBinding
    readonly recoveryId: string
    readonly kind: Exclude<AgentWorkspaceRecoveryProjection['kind'], 'unsaved'>
    readonly action: AgentWorkspaceRecoveryAction
    readonly runtime?: AgentRuntime
  }): Promise<void>
}

export interface DashboardAgentWorkspaceCompositionDependencies {
  readonly runtimeEnabled: boolean
  readonly persistence: DashboardAgentWorkspacePersistence
  readonly agentPersistence: AgentPersistencePort
  readonly invocationActivity?: AgentWorkspaceInvocationActivity
  readonly createSessionHost: (
    binding: BoundAgentRuntimeBinding,
    grantAuthority?: DashboardAgentWorkspaceGrantAuthority,
  ) => DashboardAgentWorkspaceSessionHost | null
  readonly createRuntime: (options: AgentRuntimeOptions) => AgentRuntime
  readonly detachEditor: () => MaybePromise<void>
  readonly loadEditorDraft: (draft: CanonicalWorkingDraftV1) => MaybePromise<void>
  readonly reattachEditor: () => MaybePromise<void>
  readonly recoveryBridge?: DashboardAgentWorkspaceRecoveryBridge
}

export interface DashboardAgentWorkspaceCompositionOptions {
  /**
   * The only production availability seam. Phase 4 deliberately has no
   * scripted fallback; E2E must inject its module-Worker endpoint factory.
   */
  readonly workerFactory?: () => AgentWorkerEndpoint
  readonly grantAuthority?: DashboardAgentWorkspaceGrantAuthority
  readonly recoveryBridge?: DashboardAgentWorkspaceRecoveryBridge
  readonly dependencies?: DashboardAgentWorkspaceCompositionDependencies
  readonly enabled?: boolean
  readonly now?: () => number
  readonly createId?: (kind: 'batch' | 'branch' | 'session' | 'version') => string
  readonly onError?: (error: unknown, source: DashboardAgentWorkspaceCompositionErrorSource) => void
}

export type DashboardAgentWorkspaceCompositionErrorSource =
  | 'initialize'
  | 'adapter'
  | 'restore'
  | 'restore-recovery'
  | 'dispose'

export interface DashboardAgentWorkspaceComposition {
  /** Stable for the complete composition lifetime, including branch restores. */
  readonly controller: AgentWorkspaceControllerContract
  getBinding(): AgentWorkspaceBinding
  getSnapshot(): AgentWorkspaceViewState
  dispose(): Promise<void>
}

type LiveBindingResources = {
  readonly binding: BoundAgentRuntimeBinding
  readonly host: DashboardAgentWorkspaceSessionHost
  readonly runtime: AgentRuntime
  readonly adapter: AgentWorkspaceCommandPortAdapter
  stopped: boolean
}

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(typeof value === 'string' ? value : 'Unknown Agent Workspace failure')

const errorMessage = (value: unknown): string => asError(value).message

const requireNonEmpty = (value: string, label: string): string => {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} must be a non-empty string`)
  return normalized
}

const defaultCreateId = (kind: 'batch' | 'branch' | 'session' | 'version'): string => {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID !== 'function') {
    throw new Error(`Agent Workspace cannot create a ${kind} id without crypto.randomUUID`)
  }
  return `${kind}-${randomUUID.call(globalThis.crypto)}`
}

const sameScope = (
  left: Readonly<{ projectId: string; branchId: string }>,
  right: Readonly<{ projectId: string | null; branchId: string | null }>,
): boolean => left.projectId === right.projectId && left.branchId === right.branchId

const cloneBinding = <Binding extends AgentWorkspaceBinding>(binding: Binding): Binding =>
  Object.freeze({ ...binding }) as Binding

const draftMatches = (draft: CanonicalWorkingDraftV1, binding: Readonly<{ projectId: string; branchId: string }>) =>
  draft.projectId === binding.projectId && draft.branchId === binding.branchId

const aggregate = (primary: unknown, secondary: unknown, message: string): Error =>
  new AggregateError([asError(primary), asError(secondary)], message)

class SwitchableAgentWorkspaceCommandPort implements AgentWorkspaceCommandPort {
  readonly #listeners = new Set<() => void>()
  #current: AgentWorkspaceCommandPortAdapter
  #releaseCurrent: () => void
  #blockedReason: string | undefined
  #disposed = false

  constructor(initial: AgentWorkspaceCommandPortAdapter) {
    this.#current = initial
    this.#releaseCurrent = initial.subscribe(this.#emit)
  }

  getSnapshot = (): AgentWorkspaceSnapshot => this.#current.getSnapshot()

  subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => undefined
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  block(reason: string): void {
    this.#blockedReason = reason
  }

  unblock(): void {
    this.#blockedReason = undefined
  }

  switch(next: AgentWorkspaceCommandPortAdapter): AgentWorkspaceCommandPortAdapter {
    if (this.#disposed) throw new Error('Agent Workspace command port is disposed')
    const previous = this.#current
    this.#releaseCurrent()
    this.#current = next
    this.#releaseCurrent = next.subscribe(this.#emit)
    this.#emit()
    return previous
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#releaseCurrent()
    this.#listeners.clear()
  }

  submitIntent(input: { readonly intent: string; readonly mode: AgentWorkspaceIntentMode }): Promise<void> {
    this.#assertCallable()
    return this.#current.submitIntent(input)
  }

  pauseTask(taskId: string): Promise<void> {
    this.#assertCallable()
    return this.#current.pauseTask(taskId)
  }

  resumeTask(taskId: string): Promise<void> {
    this.#assertCallable()
    return this.#current.resumeTask(taskId)
  }

  cancelTask(taskId: string): Promise<void> {
    this.#assertCallable()
    return this.#current.cancelTask(taskId)
  }

  respondToQuestion(input: {
    readonly taskId: string
    readonly questionId: string
    readonly response: string
  }): Promise<void> {
    this.#assertCallable()
    return this.#current.respondToQuestion(input)
  }

  createVersion(name: string): Promise<void> {
    this.#assertCallable()
    return this.#current.createVersion(name)
  }

  restoreVersion(identity: AgentWorkspaceVersionIdentity): Promise<void> {
    this.#assertCallable()
    return this.#current.restoreVersion(identity)
  }

  compensateTask(taskId: string): Promise<void> {
    this.#assertCallable()
    return this.#current.compensateTask(taskId)
  }

  requestGrant(scope: AgentWorkspaceGrantScope): Promise<void> {
    this.#assertCallable()
    return this.#current.requestGrant(scope)
  }

  revokeGrant(scope: AgentWorkspaceGrantScope): Promise<void> {
    this.#assertCallable()
    return this.#current.revokeGrant(scope)
  }

  retrySave(recoveryId: string): Promise<void> {
    this.#assertCallable()
    return this.#current.retrySave(recoveryId)
  }

  retryDurability(recoveryId: string): Promise<void> {
    this.#assertCallable()
    return this.#current.retryDurability(recoveryId)
  }

  refreshCompensationConflict(recoveryId: string): Promise<void> {
    this.#assertCallable()
    return this.#current.refreshCompensationConflict(recoveryId)
  }

  #assertCallable(): void {
    if (this.#disposed) throw new Error('Agent Workspace command port is disposed')
    if (this.#blockedReason) throw new Error(this.#blockedReason)
  }

  #emit = (): void => {
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch {
        // View observers cannot affect the binding switch.
      }
    }
  }
}

class DefaultDashboardAgentWorkspaceComposition implements DashboardAgentWorkspaceComposition {
  readonly controller: AgentWorkspaceController
  readonly #dependencies: DashboardAgentWorkspaceCompositionDependencies
  readonly #enabled: boolean
  readonly #workerFactory: (() => AgentWorkerEndpoint) | undefined
  readonly #grantAuthority: DashboardAgentWorkspaceGrantAuthority | undefined
  readonly #recoveryBridge: DashboardAgentWorkspaceRecoveryBridge | undefined
  readonly #now: () => number
  readonly #createId: (kind: 'batch' | 'branch' | 'session' | 'version') => string
  readonly #onError: (error: unknown, source: DashboardAgentWorkspaceCompositionErrorSource) => void
  readonly #port: SwitchableAgentWorkspaceCommandPort

  #binding: AgentWorkspaceBinding
  #pendingBinding: BoundAgentRuntimeBinding | undefined
  #adapter: AgentWorkspaceCommandPortAdapter
  #resources: LiveBindingResources | undefined
  #disposed = false
  #disposePromise: Promise<void> | undefined

  constructor(
    dependencies: DashboardAgentWorkspaceCompositionDependencies,
    initialBinding: AgentWorkspaceBinding,
    options: DashboardAgentWorkspaceCompositionOptions,
  ) {
    this.#dependencies = dependencies
    this.#enabled = options.enabled ?? dependencies.runtimeEnabled
    this.#workerFactory = options.workerFactory
    this.#grantAuthority = options.grantAuthority
    this.#recoveryBridge = options.recoveryBridge ?? dependencies.recoveryBridge
    this.#now = options.now ?? Date.now
    this.#createId = options.createId ?? defaultCreateId
    this.#onError = options.onError ?? (() => undefined)
    this.#binding = cloneBinding(initialBinding)
    this.#adapter = this.#createAdapter({
      binding: this.#binding,
      enabled: this.#enabled,
      runtime: null,
      persistence: false,
      unavailable: { reason: COMPOSITION_INITIALIZING },
    })
    this.#port = new SwitchableAgentWorkspaceCommandPort(this.#adapter)
    this.controller = new AgentWorkspaceController(this.#port)
  }

  async initialize(): Promise<void> {
    if (!this.#enabled) return
    try {
      const binding = await this.#resolveOrCreateActiveSession()
      this.#binding = binding
      if (!this.#workerFactory) {
        await this.#installUnavailable(binding, PRODUCTION_WORKER_UNAVAILABLE)
        return
      }
      const resources = await this.#composeLiveBinding(binding)
      this.#installResources(resources)
    } catch (error) {
      this.#report(error, 'initialize')
      await this.#installUnavailable(this.#binding, 'Agent Workspace 初始化失败。', errorMessage(error))
    }
  }

  getBinding = (): AgentWorkspaceBinding => cloneBinding(this.#binding)

  getSnapshot = (): AgentWorkspaceViewState => this.controller.getSnapshot()

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    this.#disposed = true
    this.controller.dispose()
    this.#port.dispose()
    const adapter = this.#adapter
    const resources = this.#resources
    this.#resources = undefined
    adapter.dispose()
    this.#disposePromise = (async () => {
      if (!resources) return
      try {
        await this.#stopResources(resources)
      } catch (error) {
        this.#report(error, 'dispose')
        throw error
      }
    })()
    return this.#disposePromise
  }

  #createPersistenceLifecycle(runtime: AgentRuntime | null): AgentWorkspacePersistenceLifecycle {
    return {
      getSnapshot: () => this.#dependencies.persistence.getSnapshot(),
      subscribe: listener => this.#dependencies.persistence.subscribe(listener),
      readWorkspaceProjection: binding => this.#readWorkspaceProjection(binding, runtime),
      createVersion: input => this.#createVersion(input),
      restoreVersion: input => this.#restoreVersion(input),
      checkLocalGrant: input => this.#checkLocalGrant(input.binding, input.scope),
      requestGrant: input => this.#requestGrant(input.binding, input.scope),
      revokeGrant: input => this.#revokeGrant(input.binding, input.scope),
      retryRecovery: input => this.#retryRecovery(input, runtime),
    }
  }

  async #resolveOrCreateActiveSession(): Promise<BoundAgentRuntimeBinding> {
    const scope = this.#requirePersistenceScope()
    await this.#dependencies.persistence.flush()
    const request = { schemaVersion: 1 as const, ...scope }
    const resolved = await this.#dependencies.persistence.resolveAgentSession(request)
    if (resolved?.status === 'active') {
      return cloneBinding({ ...scope, sessionId: resolved.sessionId })
    }

    const now = Math.max(this.#now(), resolved?.updatedAt ?? 0)
    const sessionId = resolved?.sessionId ?? this.#nextId('session')
    const snapshot = this.#requireReadySnapshot(scope)
    const saved = await this.#dependencies.persistence.saveAgentSession({
      schemaVersion: 1,
      batchId: this.#nextId('batch'),
      ...scope,
      expectedDraftGeneration: snapshot.draftGeneration,
      sessionId,
      status: 'active',
      createdAt: resolved?.createdAt ?? now,
      updatedAt: now,
      forkedFrom: resolved?.forkedFrom ?? null,
    })
    return cloneBinding({
      projectId: saved.session.projectId,
      branchId: saved.session.branchId,
      sessionId: saved.session.sessionId,
    })
  }

  async #composeLiveBinding(binding: BoundAgentRuntimeBinding): Promise<LiveBindingResources> {
    if (!this.#workerFactory) throw new Error(PRODUCTION_WORKER_UNAVAILABLE)
    const host = this.#dependencies.createSessionHost(binding, this.#grantAuthority)
    if (!host) throw new Error('Dashboard Agent Session Host is unavailable')
    let runtime: AgentRuntime
    try {
      runtime = this.#dependencies.createRuntime({
        binding,
        worker: this.#workerFactory,
        host,
        persistence: this.#dependencies.agentPersistence,
      })
    } catch (error) {
      host.dispose()
      throw error
    }
    this.#pendingBinding = binding
    const adapter = this.#createAdapter({ binding, enabled: true, runtime })
    try {
      await adapter.ready()
    } catch (error) {
      adapter.dispose()
      try {
        await runtime.dispose()
      } finally {
        host.dispose()
      }
      throw error
    } finally {
      if (this.#pendingBinding === binding) this.#pendingBinding = undefined
    }
    return { binding, host, runtime, adapter, stopped: false }
  }

  #createAdapter(input: {
    readonly binding: AgentWorkspaceBinding
    readonly enabled: boolean
    readonly runtime: AgentRuntime | null
    readonly persistence?: boolean
    readonly unavailable?: Readonly<{ reason: string; detail?: string }>
  }): AgentWorkspaceCommandPortAdapter {
    return createAgentWorkspaceCommandPortAdapter({
      enabled: input.enabled,
      binding: input.binding,
      runtime: input.runtime,
      persistence:
        input.enabled && input.persistence !== false ? this.#createPersistenceLifecycle(input.runtime) : null,
      invocationActivity: this.#dependencies.invocationActivity,
      unavailable: input.unavailable,
      now: this.#now,
      onError: error => this.#report(error, 'adapter'),
    })
  }

  #installResources(resources: LiveBindingResources): void {
    if (this.#disposed) {
      resources.adapter.dispose()
      void this.#stopResources(resources).catch(error => this.#report(error, 'dispose'))
      return
    }
    const previous = this.#port.switch(resources.adapter)
    this.#adapter = resources.adapter
    this.#binding = resources.binding
    this.#resources = resources
    previous.dispose()
  }

  async #installUnavailable(binding: AgentWorkspaceBinding, reason: string, detail?: string): Promise<void> {
    if (this.#disposed) return
    const unavailable = this.#createAdapter({
      binding,
      enabled: this.#enabled,
      runtime: null,
      unavailable: { reason, ...(detail ? { detail } : {}) },
    })
    await unavailable.ready()
    if (this.#disposed) {
      unavailable.dispose()
      return
    }
    const previous = this.#port.switch(unavailable)
    this.#adapter = unavailable
    this.#binding = cloneBinding(binding)
    this.#resources = undefined
    previous.dispose()
  }

  async #readWorkspaceProjection(
    binding: AgentWorkspaceBinding,
    runtime: AgentRuntime | null,
  ): Promise<AgentWorkspacePersistenceProjection> {
    const current = this.#assertCurrentBinding(binding)
    const versionsTask = this.#dependencies.persistence.listProjectVersions({
      schemaVersion: 1,
      projectId: current.projectId,
    })
    const grantsTask = this.#grantAuthority
      ? this.#dependencies.persistence.listLocalGrants({
          schemaVersion: 1,
          userId: this.#grantAuthority.userId,
          projectId: current.projectId,
        })
      : Promise.resolve([] as readonly DashboardLocalGrantRecordV1[])
    const recoveriesTask = this.#recoveryBridge
      ? this.#recoveryBridge.list({ binding: current, ...(runtime ? { runtime } : {}) })
      : Promise.resolve([] as readonly AgentWorkspacePersistenceRecovery[])
    const [versions, grants, recoveries] = await Promise.all([versionsTask, grantsTask, recoveriesTask])
    return Object.freeze({
      versions: versions.map(version =>
        Object.freeze({
          versionId: version.versionId,
          name: version.name,
          createdAt: version.createdAt,
          branchId: version.branchId,
          projectHash: version.projectHash,
          sourceSessionId: version.sourceSessionId,
          sourceTaskId: version.sourceTaskId,
        }),
      ),
      grants: this.#projectGrants(grants),
      recoveries,
    })
  }

  async #createVersion(input: {
    readonly binding: AgentWorkspaceBinding
    readonly name: string
    readonly sourceTaskId?: string
    readonly sourceCheckpointId?: string
  }): Promise<void> {
    const binding = this.#assertCurrentBinding(input.binding)
    await this.#dependencies.persistence.flush()
    const snapshot = this.#requireReadySnapshot(binding)
    const roots = await this.#dependencies.persistence.enumerateArtifactRoots({
      schemaVersion: 1,
      projectId: binding.projectId,
    })
    const refs = new Map<string, { artifactId: string; sourceRevision: string }>()
    for (const root of roots.roots) {
      if (root.branchId !== binding.branchId || root.ownerType !== 'working-draft') continue
      refs.set(`${root.artifactId}\u0000${root.sourceRevision}`, {
        artifactId: root.artifactId,
        sourceRevision: root.sourceRevision,
      })
    }
    const createdAt = this.#now()
    await this.#dependencies.persistence.createProjectVersion({
      schemaVersion: 1,
      batchId: this.#nextId('batch'),
      projectId: binding.projectId,
      branchId: binding.branchId,
      expectedDraftGeneration: snapshot.draftGeneration,
      versionId: this.#nextId('version'),
      name: requireNonEmpty(input.name, 'version name'),
      createdAt,
      artifactRefs: [...refs.values()].sort((left, right) =>
        `${left.artifactId}\u0000${left.sourceRevision}`.localeCompare(
          `${right.artifactId}\u0000${right.sourceRevision}`,
        ),
      ),
      sourceSessionId: binding.sessionId,
      sourceTaskId: input.sourceTaskId ?? null,
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    })
  }

  async #restoreVersion(input: {
    readonly binding: AgentWorkspaceBinding
    readonly versionId: string
    readonly sourceBranchId: string
    readonly sourceSessionId: string | null
    readonly sourceTaskId: string | null
  }): Promise<void> {
    const binding = this.#assertCurrentBinding(input.binding)
    const targetBinding = cloneBinding({
      projectId: binding.projectId,
      branchId: this.#nextId('branch'),
      sessionId: this.#nextId('session'),
    })
    await this.#runRestore({
      oldBinding: binding,
      targetBinding,
      request: {
        schemaVersion: 1,
        batchId: this.#nextId('batch'),
        projectId: binding.projectId,
        // Never replace this with the current branch: it identifies where the immutable version is stored.
        sourceBranchId: input.sourceBranchId,
        versionId: input.versionId,
        targetBranchId: targetBinding.branchId,
        targetSessionId: targetBinding.sessionId,
        forkedFromSessionId: input.sourceSessionId,
        forkedFromTaskId: input.sourceTaskId,
        restoredAt: this.#now(),
      },
    })
  }

  async #runRestore(input: {
    readonly oldBinding: BoundAgentRuntimeBinding
    readonly targetBinding: BoundAgentRuntimeBinding
    readonly request: DashboardProjectVersionRestoreV1
  }): Promise<void> {
    const oldResources = this.#resources
    if (!oldResources) throw new Error('Agent Runtime is unavailable for named version restore')
    this.#port.block('正在恢复命名版本，请等待分支切换完成。')
    let detached = false
    let restoredDraft: CanonicalWorkingDraftV1 | undefined
    let draftLoaded = false
    let candidate: LiveBindingResources | undefined
    try {
      await this.#dependencies.detachEditor()
      detached = true
      await this.#dependencies.persistence.flush()
      await this.#stopResources(oldResources)
      const restored = await this.#dependencies.persistence.restoreProjectVersion(input.request)
      restoredDraft = await this.#readVerifiedRestoredDraft(restored, input.targetBinding)
      await this.#dependencies.loadEditorDraft(restoredDraft)
      draftLoaded = true
      candidate = await this.#composeLiveBinding(input.targetBinding)
      this.#installResources(candidate)
      candidate = undefined
      await this.#dependencies.reattachEditor()
      detached = false
    } catch (caught) {
      let failure = caught
      this.#report(failure, 'restore')
      if (candidate) {
        candidate.adapter.dispose()
        try {
          await this.#stopResources(candidate)
        } catch (cleanupError) {
          failure = aggregate(failure, cleanupError, 'Target Agent Runtime construction and cleanup both failed')
        }
      }
      const oldScopeRecoverable = this.#isReadyScope(input.oldBinding)
      const recovered = oldScopeRecoverable
        ? await this.#tryRecoverOldBinding(input.oldBinding, oldResources, detached, failure)
        : false
      if (!recovered) {
        const activeResources = this.#resources
        if (activeResources && activeResources !== oldResources) {
          try {
            await this.#stopResources(activeResources)
          } catch (cleanupError) {
            this.#report(cleanupError, 'restore-recovery')
          }
        }
        const detail = errorMessage(failure)
        await this.#installUnavailable(
          oldScopeRecoverable ? input.oldBinding : input.targetBinding,
          COMPOSITION_FAILED_CLOSED,
          detail,
        )
        if (detached && draftLoaded) {
          try {
            await this.#dependencies.reattachEditor()
          } catch (reattachError) {
            this.#report(reattachError, 'restore-recovery')
          }
        }
      }
      throw failure
    } finally {
      this.#port.unblock()
    }
  }

  async #readVerifiedRestoredDraft(
    restored: DashboardProjectVersionRestoreResultV1,
    targetBinding: BoundAgentRuntimeBinding,
  ): Promise<CanonicalWorkingDraftV1> {
    if (
      restored.session.projectId !== targetBinding.projectId ||
      restored.session.branchId !== targetBinding.branchId ||
      restored.session.sessionId !== targetBinding.sessionId
    ) {
      throw new Error('Restored session does not match the allocated target binding')
    }
    const draft = await this.#dependencies.persistence.readWorkingDraft()
    if (!draft || !draftMatches(draft, targetBinding)) {
      throw new Error('Restored canonical draft does not match the target binding')
    }
    if (draft.draftGeneration !== restored.draft.draftGeneration || draft.projectHash !== restored.draft.projectHash) {
      throw new Error('Restored canonical draft changed before the editor reload')
    }
    return draft
  }

  async #tryRecoverOldBinding(
    binding: BoundAgentRuntimeBinding,
    oldResources: LiveBindingResources,
    detached: boolean,
    primaryError: unknown,
  ): Promise<boolean> {
    let rebuilt: LiveBindingResources | undefined
    try {
      await this.#stopResources(oldResources)
      const draft = await this.#dependencies.persistence.readWorkingDraft()
      if (!draft || !draftMatches(draft, binding)) {
        throw new Error('Old canonical draft is unavailable after restore failure')
      }
      if (detached) await this.#dependencies.loadEditorDraft(draft)
      rebuilt = await this.#composeLiveBinding(binding)
      this.#installResources(rebuilt)
      if (detached) await this.#dependencies.reattachEditor()
      return true
    } catch (recoveryError) {
      if (rebuilt) {
        try {
          await this.#stopResources(rebuilt)
        } catch (cleanupError) {
          this.#report(cleanupError, 'restore-recovery')
        }
      }
      const failure = aggregate(
        primaryError,
        recoveryError,
        'Named version restore and old binding recovery both failed',
      )
      this.#report(failure, 'restore-recovery')
      return false
    }
  }

  #isReadyScope(binding: Readonly<{ projectId: string; branchId: string }>): boolean {
    const snapshot = this.#dependencies.persistence.getSnapshot()
    return snapshot.state === 'ready' && sameScope(binding, snapshot)
  }

  async #stopResources(resources: LiveBindingResources): Promise<void> {
    if (resources.stopped) return
    resources.stopped = true
    let runtimeError: unknown
    try {
      await resources.runtime.dispose()
    } catch (error) {
      runtimeError = error
    }
    let hostError: unknown
    try {
      resources.host.dispose()
    } catch (error) {
      hostError = error
    }
    if (runtimeError && hostError) {
      throw aggregate(runtimeError, hostError, 'Agent Runtime and Session Host disposal both failed')
    }
    if (runtimeError) throw runtimeError
    if (hostError) throw hostError
  }

  async #requestGrant(binding: AgentWorkspaceBinding, scope: AgentWorkspaceGrantScope): Promise<void> {
    const current = this.#assertCurrentBinding(binding)
    const authority = this.#requireGrantAuthority()
    await this.#dependencies.persistence.flush()
    const snapshot = this.#requireReadySnapshot(current)
    await this.#dependencies.persistence.authorizeLocalGrant({
      schemaVersion: 1,
      batchId: this.#nextId('batch'),
      projectId: current.projectId,
      branchId: current.branchId,
      expectedDraftGeneration: snapshot.draftGeneration,
      userId: authority.userId,
      scope,
      policyVersion: authority.policyVersion,
      providerId: authority.providerId,
      providerFingerprint: authority.providerFingerprint,
      updatedAt: this.#now(),
    })
  }

  async #checkLocalGrant(
    binding: AgentWorkspaceBinding,
    scope: AgentWorkspaceGrantScope,
  ): Promise<DashboardLocalGrantDecisionV1> {
    const current = this.#assertCurrentBinding(binding)
    const authority = this.#requireGrantAuthority()
    return this.#dependencies.persistence.checkLocalGrant({
      schemaVersion: 1,
      userId: authority.userId,
      projectId: current.projectId,
      scope,
      policyVersion: authority.policyVersion,
      providerId: authority.providerId,
      providerFingerprint: authority.providerFingerprint,
    })
  }

  async #revokeGrant(binding: AgentWorkspaceBinding, scope: AgentWorkspaceGrantScope): Promise<void> {
    const current = this.#assertCurrentBinding(binding)
    const authority = this.#requireGrantAuthority()
    await this.#dependencies.persistence.flush()
    const snapshot = this.#requireReadySnapshot(current)
    await this.#dependencies.persistence.revokeLocalGrant({
      schemaVersion: 1,
      batchId: this.#nextId('batch'),
      projectId: current.projectId,
      branchId: current.branchId,
      expectedDraftGeneration: snapshot.draftGeneration,
      userId: authority.userId,
      scope,
      policyVersion: authority.policyVersion,
      revokedAt: this.#now(),
    })
  }

  async #retryRecovery(
    input: {
      readonly binding: AgentWorkspaceBinding
      readonly recoveryId: string
      readonly kind: AgentWorkspaceRecoveryProjection['kind']
      readonly action: AgentWorkspaceRecoveryAction
    },
    runtime: AgentRuntime | null,
  ): Promise<void> {
    const binding = this.#assertCurrentBinding(input.binding)
    if (input.kind === 'unsaved') {
      await this.#dependencies.persistence.flush()
      return
    }
    if (!this.#recoveryBridge) {
      throw new Error('Durability and compensation recovery are not exposed by the Dashboard persistence contract')
    }
    await this.#recoveryBridge.retry({
      binding,
      recoveryId: input.recoveryId,
      kind: input.kind,
      action: input.action,
      ...(runtime ? { runtime } : {}),
    })
  }

  #projectGrants(records: readonly DashboardLocalGrantRecordV1[]) {
    const authority = this.#grantAuthority
    if (!authority) return []
    return AGENT_WORKSPACE_GRANT_SCOPES.map(scope => {
      const record = records
        .filter(value => value.scope === scope && String(value.policyVersion) === String(authority.policyVersion))
        .at(-1)
      const exactProvider =
        record?.providerId === authority.providerId && record.providerFingerprint === authority.providerFingerprint
      const status = !record || !exactProvider ? 'required' : record.status
      return Object.freeze({
        scope,
        status,
        policyVersion: authority.policyVersion,
        ...(authority.providerLabel ? { providerLabel: authority.providerLabel } : {}),
        ...(status === 'granted' && record ? { grantedAt: record.grantedAt } : {}),
      })
    })
  }

  #requireGrantAuthority(): DashboardAgentWorkspaceGrantAuthority {
    if (!this.#grantAuthority) {
      throw new Error('Local grant authority is unavailable until a production Gateway identity is configured')
    }
    return this.#grantAuthority
  }

  #assertCurrentBinding(binding: AgentWorkspaceBinding): BoundAgentRuntimeBinding {
    const matches = (candidate: AgentWorkspaceBinding | undefined): candidate is BoundAgentRuntimeBinding =>
      candidate !== undefined &&
      candidate.sessionId !== undefined &&
      binding.projectId === candidate.projectId &&
      binding.branchId === candidate.branchId &&
      (binding.sessionId === undefined || binding.sessionId === candidate.sessionId)
    const current = matches(this.#pendingBinding)
      ? this.#pendingBinding
      : matches(this.#binding)
        ? this.#binding
        : undefined
    if (!current) {
      throw new Error('Agent Workspace binding is stale')
    }
    return cloneBinding({ ...current, sessionId: current.sessionId })
  }

  #requirePersistenceScope(): Readonly<{ projectId: string; branchId: string }> {
    const snapshot = this.#dependencies.persistence.getSnapshot()
    if (snapshot.state !== 'ready' || !snapshot.projectId || !snapshot.branchId) {
      throw new Error(`Dashboard persistence is ${snapshot.state}`)
    }
    return Object.freeze({ projectId: snapshot.projectId, branchId: snapshot.branchId })
  }

  #requireReadySnapshot(scope: Readonly<{ projectId: string; branchId: string }>): DashboardPersistenceSnapshot {
    const snapshot = this.#dependencies.persistence.getSnapshot()
    if (snapshot.state !== 'ready' || !sameScope(scope, snapshot)) {
      throw new Error('Dashboard persistence binding changed during the lifecycle operation')
    }
    return snapshot
  }

  #nextId(kind: 'batch' | 'branch' | 'session' | 'version'): string {
    return requireNonEmpty(this.#createId(kind), `${kind} id`)
  }

  #report(error: unknown, source: DashboardAgentWorkspaceCompositionErrorSource): void {
    try {
      this.#onError(error, source)
    } catch {
      // Diagnostics cannot alter runtime authority or recovery.
    }
  }
}

const loadDefaultDependencies = async (): Promise<DashboardAgentWorkspaceCompositionDependencies> => {
  const [agentRuntime, runtime, editor, productionRecovery] = await Promise.all([
    import('@easy-editor/agent-runtime'),
    import('../../../editor/runtime'),
    import('../../../editor/index'),
    import('./production-recovery-bridge.mjs'),
  ])
  await editor.editorReady
  return {
    runtimeEnabled: runtime.dashboardAgentRuntimeFeatureFlags.runtime,
    persistence: runtime.dashboardPersistence,
    agentPersistence: runtime.dashboardAgentPersistence,
    invocationActivity: runtime.dashboardInvocationActivity,
    createSessionHost: (binding, grantAuthority) => runtime.composeDashboardAgentSessionHost(binding, grantAuthority),
    createRuntime: agentRuntime.createAgentRuntime,
    detachEditor: editor.detachDashboardPersistenceListeners,
    loadEditorDraft: editor.loadDashboardEditorDraft,
    reattachEditor: editor.reattachDashboardPersistenceListeners,
    recoveryBridge: productionRecovery.createDashboardAgentWorkspaceProductionRecoveryBridge({
      persistence: runtime.dashboardPersistence,
    }),
  }
}

/**
 * Composes the Dashboard's real persistence/session/Host/Runtime chain behind
 * one stable controller. Supplying no Worker is intentional and yields a typed
 * unavailable controller until the production Gateway profile exists.
 */
export const createDashboardAgentWorkspaceComposition = async (
  options: DashboardAgentWorkspaceCompositionOptions = {},
): Promise<DashboardAgentWorkspaceComposition> => {
  const dependencies = options.dependencies ?? (await loadDefaultDependencies())
  const persistence = dependencies.persistence.getSnapshot()
  if (!persistence.projectId || !persistence.branchId) {
    throw new Error(`Dashboard persistence has no active binding while ${persistence.state}`)
  }
  const composition = new DefaultDashboardAgentWorkspaceComposition(
    dependencies,
    { projectId: persistence.projectId, branchId: persistence.branchId },
    options,
  )
  await composition.initialize()
  return composition
}
