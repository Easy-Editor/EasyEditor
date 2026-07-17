import type {
  AgentWorkspaceCommandPort,
  AgentWorkspaceControllerContract,
  AgentWorkspaceGrantScope,
  AgentWorkspaceIntentMode,
  AgentWorkspaceSnapshot,
  AgentWorkspaceTaskProjection,
  AgentWorkspaceVersionIdentity,
  AgentWorkspaceViewState,
} from './types'
import { agentWorkspaceVersionRestoreActionKey } from './version-identity.ts'

const ACTIVE_TASK_PHASES = new Set([
  'OBSERVE',
  'BLUEPRINT',
  'WAITING_USER',
  'PLAN_STEP',
  'EXECUTE',
  'YIELDED',
  'QUERY_RECEIPT',
  'VERIFY',
  'REPAIR',
  'CHECKPOINT',
  'PAUSED',
  'RECOVERING',
])

const TERMINAL_COMPENSATION_PHASES = new Set(['COMPLETED', 'CANCELLED'])

const toMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message
  return '操作失败，请检查当前状态后重试。'
}

const trimRequired = (value: string, label: string): string => {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label}不能为空。`)
  return normalized
}

const findActiveTask = (snapshot: AgentWorkspaceSnapshot): AgentWorkspaceTaskProjection | undefined => {
  if (!snapshot.activeTaskId) return undefined
  return snapshot.tasks.find(task => task.taskId === snapshot.activeTaskId)
}

export const deriveAgentWorkspaceIntentMode = (snapshot: AgentWorkspaceSnapshot): AgentWorkspaceIntentMode => {
  const activeTask = findActiveTask(snapshot)
  if (activeTask && ACTIVE_TASK_PHASES.has(activeTask.phase)) return 'refinement'
  if (snapshot.tasks.length > 0) return 'follow-up'
  return 'initial'
}

const createViewState = (
  remote: AgentWorkspaceSnapshot,
  local: Omit<AgentWorkspaceViewState, 'remote' | 'intentMode'>,
): AgentWorkspaceViewState =>
  Object.freeze({
    remote,
    ...local,
    intentMode: deriveAgentWorkspaceIntentMode(remote),
  })

export class AgentWorkspaceController implements AgentWorkspaceControllerContract {
  readonly #port: AgentWorkspaceCommandPort
  readonly #listeners = new Set<() => void>()
  readonly #unsubscribePort: () => void
  #state: AgentWorkspaceViewState
  #disposed = false

  constructor(port: AgentWorkspaceCommandPort) {
    this.#port = port
    this.#state = createViewState(port.getSnapshot(), {
      intentDraft: '',
      versionNameDraft: '',
      responseDraft: '',
    })
    this.#unsubscribePort = port.subscribe(() => this.#refreshRemote())
  }

  getSnapshot = (): AgentWorkspaceViewState => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  setIntentDraft(value: string): void {
    this.#replace({ intentDraft: value, actionError: undefined })
  }

  setVersionNameDraft(value: string): void {
    this.#replace({ versionNameDraft: value, actionError: undefined })
  }

  setResponseDraft(value: string): void {
    this.#replace({ responseDraft: value, actionError: undefined })
  }

  clearActionError(): void {
    this.#replace({ actionError: undefined })
  }

  async submitIntent(): Promise<boolean> {
    let intent: string
    try {
      intent = trimRequired(this.#state.intentDraft, '搭建目标')
      this.#assertReady()
    } catch (error) {
      this.#setError(error)
      return false
    }
    const mode = this.#state.intentMode
    return this.#run(
      `submit:${mode}`,
      () => this.#port.submitIntent({ intent, mode }),
      () => {
        this.#replace({ intentDraft: '' })
      },
    )
  }

  pauseCurrentTask(): Promise<boolean> {
    const task = this.#requireActiveTask()
    if (!task) return Promise.resolve(false)
    return this.#run(`pause:${task.taskId}`, () => this.#port.pauseTask(task.taskId))
  }

  resumeCurrentTask(): Promise<boolean> {
    const task = this.#requireActiveTask()
    if (!task) return Promise.resolve(false)
    return this.#run(`resume:${task.taskId}`, () => this.#port.resumeTask(task.taskId))
  }

  cancelCurrentTask(): Promise<boolean> {
    const task = this.#requireActiveTask()
    if (!task) return Promise.resolve(false)
    return this.#run(`cancel:${task.taskId}`, () => this.#port.cancelTask(task.taskId))
  }

  respondToQuestion(): Promise<boolean> {
    const task = this.#requireActiveTask()
    if (!task) return Promise.resolve(false)
    if (task.phase !== 'WAITING_USER' || !task.question) {
      this.#setError(new Error('只有等待确认中的任务可以提交回答。'))
      return Promise.resolve(false)
    }
    let response: string
    try {
      response = trimRequired(this.#state.responseDraft, '回答')
    } catch (error) {
      this.#setError(error)
      return Promise.resolve(false)
    }
    return this.#run(
      `respond:${task.taskId}`,
      () =>
        this.#port.respondToQuestion({
          taskId: task.taskId,
          questionId: task.question?.questionId ?? '',
          response,
        }),
      () => this.#replace({ responseDraft: '' }),
    )
  }

  createVersion(): Promise<boolean> {
    let name: string
    try {
      name = trimRequired(this.#state.versionNameDraft, '版本名称')
    } catch (error) {
      this.#setError(error)
      return Promise.resolve(false)
    }
    return this.#run(
      'version:create',
      () => this.#port.createVersion(name),
      () => {
        this.#replace({ versionNameDraft: '' })
      },
    )
  }

  restoreVersion(identity: AgentWorkspaceVersionIdentity): Promise<boolean> {
    const version = this.#state.remote.versions.find(
      item => item.versionId === identity.versionId && item.sourceBranchId === identity.sourceBranchId,
    )
    if (!version) {
      this.#setError(new Error('要恢复的命名版本不存在。'))
      return Promise.resolve(false)
    }
    return this.#run(agentWorkspaceVersionRestoreActionKey(identity), () => this.#port.restoreVersion(identity))
  }

  compensateTask(taskId: string): Promise<boolean> {
    const task = this.#state.remote.tasks.find(item => item.taskId === taskId)
    if (!task || !TERMINAL_COMPENSATION_PHASES.has(task.phase)) {
      this.#setError(new Error('只有已完成或已取消的任务可以发起补偿。'))
      return Promise.resolve(false)
    }
    return this.#run(`task:compensate:${taskId}`, () => this.#port.compensateTask(taskId))
  }

  requestGrant(scope: AgentWorkspaceGrantScope): Promise<boolean> {
    return this.#run(`grant:request:${scope}`, () => this.#port.requestGrant(scope))
  }

  revokeGrant(scope: AgentWorkspaceGrantScope): Promise<boolean> {
    return this.#run(`grant:revoke:${scope}`, () => this.#port.revokeGrant(scope))
  }

  retrySave(recoveryId: string): Promise<boolean> {
    return this.#run(`recovery:save:${recoveryId}`, () => this.#port.retrySave(recoveryId))
  }

  retryDurability(recoveryId: string): Promise<boolean> {
    return this.#run(`recovery:durability:${recoveryId}`, () => this.#port.retryDurability(recoveryId))
  }

  refreshCompensationConflict(recoveryId: string): Promise<boolean> {
    return this.#run(`recovery:refresh-conflict-report:${recoveryId}`, () =>
      this.#port.refreshCompensationConflict(recoveryId),
    )
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#unsubscribePort()
    this.#listeners.clear()
  }

  #assertReady(): void {
    const { availability } = this.#state.remote
    if (availability.state !== 'ready') throw new Error(availability.reason)
  }

  #requireActiveTask(): AgentWorkspaceTaskProjection | undefined {
    try {
      this.#assertReady()
    } catch (error) {
      this.#setError(error)
      return undefined
    }
    const task = findActiveTask(this.#state.remote)
    if (!task) this.#setError(new Error('当前没有可操作的 Agent 任务。'))
    return task
  }

  async #run(actionId: string, effect: () => Promise<void>, onSuccess?: () => void): Promise<boolean> {
    if (this.#disposed) return false
    if (this.#state.pendingAction) return false
    this.#replace({ pendingAction: actionId, actionError: undefined })
    try {
      await effect()
      if (this.#disposed) return false
      this.#refreshRemote()
      onSuccess?.()
      return true
    } catch (error) {
      this.#setError(error)
      return false
    } finally {
      if (!this.#disposed) this.#replace({ pendingAction: undefined })
    }
  }

  #refreshRemote(): void {
    if (this.#disposed) return
    const previousQuestionId = findActiveTask(this.#state.remote)?.question?.questionId
    const remote = this.#port.getSnapshot()
    const nextQuestionId = findActiveTask(remote)?.question?.questionId
    this.#state = createViewState(remote, {
      intentDraft: this.#state.intentDraft,
      versionNameDraft: this.#state.versionNameDraft,
      responseDraft: previousQuestionId === nextQuestionId ? this.#state.responseDraft : '',
      pendingAction: this.#state.pendingAction,
      actionError: this.#state.actionError,
    })
    this.#emit()
  }

  #setError(error: unknown): void {
    this.#replace({ actionError: toMessage(error) })
  }

  #replace(patch: Partial<Omit<AgentWorkspaceViewState, 'remote' | 'intentMode'>>): void {
    if (this.#disposed) return
    this.#state = createViewState(this.#state.remote, {
      intentDraft: patch.intentDraft ?? this.#state.intentDraft,
      versionNameDraft: patch.versionNameDraft ?? this.#state.versionNameDraft,
      responseDraft: patch.responseDraft ?? this.#state.responseDraft,
      pendingAction: Object.hasOwn(patch, 'pendingAction') ? patch.pendingAction : this.#state.pendingAction,
      actionError: Object.hasOwn(patch, 'actionError') ? patch.actionError : this.#state.actionError,
    })
    this.#emit()
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}

export const createAgentWorkspaceController = (port: AgentWorkspaceCommandPort): AgentWorkspaceControllerContract =>
  new AgentWorkspaceController(port)
