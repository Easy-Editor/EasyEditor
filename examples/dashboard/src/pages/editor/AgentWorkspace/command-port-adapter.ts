import { deriveAgentWorkspaceIntentMode } from './controller.ts'
import { normalizeAgentWorkspaceTargets } from './overlay-projection.ts'
import { isAgentWorkspaceTaskRecoveryLocked } from './task-lineage.ts'
import {
  AGENT_WORKSPACE_GRANT_SCOPES,
  type AgentWorkspaceAvailability,
  type AgentWorkspaceCommandPort,
  type AgentWorkspaceGrantProjection,
  type AgentWorkspaceGrantScope,
  type AgentWorkspaceIntentMode,
  type AgentWorkspaceRecoveryProjection,
  type AgentWorkspaceRuntimeStatus,
  type AgentWorkspaceSnapshot,
  type AgentWorkspaceTargetProjection,
  type AgentWorkspaceTaskPhase,
  type AgentWorkspaceTaskProjection,
  type AgentWorkspaceVersionIdentity,
  type AgentWorkspaceVersionProjection,
} from './types.ts'

export interface AgentWorkspaceBinding {
  readonly projectId: string
  readonly branchId: string
  readonly sessionId?: string
}

export interface AgentWorkspaceRuntimeContextDigest {
  readonly sourceHash: string
  readonly includedTaskIds: readonly string[]
  readonly omittedTaskCount: number
  readonly unresolvedConstraints: readonly unknown[]
  readonly omittedUnresolvedConstraintCount?: number
}

export interface AgentWorkspaceRuntimeTask {
  readonly taskId: string
  readonly sessionId: string
  readonly phase: AgentWorkspaceTaskPhase
  readonly compensationEligible: boolean
  readonly createdAt: number
  readonly updatedAt: number
  readonly intent: Readonly<{ text: string }>
  readonly sessionContext: AgentWorkspaceRuntimeContextDigest
  readonly parentTaskId?: string
  readonly supersedesTaskId?: string
  readonly acceptedBlueprint?: Readonly<{
    summary: string
    unresolvedConstraints: readonly string[]
  }>
  readonly completionSummary?: string
  readonly question?: Readonly<{
    questionId: string
    prompt: string
  }>
  readonly failure?: Readonly<{
    code: string
    message: string
    retryable: boolean
  }>
  /** Optional verified checkpoint enrichment owned by the Runtime composition. */
  readonly checkpointId?: string
}

export interface AgentWorkspaceRuntimeSnapshot {
  readonly binding: Readonly<{ projectId: string; branchId: string; sessionId: string }>
  readonly status: AgentWorkspaceRuntimeStatus
  readonly revision: number
  readonly activeTask?: AgentWorkspaceRuntimeTask
  readonly tasks: readonly AgentWorkspaceRuntimeTask[]
  readonly failure?: Readonly<{ code: string; message: string; retryable: boolean }>
}

export interface AgentWorkspaceRuntimeFacade {
  getSnapshot(): AgentWorkspaceRuntimeSnapshot
  subscribe(listener: (snapshot: AgentWorkspaceRuntimeSnapshot) => void): () => void
  submit(
    input: Readonly<{ text: string; metadata: Readonly<{ agentWorkspaceIntentMode: AgentWorkspaceIntentMode }> }>,
  ): Promise<unknown>
  pause(taskId: string): Promise<void>
  resume(taskId: string): Promise<void>
  cancel(taskId: string): Promise<void>
  respond(taskId: string, response: Readonly<{ questionId: string; value: string }>): Promise<void>
  /** Must be Runtime-owned so the UI cannot construct Host compensation authority. */
  compensate(taskId: string): Promise<void>
}

export type AgentWorkspacePersistenceState =
  | 'created'
  | 'initializing'
  | 'ready'
  | 'restoring'
  | 'failed'
  | 'disposing'
  | 'disposed'

export interface AgentWorkspacePersistenceSnapshot {
  readonly state: AgentWorkspacePersistenceState
  readonly projectId: string | null
  readonly branchId: string | null
  readonly draftGeneration: number
  readonly pendingAutosave: boolean
  readonly lastFailure: Readonly<{
    source: 'initialize' | 'autosave' | 'save' | 'flush' | 'restore'
    message: string
    recoveryId?: string
    occurredAt?: number
  }> | null
}

export interface AgentWorkspacePersistenceVersion {
  readonly versionId: string
  readonly name: string
  readonly createdAt: number
  readonly branchId: string
  readonly projectHash: string
  readonly sourceSessionId: string | null
  readonly sourceTaskId: string | null
}

export interface AgentWorkspacePersistenceGrant {
  readonly scope: AgentWorkspaceGrantScope
  readonly status: 'required' | 'granted' | 'revoked'
  readonly policyVersion: string | number
  readonly providerLabel?: string
  readonly grantedAt?: number | null
}

export type AgentWorkspaceLocalGrantDecisionReason =
  | 'granted'
  | 'missing'
  | 'revoked'
  | 'provider-changed'
  | 'provider-fingerprint-changed'
  | 'policy-version-changed'

export interface AgentWorkspaceLocalGrantDecision {
  readonly granted: boolean
  readonly reason: AgentWorkspaceLocalGrantDecisionReason
}

export class AgentWorkspaceGrantConfirmationRequiredError extends Error {
  readonly code = 'agent-workspace-grant-confirmation-required' as const
  readonly scope: AgentWorkspaceGrantScope
  readonly reason: Exclude<AgentWorkspaceLocalGrantDecisionReason, 'granted'>

  constructor(scope: AgentWorkspaceGrantScope, reason: Exclude<AgentWorkspaceLocalGrantDecisionReason, 'granted'>) {
    const detail = reason === 'revoked' ? '授权已撤销' : reason === 'missing' ? '尚未授权' : '授权环境已变化'
    super(`${detail}，请先在“授权”页确认“修改当前项目（${scope}）”授权。`)
    this.name = 'AgentWorkspaceGrantConfirmationRequiredError'
    this.scope = scope
    this.reason = reason
  }
}

export type AgentWorkspacePersistenceRecovery =
  | Readonly<{
      kind: 'unsaved'
      recoveryId: string
      message: string
      occurredAt: number
    }>
  | Readonly<{
      kind: 'applied-undurable'
      recoveryId: string
      taskId: string
      callId: string
      message: string
      occurredAt: number
    }>
  | Readonly<{
      kind: 'compensation-conflict'
      recoveryId: string
      taskId: string
      message: string
      occurredAt: number
      conflictPaths: readonly string[]
    }>

export interface AgentWorkspacePersistenceProjection {
  readonly versions: readonly AgentWorkspacePersistenceVersion[]
  readonly grants: readonly AgentWorkspacePersistenceGrant[]
  readonly recoveries: readonly AgentWorkspacePersistenceRecovery[]
}

export type AgentWorkspaceRecoveryAction = 'retry-save' | 'retry-durability' | 'refresh-conflict-report'

export interface AgentWorkspacePersistenceLifecycle {
  getSnapshot(): AgentWorkspacePersistenceSnapshot
  subscribe(listener: () => void): () => void
  readWorkspaceProjection(binding: AgentWorkspaceBinding): Promise<AgentWorkspacePersistenceProjection>
  createVersion(
    input: Readonly<{
      binding: AgentWorkspaceBinding
      name: string
      sourceTaskId?: string
      sourceCheckpointId?: string
    }>,
  ): Promise<void>
  restoreVersion(
    input: Readonly<{
      binding: AgentWorkspaceBinding
      versionId: string
      sourceBranchId: string
      sourceSessionId: string | null
      sourceTaskId: string | null
    }>,
  ): Promise<void>
  checkLocalGrant(
    input: Readonly<{ binding: AgentWorkspaceBinding; scope: AgentWorkspaceGrantScope }>,
  ): Promise<AgentWorkspaceLocalGrantDecision>
  requestGrant(input: Readonly<{ binding: AgentWorkspaceBinding; scope: AgentWorkspaceGrantScope }>): Promise<void>
  revokeGrant(input: Readonly<{ binding: AgentWorkspaceBinding; scope: AgentWorkspaceGrantScope }>): Promise<void>
  retryRecovery(
    input: Readonly<{
      binding: AgentWorkspaceBinding
      recoveryId: string
      kind: AgentWorkspaceRecoveryProjection['kind']
      action: AgentWorkspaceRecoveryAction
    }>,
  ): Promise<void>
}

export interface AgentWorkspaceInvocationCall {
  readonly callId: string
  readonly capability: string
  readonly taskId: string
  readonly startedAt: number
  /** Compatibility path for activity sources created before atomic target projection. */
  readonly targetNodeIds?: readonly string[]
  /** Preferred Host-owned canvas projection captured atomically when the call begins. */
  readonly targets?: readonly AgentWorkspaceInvocationTarget[]
}

export type AgentWorkspaceInvocationTarget = Readonly<
  (
    | { readonly nodeId: string; readonly targetNodeId?: string }
    | { readonly targetNodeId: string; readonly nodeId?: string }
  ) & {
    readonly label?: string
    readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>
    readonly tone?: AgentWorkspaceTargetProjection['tone']
  }
>

export interface AgentWorkspaceInvocationSnapshot {
  readonly revision: number
  readonly activeCalls: readonly AgentWorkspaceInvocationCall[]
}

export interface AgentWorkspaceInvocationActivity {
  getSnapshot(): AgentWorkspaceInvocationSnapshot
  subscribe(listener: () => void): () => void
}

export interface AgentWorkspaceResolvedTarget {
  readonly targetId: string
  readonly label: string
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>
  readonly tone?: AgentWorkspaceTargetProjection['tone']
}

export interface AgentWorkspaceTargetRectResolver {
  resolveTargets(
    input: Readonly<{
      binding: AgentWorkspaceBinding
      activeCalls: readonly AgentWorkspaceInvocationCall[]
    }>,
  ): Promise<readonly AgentWorkspaceResolvedTarget[]>
}

export type AgentWorkspaceAdapterErrorSource =
  | 'runtime-read'
  | 'runtime-subscribe'
  | 'persistence-read'
  | 'persistence-subscribe'
  | 'lifecycle-refresh'
  | 'activity-read'
  | 'activity-subscribe'
  | 'target-refresh'

export interface AgentWorkspaceCommandPortAdapterOptions {
  readonly enabled: boolean
  readonly binding: AgentWorkspaceBinding
  readonly runtime: AgentWorkspaceRuntimeFacade | null
  readonly persistence: AgentWorkspacePersistenceLifecycle | null
  readonly invocationActivity?: AgentWorkspaceInvocationActivity
  readonly targetRectResolver?: AgentWorkspaceTargetRectResolver
  readonly unavailable?: Readonly<{ reason: string; detail?: string }>
  readonly now?: () => number
  readonly onError?: (error: unknown, source: AgentWorkspaceAdapterErrorSource) => void
}

export interface AgentWorkspaceCommandPortAdapter extends AgentWorkspaceCommandPort {
  ready(): Promise<void>
  refresh(): Promise<void>
  dispose(): void
}

const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const freezeArray = <Value>(values: readonly Value[]): readonly Value[] => Object.freeze([...values])

const requireNonEmpty = (value: string, label: string): string => {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label}不能为空。`)
  return normalized
}

const bindingKey = (binding: AgentWorkspaceBinding): string =>
  `${binding.projectId}\u0000${binding.branchId}\u0000${binding.sessionId ?? ''}`

const sameRuntimeBinding = (
  expected: AgentWorkspaceBinding,
  actual: AgentWorkspaceRuntimeSnapshot['binding'],
): boolean =>
  expected.projectId === actual.projectId &&
  expected.branchId === actual.branchId &&
  (expected.sessionId === undefined || expected.sessionId === actual.sessionId)

const samePersistenceBinding = (expected: AgentWorkspaceBinding, actual: AgentWorkspacePersistenceSnapshot): boolean =>
  expected.projectId === actual.projectId && expected.branchId === actual.branchId

const taskProjection = (task: AgentWorkspaceRuntimeTask): AgentWorkspaceTaskProjection =>
  Object.freeze({
    taskId: task.taskId,
    intent: task.intent.text,
    phase: task.phase,
    compensationEligible: task.compensationEligible,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
    ...(task.supersedesTaskId ? { supersedesTaskId: task.supersedesTaskId } : {}),
    ...(task.acceptedBlueprint
      ? {
          blueprint: Object.freeze({
            summary: task.acceptedBlueprint.summary,
            steps: freezeArray([]),
          }),
        }
      : {}),
    ...(task.completionSummary ? { completionSummary: task.completionSummary } : {}),
    ...(task.question
      ? {
          question: Object.freeze({
            questionId: task.question.questionId,
            prompt: task.question.prompt,
          }),
        }
      : {}),
    ...(task.failure
      ? {
          failure: Object.freeze({
            code: task.failure.code,
            message: task.failure.message,
            retryable: task.failure.retryable,
          }),
        }
      : {}),
    contextDigest: Object.freeze({
      sourceHash: task.sessionContext.sourceHash,
      includedTaskIds: freezeArray(task.sessionContext.includedTaskIds),
      omittedTaskCount: task.sessionContext.omittedTaskCount,
      unresolvedConstraintCount:
        task.sessionContext.unresolvedConstraints.length + (task.sessionContext.omittedUnresolvedConstraintCount ?? 0),
    }),
    ...(task.checkpointId ? { checkpointId: task.checkpointId } : {}),
  })

const mapTasks = (snapshot: AgentWorkspaceRuntimeSnapshot | null): readonly AgentWorkspaceTaskProjection[] => {
  if (!snapshot) return freezeArray([])
  return freezeArray(
    snapshot.tasks
      .filter(task => task.sessionId === snapshot.binding.sessionId)
      .map(taskProjection)
      .sort((left, right) => left.createdAt - right.createdAt || compareCodeUnits(left.taskId, right.taskId)),
  )
}

const mapVersions = (values: readonly AgentWorkspacePersistenceVersion[]): readonly AgentWorkspaceVersionProjection[] =>
  freezeArray(
    values
      .map(value =>
        Object.freeze({
          versionId: value.versionId,
          name: value.name,
          createdAt: value.createdAt,
          sourceBranchId: value.branchId,
          ...(value.sourceSessionId ? { sourceSessionId: value.sourceSessionId } : {}),
          ...(value.sourceTaskId ? { sourceTaskId: value.sourceTaskId } : {}),
          schemaHash: value.projectHash,
        }),
      )
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt ||
          compareCodeUnits(left.sourceBranchId, right.sourceBranchId) ||
          compareCodeUnits(left.versionId, right.versionId),
      ),
  )

const grantOrder = new Map(AGENT_WORKSPACE_GRANT_SCOPES.map((scope, index) => [scope, index]))

const mapGrants = (values: readonly AgentWorkspacePersistenceGrant[]): readonly AgentWorkspaceGrantProjection[] => {
  const byScope = new Map<AgentWorkspaceGrantScope, AgentWorkspacePersistenceGrant>()
  for (const value of values) {
    if (grantOrder.has(value.scope)) byScope.set(value.scope, value)
  }
  return freezeArray(
    [...byScope.values()]
      .map(value =>
        Object.freeze({
          scope: value.scope,
          status: value.status,
          policyVersion: String(value.policyVersion),
          ...(value.providerLabel ? { providerLabel: value.providerLabel } : {}),
          ...(value.grantedAt !== undefined && value.grantedAt !== null ? { grantedAt: value.grantedAt } : {}),
        }),
      )
      .sort(
        (left, right) =>
          (grantOrder.get(left.scope) ?? Number.MAX_SAFE_INTEGER) -
            (grantOrder.get(right.scope) ?? Number.MAX_SAFE_INTEGER) || compareCodeUnits(left.scope, right.scope),
      ),
  )
}

const mapRecovery = (value: AgentWorkspacePersistenceRecovery): AgentWorkspaceRecoveryProjection => {
  if (value.kind === 'unsaved') return Object.freeze({ ...value })
  if (value.kind === 'applied-undurable') return Object.freeze({ ...value })
  return Object.freeze({
    ...value,
    conflictPaths: freezeArray([...new Set(value.conflictPaths)].sort(compareCodeUnits)),
  })
}

const mapRecoveries = (
  values: readonly AgentWorkspacePersistenceRecovery[],
): readonly AgentWorkspaceRecoveryProjection[] => {
  const byId = new Map<string, AgentWorkspaceRecoveryProjection>()
  for (const value of values) byId.set(value.recoveryId, mapRecovery(value))
  return freezeArray(
    [...byId.values()].sort(
      (left, right) => left.occurredAt - right.occurredAt || compareCodeUnits(left.recoveryId, right.recoveryId),
    ),
  )
}

const hashText = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const freezeTargets = (values: readonly AgentWorkspaceTargetProjection[]): readonly AgentWorkspaceTargetProjection[] =>
  freezeArray(
    normalizeAgentWorkspaceTargets(values).map(value =>
      Object.freeze({
        ...value,
        rect: Object.freeze({ ...value.rect }),
      }),
    ),
  )

const createInitialSnapshot = (
  binding: AgentWorkspaceBinding,
  availability: AgentWorkspaceAvailability,
  runtimeStatus: AgentWorkspaceRuntimeStatus,
): AgentWorkspaceSnapshot =>
  Object.freeze({
    schemaVersion: 1,
    availability,
    runtimeStatus,
    projectId: binding.projectId,
    branchId: binding.branchId,
    ...(binding.sessionId ? { sessionId: binding.sessionId } : {}),
    tasks: freezeArray([]),
    versions: freezeArray([]),
    grants: freezeArray([]),
    recoveries: freezeArray([]),
    activeTargets: freezeArray([]),
  })

const lifecycleReady = (snapshot: AgentWorkspacePersistenceSnapshot | null): boolean => snapshot?.state === 'ready'

const recoveryActionFor = (recovery: AgentWorkspaceRecoveryProjection, action: AgentWorkspaceRecoveryAction): boolean =>
  (recovery.kind === 'unsaved' && action === 'retry-save') ||
  (recovery.kind === 'applied-undurable' && action === 'retry-durability') ||
  (recovery.kind === 'compensation-conflict' && action === 'refresh-conflict-report')

class DefaultAgentWorkspaceCommandPortAdapter implements AgentWorkspaceCommandPortAdapter {
  readonly #enabled: boolean
  #binding: AgentWorkspaceBinding
  readonly #runtime: AgentWorkspaceRuntimeFacade | null
  readonly #persistence: AgentWorkspacePersistenceLifecycle | null
  readonly #activity: AgentWorkspaceInvocationActivity | undefined
  readonly #targetResolver: AgentWorkspaceTargetRectResolver | undefined
  readonly #unavailable: Readonly<{ reason: string; detail?: string }>
  readonly #now: () => number
  readonly #onError: (error: unknown, source: AgentWorkspaceAdapterErrorSource) => void
  readonly #listeners = new Set<() => void>()
  readonly #releases: Array<() => void> = []
  readonly #initialization: Promise<void>

  #runtimeSnapshot: AgentWorkspaceRuntimeSnapshot | null = null
  #persistenceSnapshot: AgentWorkspacePersistenceSnapshot | null = null
  #activitySnapshot: AgentWorkspaceInvocationSnapshot | null = null
  #versions: readonly AgentWorkspaceVersionProjection[] = freezeArray([])
  #grants: readonly AgentWorkspaceGrantProjection[] = freezeArray([])
  #persistentRecoveries: readonly AgentWorkspaceRecoveryProjection[] = freezeArray([])
  #targets: readonly AgentWorkspaceTargetProjection[] = freezeArray([])
  #lifecycleLoaded = false
  #lifecycleError: string | undefined
  #runtimeReadError: string | undefined
  #persistenceReadError: string | undefined
  #observedFailureKey: string | undefined
  #observedFailureAt = 0
  #lifecycleEpoch = 0
  #targetEpoch = 0
  #commandTail: Promise<void> = Promise.resolve()
  #disposed = false
  #snapshot: AgentWorkspaceSnapshot
  #snapshotFingerprint: string

  constructor(options: AgentWorkspaceCommandPortAdapterOptions) {
    this.#enabled = options.enabled
    this.#binding = Object.freeze({ ...options.binding })
    this.#runtime = options.runtime
    this.#persistence = options.persistence
    this.#activity = options.invocationActivity
    this.#targetResolver = options.targetRectResolver
    this.#unavailable = options.unavailable ?? Object.freeze({ reason: 'Agent Runtime 暂不可用。' })
    this.#now = options.now ?? Date.now
    this.#onError = options.onError ?? (() => undefined)
    this.#snapshot = createInitialSnapshot(
      this.#binding,
      this.#enabled
        ? Object.freeze({ state: 'unavailable', reason: 'Agent Workspace 正在初始化。' })
        : Object.freeze({ state: 'disabled', reason: 'Agent Runtime 功能未启用。' }),
      this.#enabled ? 'initializing' : 'disposed',
    )
    this.#snapshotFingerprint = JSON.stringify(this.#snapshot)

    if (!this.#enabled) {
      this.#initialization = Promise.resolve()
      return
    }

    this.#readRuntimeSnapshot()
    this.#readPersistenceSnapshot()
    this.#readActivitySnapshot()
    this.#connectSources()
    this.#publish()
    this.#initialization = this.#refreshAll()
  }

  getSnapshot = (): AgentWorkspaceSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => undefined
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  ready = (): Promise<void> => this.#initialization

  async refresh(): Promise<void> {
    this.#assertNotDisposed()
    if (!this.#enabled) return
    if (this.#readRuntimeSnapshot()) this.#resetLifecycleProjection()
    this.#readPersistenceSnapshot()
    this.#invalidateLifecycleIfBindingChanged()
    this.#readActivitySnapshot()
    this.#publish()
    await this.#refreshAll()
  }

  submitIntent(input: { readonly intent: string; readonly mode: AgentWorkspaceIntentMode }): Promise<void> {
    return this.#enqueueCommand(async () => {
      const runtime = this.#requireRuntimeReady()
      this.#assertNoRecoveryLock()
      const intent = requireNonEmpty(input.intent, '搭建目标')
      const expectedMode = deriveAgentWorkspaceIntentMode(this.#snapshot)
      if (input.mode !== expectedMode) throw new Error('任务状态已更新，请根据最新任务谱系重新提交。')
      await this.#requireLocalGrant('project.write')
      await runtime.submit({
        text: intent,
        metadata: Object.freeze({ agentWorkspaceIntentMode: input.mode }),
      })
    })
  }

  pauseTask(taskId: string): Promise<void> {
    return this.#enqueueCommand(async () => {
      const runtime = this.#requireRuntimeReady()
      this.#requireTask(taskId)
      await runtime.pause(taskId)
    })
  }

  resumeTask(taskId: string): Promise<void> {
    return this.#enqueueCommand(async () => {
      const runtime = this.#requireRuntimeReady()
      this.#assertNoRecoveryLock()
      const task = this.#requireTask(taskId)
      if (task.phase !== 'PAUSED') throw new Error('只有已暂停的任务可以继续。')
      await this.#requireLocalGrant('project.write')
      await runtime.resume(taskId)
    })
  }

  cancelTask(taskId: string): Promise<void> {
    return this.#enqueueCommand(async () => {
      const runtime = this.#requireRuntimeReady()
      this.#assertNoRecoveryLock()
      this.#requireTask(taskId)
      await runtime.cancel(taskId)
    })
  }

  respondToQuestion(input: {
    readonly taskId: string
    readonly questionId: string
    readonly response: string
  }): Promise<void> {
    return this.#enqueueCommand(async () => {
      const runtime = this.#requireRuntimeReady()
      this.#assertNoRecoveryLock()
      const task = this.#requireTask(input.taskId)
      if (task.phase !== 'WAITING_USER' || task.question?.questionId !== input.questionId) {
        throw new Error('问题已更新，请回答当前等待中的问题。')
      }
      await this.#requireLocalGrant('project.write')
      await runtime.respond(input.taskId, {
        questionId: input.questionId,
        value: requireNonEmpty(input.response, '回答'),
      })
    })
  }

  compensateTask(taskId: string): Promise<void> {
    return this.#enqueueCommand(async () => {
      const runtime = this.#requireRuntimeReady()
      this.#assertNoRecoveryLock()
      const task = this.#requireTask(taskId)
      if (task.phase !== 'COMPLETED' && task.phase !== 'CANCELLED') {
        throw new Error('只有已完成或已取消的任务可以发起补偿。')
      }
      if (!task.compensationEligible) throw new Error('该任务不满足补偿条件或已被补偿任务占用。')
      await this.#requireLocalGrant('project.write')
      await runtime.compensate(taskId)
    })
  }

  createVersion(name: string): Promise<void> {
    return this.#enqueueLifecycleCommand(async lifecycle => {
      await this.#requireLocalGrant('project.write', lifecycle)
      const sourceTask = this.#sourceTask()
      await lifecycle.createVersion({
        binding: this.#effectiveBinding(),
        name: requireNonEmpty(name, '版本名称'),
        ...(sourceTask ? { sourceTaskId: sourceTask.taskId } : {}),
        ...(sourceTask?.checkpointId ? { sourceCheckpointId: sourceTask.checkpointId } : {}),
      })
    })
  }

  restoreVersion(identity: AgentWorkspaceVersionIdentity): Promise<void> {
    return this.#enqueueLifecycleCommand(async lifecycle => {
      const version = this.#versions.find(
        value => value.versionId === identity.versionId && value.sourceBranchId === identity.sourceBranchId,
      )
      if (!version) throw new Error('要恢复的命名版本不存在或列表已过期。')
      await this.#requireLocalGrant('project.write', lifecycle)
      await lifecycle.restoreVersion({
        binding: this.#effectiveBinding(),
        versionId: version.versionId,
        sourceBranchId: version.sourceBranchId,
        sourceSessionId: version.sourceSessionId ?? null,
        sourceTaskId: version.sourceTaskId ?? null,
      })
    })
  }

  requestGrant(scope: AgentWorkspaceGrantScope): Promise<void> {
    return this.#enqueueLifecycleCommand(lifecycle =>
      lifecycle.requestGrant({ binding: this.#effectiveBinding(), scope: this.#requireGrantScope(scope) }),
    )
  }

  revokeGrant(scope: AgentWorkspaceGrantScope): Promise<void> {
    return this.#enqueueLifecycleCommand(lifecycle =>
      lifecycle.revokeGrant({ binding: this.#effectiveBinding(), scope: this.#requireGrantScope(scope) }),
    )
  }

  retrySave(recoveryId: string): Promise<void> {
    return this.#retryRecovery(recoveryId, 'retry-save')
  }

  retryDurability(recoveryId: string): Promise<void> {
    return this.#retryRecovery(recoveryId, 'retry-durability')
  }

  refreshCompensationConflict(recoveryId: string): Promise<void> {
    return this.#retryRecovery(recoveryId, 'refresh-conflict-report')
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#lifecycleEpoch += 1
    this.#targetEpoch += 1
    for (const release of this.#releases.splice(0)) {
      try {
        release()
      } catch {
        // Source disposal is owned by composition; an unsubscribe failure cannot revive this adapter.
      }
    }
    const listeners = [...this.#listeners]
    this.#listeners.clear()
    this.#runtimeSnapshot = null
    this.#activitySnapshot = null
    this.#targets = freezeArray([])
    this.#snapshot = createInitialSnapshot(
      this.#binding,
      Object.freeze({ state: 'unavailable', reason: 'Agent Workspace 已释放。' }),
      'disposed',
    )
    this.#snapshotFingerprint = JSON.stringify(this.#snapshot)
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // UI observers cannot affect lifecycle disposal.
      }
    }
  }

  #connectSources(): void {
    if (this.#runtime) {
      try {
        this.#releases.push(
          this.#runtime.subscribe(snapshot => {
            if (this.#disposed) return
            this.#runtimeReadError = undefined
            const bindingChanged = this.#acceptRuntimeSnapshot(snapshot)
            if (bindingChanged) this.#resetLifecycleProjection()
            this.#publish()
            if (bindingChanged) void this.#refreshLifecycle()
            void this.#refreshTargets()
          }),
        )
      } catch (error) {
        this.#runtimeReadError = this.#errorMessage(error)
        this.#report(error, 'runtime-subscribe')
      }
    }
    if (this.#persistence) {
      try {
        this.#releases.push(
          this.#persistence.subscribe(() => {
            if (this.#disposed) return
            this.#readPersistenceSnapshot()
            this.#invalidateLifecycleIfBindingChanged()
            this.#publish()
            void this.#refreshLifecycle()
          }),
        )
      } catch (error) {
        this.#persistenceReadError = this.#errorMessage(error)
        this.#report(error, 'persistence-subscribe')
      }
    }
    if (this.#activity) {
      try {
        this.#releases.push(
          this.#activity.subscribe(() => {
            if (this.#disposed) return
            this.#readActivitySnapshot()
            void this.#refreshTargets()
          }),
        )
      } catch (error) {
        this.#report(error, 'activity-subscribe')
      }
    }
  }

  #readRuntimeSnapshot(): boolean {
    if (!this.#runtime) {
      this.#runtimeSnapshot = null
      return false
    }
    try {
      const bindingChanged = this.#acceptRuntimeSnapshot(this.#runtime.getSnapshot())
      this.#runtimeReadError = undefined
      return bindingChanged
    } catch (error) {
      this.#runtimeSnapshot = null
      this.#runtimeReadError = this.#errorMessage(error)
      this.#report(error, 'runtime-read')
      return false
    }
  }

  #acceptRuntimeSnapshot(snapshot: AgentWorkspaceRuntimeSnapshot): boolean {
    const previousBindingKey = bindingKey(this.#binding)
    if (
      this.#binding.sessionId === undefined &&
      this.#binding.projectId === snapshot.binding.projectId &&
      this.#binding.branchId === snapshot.binding.branchId
    ) {
      this.#binding = Object.freeze({ ...this.#binding, sessionId: snapshot.binding.sessionId })
    }
    this.#runtimeSnapshot = snapshot
    return previousBindingKey !== bindingKey(this.#binding)
  }

  #readPersistenceSnapshot(): void {
    if (!this.#persistence) {
      this.#persistenceSnapshot = null
      return
    }
    try {
      this.#persistenceSnapshot = this.#persistence.getSnapshot()
      this.#persistenceReadError = undefined
    } catch (error) {
      this.#persistenceSnapshot = null
      this.#persistenceReadError = this.#errorMessage(error)
      this.#report(error, 'persistence-read')
    }
  }

  #readActivitySnapshot(): void {
    if (!this.#activity) {
      this.#activitySnapshot = null
      return
    }
    try {
      this.#activitySnapshot = this.#activity.getSnapshot()
    } catch (error) {
      this.#activitySnapshot = null
      this.#targets = freezeArray([])
      this.#report(error, 'activity-read')
    }
  }

  async #refreshAll(): Promise<void> {
    await Promise.all([this.#refreshLifecycle(), this.#refreshTargets()])
  }

  async #refreshLifecycle(): Promise<void> {
    const epoch = ++this.#lifecycleEpoch
    const persistence = this.#persistence
    const snapshot = this.#persistenceSnapshot
    if (
      this.#disposed ||
      !persistence ||
      !lifecycleReady(snapshot) ||
      !snapshot ||
      !samePersistenceBinding(this.#binding, snapshot)
    ) {
      this.#publish()
      return
    }
    const binding = this.#effectiveBinding()
    const scopeKey = bindingKey(binding)
    try {
      const projection = await persistence.readWorkspaceProjection(binding)
      if (
        this.#disposed ||
        epoch !== this.#lifecycleEpoch ||
        scopeKey !== bindingKey(this.#effectiveBinding()) ||
        !this.#persistenceSnapshot ||
        !samePersistenceBinding(this.#binding, this.#persistenceSnapshot)
      ) {
        return
      }
      this.#versions = mapVersions(projection.versions)
      this.#grants = mapGrants(projection.grants)
      this.#persistentRecoveries = mapRecoveries(projection.recoveries)
      this.#lifecycleLoaded = true
      this.#lifecycleError = undefined
      this.#publish()
    } catch (error) {
      if (this.#disposed || epoch !== this.#lifecycleEpoch) return
      this.#lifecycleLoaded = false
      this.#lifecycleError = this.#errorMessage(error)
      this.#report(error, 'lifecycle-refresh')
      this.#publish()
    }
  }

  async #refreshTargets(): Promise<void> {
    const epoch = ++this.#targetEpoch
    const resolver = this.#targetResolver
    const activity = this.#activitySnapshot
    const runtime = this.#runtimeSnapshot
    const runtimeMatches = runtime !== null && sameRuntimeBinding(this.#binding, runtime.binding)
    const sessionTaskIds = new Set(
      runtimeMatches
        ? runtime.tasks.filter(task => task.sessionId === runtime.binding.sessionId).map(task => task.taskId)
        : [],
    )
    const activeCalls = activity?.activeCalls.filter(call => sessionTaskIds.has(call.taskId)) ?? []
    if (this.#disposed || !activity || activeCalls.length === 0) {
      if (!this.#disposed) {
        this.#targets = freezeArray([])
        this.#publish()
      }
      return
    }
    const binding = this.#effectiveBinding()
    const scopeKey = bindingKey(binding)
    const revision = activity.revision
    const atomicTargets = new Map<string, AgentWorkspaceTargetProjection>()
    for (const call of activeCalls) {
      for (const target of call.targets ?? []) {
        const targetId = target.targetNodeId ?? target.nodeId
        if (!targetId) continue
        atomicTargets.set(
          targetId,
          Object.freeze({
            targetId,
            label: target.label ?? targetId,
            rect: Object.freeze({
              left: target.rect.x,
              top: target.rect.y,
              width: target.rect.width,
              height: target.rect.height,
            }),
            ...(target.tone ? { tone: target.tone } : {}),
          }),
        )
      }
    }
    const unresolvedTargetIds = new Set(
      activeCalls.flatMap(call => call.targetNodeIds ?? []).filter(targetId => !atomicTargets.has(targetId)),
    )
    if (!resolver || unresolvedTargetIds.size === 0) {
      this.#targets = freezeTargets([...atomicTargets.values()])
      this.#publish()
      return
    }
    try {
      const resolved = await resolver.resolveTargets({ binding, activeCalls: freezeArray(activeCalls) })
      if (
        this.#disposed ||
        epoch !== this.#targetEpoch ||
        scopeKey !== bindingKey(this.#effectiveBinding()) ||
        this.#activitySnapshot?.revision !== revision
      ) {
        return
      }
      const byTargetId = new Map(atomicTargets)
      for (const target of resolved) {
        if (!unresolvedTargetIds.has(target.targetId) || byTargetId.has(target.targetId)) continue
        byTargetId.set(
          target.targetId,
          Object.freeze({
            targetId: target.targetId,
            label: target.label,
            rect: Object.freeze({
              left: target.rect.x,
              top: target.rect.y,
              width: target.rect.width,
              height: target.rect.height,
            }),
            ...(target.tone ? { tone: target.tone } : {}),
          }),
        )
      }
      this.#targets = freezeTargets([...byTargetId.values()])
      this.#publish()
    } catch (error) {
      if (this.#disposed || epoch !== this.#targetEpoch) return
      this.#targets = freezeTargets([...atomicTargets.values()])
      this.#report(error, 'target-refresh')
      this.#publish()
    }
  }

  #availability(): AgentWorkspaceAvailability {
    if (!this.#enabled) return Object.freeze({ state: 'disabled', reason: 'Agent Runtime 功能未启用。' })
    if (this.#disposed) return Object.freeze({ state: 'unavailable', reason: 'Agent Workspace 已释放。' })
    if (!this.#runtime) return Object.freeze({ state: 'unavailable', ...this.#unavailable })
    if (this.#runtimeReadError) {
      return Object.freeze({ state: 'unavailable', reason: '无法读取 Agent Runtime。', detail: this.#runtimeReadError })
    }
    const runtime = this.#runtimeSnapshot
    if (!runtime) return Object.freeze({ state: 'unavailable', ...this.#unavailable })
    if (!sameRuntimeBinding(this.#binding, runtime.binding)) {
      return Object.freeze({ state: 'unavailable', reason: 'Agent Runtime 已绑定到其他项目分支。' })
    }
    if (runtime.status !== 'ready') {
      const reasonByStatus: Record<Exclude<AgentWorkspaceRuntimeStatus, 'ready'>, string> = {
        initializing: 'Agent Runtime 正在初始化。',
        recovering: 'Agent Runtime 正在恢复。',
        failed: 'Agent Runtime 启动失败。',
        disposed: 'Agent Runtime 已释放。',
      }
      return Object.freeze({
        state: 'unavailable',
        reason: reasonByStatus[runtime.status],
        ...(runtime.failure?.message ? { detail: runtime.failure.message } : {}),
      })
    }
    if (!this.#persistence) return Object.freeze({ state: 'unavailable', reason: '持久化生命周期不可用。' })
    if (this.#persistenceReadError) {
      return Object.freeze({ state: 'unavailable', reason: '无法读取持久化状态。', detail: this.#persistenceReadError })
    }
    const persistence = this.#persistenceSnapshot
    if (!persistence) return Object.freeze({ state: 'unavailable', reason: '持久化生命周期不可用。' })
    if (!samePersistenceBinding(this.#binding, persistence)) {
      return Object.freeze({ state: 'unavailable', reason: '持久化已绑定到其他项目分支。' })
    }
    if (persistence.state !== 'ready') {
      return Object.freeze({
        state: 'unavailable',
        reason:
          persistence.state === 'failed'
            ? '持久化初始化失败。'
            : persistence.state === 'restoring'
              ? '正在恢复命名版本。'
              : persistence.state === 'disposed' || persistence.state === 'disposing'
                ? '持久化生命周期已释放。'
                : '持久化正在初始化。',
        ...(persistence.lastFailure?.message ? { detail: persistence.lastFailure.message } : {}),
      })
    }
    if (this.#lifecycleError) {
      return Object.freeze({
        state: 'unavailable',
        reason: 'Agent Workspace 数据刷新失败。',
        detail: this.#lifecycleError,
      })
    }
    if (!this.#lifecycleLoaded) return Object.freeze({ state: 'unavailable', reason: 'Agent Workspace 数据正在加载。' })
    return Object.freeze({ state: 'ready' })
  }

  #runtimeStatus(): AgentWorkspaceRuntimeStatus {
    if (!this.#enabled || this.#disposed) return 'disposed'
    return this.#runtimeSnapshot?.status ?? 'failed'
  }

  #effectiveBinding(): AgentWorkspaceBinding {
    const runtimeSessionId =
      this.#runtimeSnapshot && sameRuntimeBinding(this.#binding, this.#runtimeSnapshot.binding)
        ? this.#runtimeSnapshot.binding.sessionId
        : undefined
    return Object.freeze({
      projectId: this.#binding.projectId,
      branchId: this.#binding.branchId,
      ...((this.#binding.sessionId ?? runtimeSessionId)
        ? { sessionId: this.#binding.sessionId ?? runtimeSessionId }
        : {}),
    })
  }

  #statusRecovery(): AgentWorkspaceRecoveryProjection | undefined {
    const snapshot = this.#persistenceSnapshot
    const failure = snapshot?.lastFailure
    if (!snapshot || !failure || !samePersistenceBinding(this.#binding, snapshot)) {
      this.#observedFailureKey = undefined
      return undefined
    }
    const key = `${failure.source}\u0000${snapshot.draftGeneration}\u0000${failure.message}`
    if (this.#observedFailureKey !== key) {
      this.#observedFailureKey = key
      this.#observedFailureAt = failure.occurredAt ?? this.#now()
    }
    return Object.freeze({
      kind: 'unsaved',
      recoveryId:
        failure.recoveryId ??
        `unsaved:${this.#binding.projectId}:${this.#binding.branchId}:${snapshot.draftGeneration}:${failure.source}:${hashText(failure.message)}`,
      message: failure.message,
      occurredAt: this.#observedFailureAt,
    })
  }

  #combinedRecoveries(): readonly AgentWorkspaceRecoveryProjection[] {
    const statusRecovery = this.#statusRecovery()
    if (!statusRecovery) return this.#persistentRecoveries
    const byId = new Map(this.#persistentRecoveries.map(value => [value.recoveryId, value]))
    byId.set(statusRecovery.recoveryId, statusRecovery)
    return freezeArray(
      [...byId.values()].sort(
        (left, right) => left.occurredAt - right.occurredAt || compareCodeUnits(left.recoveryId, right.recoveryId),
      ),
    )
  }

  #buildSnapshot(): AgentWorkspaceSnapshot {
    const runtimeMatches =
      this.#runtimeSnapshot !== null && sameRuntimeBinding(this.#binding, this.#runtimeSnapshot.binding)
    const persistenceMatches =
      this.#persistenceSnapshot !== null && samePersistenceBinding(this.#binding, this.#persistenceSnapshot)
    const tasks = runtimeMatches ? mapTasks(this.#runtimeSnapshot) : freezeArray([])
    const activeTaskId =
      runtimeMatches &&
      this.#runtimeSnapshot?.activeTask &&
      tasks.some(task => task.taskId === this.#runtimeSnapshot?.activeTask?.taskId)
        ? this.#runtimeSnapshot.activeTask.taskId
        : undefined
    const binding = this.#effectiveBinding()
    return Object.freeze({
      schemaVersion: 1,
      availability: this.#availability(),
      runtimeStatus: this.#runtimeStatus(),
      projectId: binding.projectId,
      branchId: binding.branchId,
      ...(binding.sessionId ? { sessionId: binding.sessionId } : {}),
      ...(activeTaskId ? { activeTaskId } : {}),
      tasks,
      versions: persistenceMatches ? this.#versions : freezeArray([]),
      grants: persistenceMatches ? this.#grants : freezeArray([]),
      recoveries: persistenceMatches ? this.#combinedRecoveries() : freezeArray([]),
      activeTargets: runtimeMatches ? this.#targets : freezeArray([]),
    })
  }

  #publish(): void {
    if (this.#disposed) return
    const next = this.#buildSnapshot()
    const fingerprint = JSON.stringify(next)
    if (fingerprint === this.#snapshotFingerprint) return
    this.#snapshot = next
    this.#snapshotFingerprint = fingerprint
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch {
        // UI observers cannot affect command authority or source subscriptions.
      }
    }
  }

  #invalidateLifecycleIfBindingChanged(): void {
    if (this.#persistenceSnapshot && samePersistenceBinding(this.#binding, this.#persistenceSnapshot)) return
    this.#resetLifecycleProjection()
  }

  #resetLifecycleProjection(): void {
    this.#lifecycleEpoch += 1
    this.#versions = freezeArray([])
    this.#grants = freezeArray([])
    this.#persistentRecoveries = freezeArray([])
    this.#lifecycleLoaded = false
    this.#lifecycleError = undefined
  }

  #requireRuntimeReady(): AgentWorkspaceRuntimeFacade {
    this.#assertNotDisposed()
    if (this.#availability().state !== 'ready' || !this.#runtime) {
      const availability = this.#availability()
      throw new Error(availability.state === 'ready' ? 'Agent Runtime 暂不可用。' : availability.reason)
    }
    return this.#runtime
  }

  #requireLifecycleReady(): AgentWorkspacePersistenceLifecycle {
    this.#assertNotDisposed()
    if (!this.#persistence || !this.#persistenceSnapshot || !lifecycleReady(this.#persistenceSnapshot)) {
      throw new Error('持久化生命周期尚未就绪。')
    }
    if (!samePersistenceBinding(this.#binding, this.#persistenceSnapshot)) {
      throw new Error('持久化已切换到其他项目分支。')
    }
    if (!this.#lifecycleLoaded || this.#lifecycleError) throw new Error('Agent Workspace 数据尚未就绪。')
    return this.#persistence
  }

  #requireTask(taskId: string): AgentWorkspaceTaskProjection {
    const task = this.#snapshot.tasks.find(value => value.taskId === taskId)
    if (!task) throw new Error('任务不存在或不属于当前会话。')
    return task
  }

  #assertNoRecoveryLock(): void {
    const locked = this.#snapshot.tasks.find(isAgentWorkspaceTaskRecoveryLocked)
    if (locked) this.#assertTaskNotRecoveryLocked(locked)
  }

  #assertTaskNotRecoveryLocked(task: AgentWorkspaceTaskProjection): void {
    if (!isAgentWorkspaceTaskRecoveryLocked(task)) return
    throw new Error('任务处于已应用但未持久化的恢复锁定状态，请先在恢复事项中完成精确回执核对。')
  }

  #sourceTask(): AgentWorkspaceTaskProjection | undefined {
    if (this.#snapshot.activeTaskId) {
      const active = this.#snapshot.tasks.find(task => task.taskId === this.#snapshot.activeTaskId)
      if (active) return active
    }
    return this.#snapshot.tasks.at(-1)
  }

  #requireGrantScope(scope: AgentWorkspaceGrantScope): AgentWorkspaceGrantScope {
    if (!AGENT_WORKSPACE_GRANT_SCOPES.includes(scope)) throw new Error('本地授权范围不受支持。')
    return scope
  }

  #retryRecovery(recoveryId: string, action: AgentWorkspaceRecoveryAction): Promise<void> {
    return this.#enqueueLifecycleCommand(async lifecycle => {
      const recovery = this.#snapshot.recoveries.find(value => value.recoveryId === recoveryId)
      if (!recovery || !recoveryActionFor(recovery, action)) throw new Error('恢复事项不存在或操作类型不匹配。')
      await lifecycle.retryRecovery({
        binding: this.#effectiveBinding(),
        recoveryId,
        kind: recovery.kind,
        action,
      })
    })
  }

  #enqueueLifecycleCommand(effect: (lifecycle: AgentWorkspacePersistenceLifecycle) => Promise<void>): Promise<void> {
    return this.#enqueueCommand(async () => {
      const lifecycle = this.#requireLifecycleReady()
      await effect(lifecycle)
      if (this.#disposed) return
      this.#readPersistenceSnapshot()
      this.#invalidateLifecycleIfBindingChanged()
      this.#publish()
      await this.#refreshLifecycle()
    })
  }

  async #requireLocalGrant(scope: AgentWorkspaceGrantScope, lifecycle = this.#requireLifecycleReady()): Promise<void> {
    const checkedScope = this.#requireGrantScope(scope)
    const decision = await lifecycle.checkLocalGrant({ binding: this.#effectiveBinding(), scope: checkedScope })
    if (decision.granted) return
    if (decision.reason === 'granted') throw new Error('本地授权检查返回了矛盾的授权结果。')
    throw new AgentWorkspaceGrantConfirmationRequiredError(checkedScope, decision.reason)
  }

  #enqueueCommand(effect: () => Promise<void>): Promise<void> {
    const run = this.#commandTail.then(async () => {
      this.#assertNotDisposed()
      await effect()
    })
    this.#commandTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new Error('Agent Workspace 已释放。')
  }

  #errorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message
    return typeof error === 'string' && error.trim() ? error : '未知错误'
  }

  #report(error: unknown, source: AgentWorkspaceAdapterErrorSource): void {
    try {
      this.#onError(error, source)
    } catch {
      // Diagnostics callbacks cannot affect the Workspace authority boundary.
    }
  }
}

export const createAgentWorkspaceCommandPortAdapter = (
  options: AgentWorkspaceCommandPortAdapterOptions,
): AgentWorkspaceCommandPortAdapter => new DefaultAgentWorkspaceCommandPortAdapter(options)
