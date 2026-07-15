import type {
  AgentHost,
  AgentPersistencePort,
  AgentPhase,
  AgentQuestion,
  AgentRuntimeBinding,
  AgentRuntimeFailure,
  AgentRuntimeSnapshot,
  AgentRuntimeStatus,
  AgentTaskSnapshot,
  Clock,
  HostSnapshot,
  IdFactory,
  JsonObject,
  ModelAdapter,
  ModelEvent,
  ModelTurnPhase,
  ModelTurnRequest,
  SemanticCall,
  TaskRef,
  UserIntent,
  UserResponse,
} from '../../contracts.js'
import { collectModelEvents } from '../model/index.js'
import { applyHostSnapshotDelta, cloneFrozenHostSnapshot } from '../snapshot/index.js'

export type WorkerStateMachineErrorCode =
  | 'disposed'
  | 'invalid-task-phase'
  | 'missing-task'
  | 'invalid-model-turn'
  | 'invalid-tool-call-context'

export class WorkerStateMachineError extends Error {
  readonly code: WorkerStateMachineErrorCode

  constructor(code: WorkerStateMachineErrorCode, message: string) {
    super(message)
    this.name = 'WorkerStateMachineError'
    this.code = code
  }
}

export interface WorkerStateMachineOptions {
  readonly binding: AgentRuntimeBinding
  readonly model: ModelAdapter
  readonly host: AgentHost
  readonly persistence: AgentPersistencePort
  readonly clock: Clock
  readonly idFactory: IdFactory
  readonly repairBudget?: number
  readonly onSnapshot?: (snapshot: AgentRuntimeSnapshot) => void
}

export interface WorkerStateMachine {
  submit(input: UserIntent): Promise<TaskRef>
  pause(taskId: string): Promise<void>
  resume(taskId: string): Promise<void>
  cancel(taskId: string): Promise<void>
  respond(taskId: string, response: UserResponse): Promise<void>
  recover(): Promise<void>
  getSnapshot(): AgentRuntimeSnapshot
  subscribe(listener: (snapshot: AgentRuntimeSnapshot) => void): () => void
  waitForIdle(): Promise<void>
  dispose(): Promise<void>
}

interface MutableTask {
  taskId: string
  sessionId: string
  parentTaskId?: string
  supersedesTaskId?: string
  phase: AgentPhase
  createdAt: number
  updatedAt: number
  repairAttempts: number
  intent: UserIntent
  response?: UserResponse
  question?: AgentQuestion
  failure?: AgentRuntimeFailure
  latestSnapshot?: HostSnapshot
  controller?: AbortController
  run?: Promise<void>
  nextModelPhase: ModelTurnPhase
}

interface TurnOutcome {
  readonly complete: boolean
  readonly question?: AgentQuestion
  readonly pauseReason?: string
  readonly toolCall?: SemanticCall
}

const terminalPhases = new Set<AgentPhase>(['COMPLETED', 'CANCELLED', 'FAILED'])

const isAbortError = (error: unknown) =>
  error instanceof DOMException ? error.name === 'AbortError' : error instanceof Error && error.name === 'AbortError'

const failureFrom = (code: string, error: unknown, retryable = false): AgentRuntimeFailure => ({
  code,
  message: error instanceof Error ? error.message : String(error),
  retryable,
})

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const entry of Object.values(value)) deepFreeze(entry)
  return Object.freeze(value)
}

const cloneFrozen = <Value>(value: Value): Value => deepFreeze(structuredClone(value))

const taskRef = (task: MutableTask): TaskRef =>
  cloneFrozen({
    taskId: task.taskId,
    sessionId: task.sessionId,
    ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
    ...(task.supersedesTaskId ? { supersedesTaskId: task.supersedesTaskId } : {}),
  })

const taskSnapshot = (task: MutableTask): AgentTaskSnapshot =>
  cloneFrozen({
    ...taskRef(task),
    phase: task.phase,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    repairAttempts: task.repairAttempts,
    ...(task.question ? { question: task.question } : {}),
    ...(task.failure ? { failure: task.failure } : {}),
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseRecoveredTask = (value: unknown): MutableTask | undefined => {
  if (!isRecord(value) || !isRecord(value.intent)) return undefined
  const { taskId, sessionId, phase, createdAt, updatedAt, repairAttempts } = value
  if (
    typeof taskId !== 'string' ||
    typeof sessionId !== 'string' ||
    typeof phase !== 'string' ||
    typeof createdAt !== 'number' ||
    typeof updatedAt !== 'number' ||
    typeof repairAttempts !== 'number' ||
    typeof value.intent.text !== 'string'
  ) {
    return undefined
  }
  return {
    taskId,
    sessionId,
    phase: phase as AgentPhase,
    createdAt,
    updatedAt,
    repairAttempts,
    intent: value.intent as unknown as UserIntent,
    parentTaskId: typeof value.parentTaskId === 'string' ? value.parentTaskId : undefined,
    supersedesTaskId: typeof value.supersedesTaskId === 'string' ? value.supersedesTaskId : undefined,
    nextModelPhase: 'PLAN_STEP',
  }
}

const toRecordValue = (task: MutableTask, persistedPhase: AgentPhase): JsonObject => ({
  taskId: task.taskId,
  sessionId: task.sessionId,
  phase: persistedPhase,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  repairAttempts: task.repairAttempts,
  intent: {
    text: task.intent.text,
    ...(task.intent.metadata ? { metadata: task.intent.metadata } : {}),
  },
  ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
  ...(task.supersedesTaskId ? { supersedesTaskId: task.supersedesTaskId } : {}),
})

export const createWorkerStateMachine = (options: WorkerStateMachineOptions): WorkerStateMachine => {
  const sessionId = options.binding.sessionId ?? options.idFactory.next('session')
  const binding = cloneFrozen({ ...options.binding, sessionId })
  const listeners = new Set<(snapshot: AgentRuntimeSnapshot) => void>()
  const tasks = new Map<string, MutableTask>()
  const runs = new Set<Promise<void>>()
  const repairBudget = options.repairBudget ?? 2
  let activeTask: MutableTask | undefined
  let currentSnapshot: AgentRuntimeSnapshot
  let disposed = false
  let revision = 0
  let runtimeStatus: AgentRuntimeStatus = 'ready'
  let runtimeFailure: AgentRuntimeFailure | undefined
  let draftGeneration = 0
  let commitTail = Promise.resolve()

  const emit = () => {
    revision += 1
    const next: AgentRuntimeSnapshot = {
      schemaVersion: 1,
      binding,
      status: runtimeStatus,
      phase: activeTask?.phase ?? 'IDLE',
      revision,
      ...(activeTask ? { activeTask: taskSnapshot(activeTask) } : {}),
      tasks: [...tasks.values()].map(taskSnapshot),
      ...(runtimeFailure ? { failure: runtimeFailure } : {}),
    }
    currentSnapshot = cloneFrozen(next)
    options.onSnapshot?.(currentSnapshot)
    for (const listener of [...listeners]) listener(currentSnapshot)
  }

  currentSnapshot = cloneFrozen({
    schemaVersion: 1,
    binding,
    status: runtimeStatus,
    phase: 'IDLE',
    revision,
    tasks: [],
  })

  const assertUsable = () => {
    if (disposed) throw new WorkerStateMachineError('disposed', 'worker state machine is disposed')
  }

  const findTask = (taskId: string) => {
    const task = tasks.get(taskId)
    if (!task) throw new WorkerStateMachineError('missing-task', `unknown task ${taskId}`)
    return task
  }

  const setPhase = (task: MutableTask, phase: AgentPhase) => {
    task.phase = phase
    task.updatedAt = options.clock.now()
    emit()
  }

  const setFailure = (task: MutableTask, failure: AgentRuntimeFailure) => {
    task.failure = failure
    runtimeFailure = failure
    runtimeStatus = 'failed'
    setPhase(task, 'FAILED')
  }

  const withCommitLock = async <Value>(task: MutableTask, effect: () => Promise<Value>) => {
    const previous = commitTail
    let release = () => {}
    commitTail = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    try {
      if (task.controller?.signal.aborted || activeTask !== task) {
        throw task.controller?.signal.reason ?? new DOMException('Task is no longer active', 'AbortError')
      }
      return await effect()
    } finally {
      release()
    }
  }

  const observeFull = async (task: MutableTask) => {
    const observed = await options.host.observe({
      schemaVersion: 1,
      projectId: binding.projectId,
      branchId: binding.branchId,
      sessionId: task.sessionId,
      taskId: task.taskId,
      mode: 'full',
    })
    if (!Object.hasOwn(observed, 'projection')) {
      throw new WorkerStateMachineError('invalid-model-turn', 'full observation returned a delta')
    }
    task.latestSnapshot = cloneFrozenHostSnapshot(observed)
    if (runtimeStatus === 'recovering') {
      runtimeStatus = 'ready'
      runtimeFailure = undefined
    }
    return task.latestSnapshot
  }

  const observeAfterInvoke = async (task: MutableTask) => {
    const current = task.latestSnapshot
    if (!current?.cursor) return observeFull(task)

    const observed = await options.host.observe({
      schemaVersion: 1,
      projectId: binding.projectId,
      branchId: binding.branchId,
      sessionId: task.sessionId,
      taskId: task.taskId,
      mode: 'delta',
      cursor: current.cursor,
    })
    try {
      task.latestSnapshot =
        'projection' in observed ? cloneFrozenHostSnapshot(observed) : applyHostSnapshotDelta(current, observed)
      return task.latestSnapshot
    } catch {
      return observeFull(task)
    }
  }

  const turnRequest = (task: MutableTask, phase: ModelTurnPhase): ModelTurnRequest => {
    if (!task.latestSnapshot) {
      throw new WorkerStateMachineError('invalid-model-turn', 'model turn requires a full host snapshot')
    }
    return {
      schemaVersion: 1,
      projectId: binding.projectId,
      branchId: binding.branchId,
      sessionId: task.sessionId,
      taskId: task.taskId,
      phase,
      intent: task.intent,
      snapshot: task.latestSnapshot,
      ...(task.response ? { response: task.response } : {}),
      repairAttempts: task.repairAttempts,
    }
  }

  const interpretEvents = (events: readonly ModelEvent[]): TurnOutcome => {
    let complete = false
    let question: AgentQuestion | undefined
    let pauseReason: string | undefined
    let toolCall: SemanticCall | undefined
    for (const event of events) {
      switch (event.kind) {
        case 'complete':
          complete = true
          break
        case 'question':
          if (question) {
            throw new WorkerStateMachineError('invalid-model-turn', 'model turn emitted multiple questions')
          }
          question = event.question
          break
        case 'pause':
          pauseReason = event.reason
          break
        case 'tool-call':
          if (toolCall) {
            throw new WorkerStateMachineError(
              'invalid-model-turn',
              'one model turn may contain only one committing tool call',
            )
          }
          toolCall = event.call
          break
        case 'blueprint':
          break
      }
    }
    if ([question, pauseReason, toolCall].filter(Boolean).length > 1) {
      throw new WorkerStateMachineError(
        'invalid-model-turn',
        'question, pause, and tool-call outcomes are mutually exclusive',
      )
    }
    return { complete, question, pauseReason, toolCall }
  }

  const runTurn = async (task: MutableTask, phase: ModelTurnPhase) => {
    task.nextModelPhase = phase
    const events = await collectModelEvents(
      options.model,
      turnRequest(task, phase),
      task.controller?.signal ?? new AbortController().signal,
    )
    return interpretEvents(events)
  }

  const assertCallContext = (task: MutableTask, call: SemanticCall) => {
    if (
      call.projectId !== binding.projectId ||
      call.branchId !== binding.branchId ||
      call.sessionId !== task.sessionId ||
      call.taskId !== task.taskId
    ) {
      throw new WorkerStateMachineError(
        'invalid-tool-call-context',
        'tool call does not belong to the active runtime binding and task',
      )
    }
  }

  const executeAndVerify = async (task: MutableTask, call: SemanticCall): Promise<boolean> => {
    assertCallContext(task, call)
    if (call.expectedRevision !== task.latestSnapshot?.revision) return false

    return withCommitLock(task, async () => {
      setPhase(task, 'EXECUTE')
      let result = await options.host.invoke(call)
      if (task.controller?.signal.aborted || activeTask !== task) return false

      if (result.status === 'indeterminate') {
        setPhase(task, 'QUERY_RECEIPT')
        const receipt = await options.host.queryReceipt({
          projectId: binding.projectId,
          branchId: binding.branchId,
          callId: call.callId,
        })
        if (!receipt || receipt.status !== 'applied') return false
        result = {
          schemaVersion: 1,
          callId: receipt.callId,
          status: 'applied',
          ...(receipt.revision ? { revision: receipt.revision } : {}),
        }
      }
      if (result.status !== 'applied') return false

      setPhase(task, 'VERIFY')
      const observed = await observeAfterInvoke(task)
      return result.revision === undefined || result.revision === observed.revision
    })
  }

  const persistTask = async (task: MutableTask, persistedPhase: AgentPhase) => {
    const batchId = options.idFactory.next('batch')
    const result = await options.persistence.commit({
      schemaVersion: 1,
      projectId: binding.projectId,
      branchId: binding.branchId,
      sessionId: task.sessionId,
      batchId,
      expectedDraftGeneration: draftGeneration,
      records: [
        {
          recordId: `task:${task.taskId}`,
          kind: 'agent-runtime-task',
          value: toRecordValue(task, persistedPhase),
        },
      ],
    })
    if (result.status === 'committed') {
      draftGeneration = result.draftGeneration
      return true
    }
    task.failure = result.failure ?? {
      code: result.status,
      message: `persistence commit ${result.status}`,
      retryable: result.status === 'generation-conflict',
    }
    return false
  }

  const completeTask = async (task: MutableTask) => {
    setPhase(task, 'CHECKPOINT')
    if (!(await persistTask(task, 'COMPLETED'))) {
      setPhase(task, 'PAUSED')
      return
    }
    setPhase(task, 'COMPLETED')
  }

  const drive = async (task: MutableTask, mode: 'fresh' | 'resume' | 'respond' | 'recover') => {
    if (mode === 'recover') setPhase(task, 'RECOVERING')
    setPhase(task, 'OBSERVE')
    await observeFull(task)

    if (mode === 'fresh' || task.nextModelPhase === 'BLUEPRINT') {
      setPhase(task, 'BLUEPRINT')
      const blueprint = await runTurn(task, 'BLUEPRINT')
      if (blueprint.question) {
        task.question = blueprint.question
        setPhase(task, 'WAITING_USER')
        return
      }
      if (blueprint.pauseReason) {
        task.failure = { code: 'model-paused', message: blueprint.pauseReason, retryable: true }
        setPhase(task, 'PAUSED')
        return
      }
      if (blueprint.toolCall) {
        throw new WorkerStateMachineError('invalid-model-turn', 'blueprint turn cannot execute a tool call')
      }
    }

    let phase: ModelTurnPhase = 'PLAN_STEP'
    if (mode !== 'fresh' && task.nextModelPhase === 'REPAIR') phase = 'REPAIR'
    while (!disposed && activeTask === task && !task.controller?.signal.aborted) {
      setPhase(task, phase)
      const outcome = await runTurn(task, phase)
      if (outcome.question) {
        task.question = outcome.question
        task.response = undefined
        setPhase(task, 'WAITING_USER')
        return
      }
      if (outcome.pauseReason) {
        task.failure = { code: 'model-paused', message: outcome.pauseReason, retryable: true }
        setPhase(task, 'PAUSED')
        return
      }
      if (!outcome.toolCall) {
        if (!outcome.complete) {
          throw new WorkerStateMachineError(
            'invalid-model-turn',
            `${phase} turn produced neither a tool call nor completion`,
          )
        }
        await completeTask(task)
        return
      }

      const applied = await executeAndVerify(task, outcome.toolCall)
      if (applied) {
        if (outcome.complete) {
          await completeTask(task)
          return
        }
        phase = 'PLAN_STEP'
        continue
      }

      if (task.repairAttempts >= repairBudget) {
        task.failure = {
          code: 'repair-budget-exhausted',
          message: `repair budget ${repairBudget} exhausted`,
          retryable: true,
        }
        setPhase(task, 'PAUSED')
        return
      }
      task.repairAttempts += 1
      phase = 'REPAIR'
    }
  }

  const startRun = (task: MutableTask, mode: 'fresh' | 'resume' | 'respond' | 'recover') => {
    const run = drive(task, mode)
      .catch(error => {
        if (task.phase === 'PAUSED' || task.phase === 'CANCELLED' || disposed) return
        if (isAbortError(error) || task.controller?.signal.aborted) return
        setFailure(
          task,
          failureFrom(error instanceof WorkerStateMachineError ? error.code : 'worker-task-failed', error),
        )
      })
      .finally(() => {
        runs.delete(run)
        if (task.run === run) task.run = undefined
      })
    task.run = run
    runs.add(run)
  }

  const waitForTask = async (task: MutableTask) => {
    if (task.run) await task.run
  }

  const api: WorkerStateMachine = {
    async submit(input) {
      assertUsable()
      runtimeStatus = 'ready'
      runtimeFailure = undefined
      const previous = activeTask
      const supersedesPrevious = previous !== undefined && !terminalPhases.has(previous.phase)
      if (supersedesPrevious) {
        previous.controller?.abort(new DOMException('Task superseded', 'AbortError'))
        setPhase(previous, 'CANCELLED')
      }
      const now = options.clock.now()
      const task: MutableTask = {
        taskId: options.idFactory.next('task'),
        sessionId,
        phase: 'IDLE',
        createdAt: now,
        updatedAt: now,
        repairAttempts: 0,
        intent: cloneFrozen(input),
        controller: new AbortController(),
        nextModelPhase: 'PLAN_STEP',
        ...(previous ? { parentTaskId: previous.taskId } : {}),
        ...(supersedesPrevious ? { supersedesTaskId: previous.taskId } : {}),
      }
      tasks.set(task.taskId, task)
      activeTask = task
      emit()
      startRun(task, 'fresh')
      return taskRef(task)
    },

    async pause(taskId) {
      assertUsable()
      const task = findTask(taskId)
      if (terminalPhases.has(task.phase) || task.phase === 'PAUSED') {
        throw new WorkerStateMachineError('invalid-task-phase', `cannot pause task in ${task.phase}`)
      }
      task.controller?.abort(new DOMException('Task paused', 'AbortError'))
      setPhase(task, 'PAUSED')
      await waitForTask(task)
    },

    async resume(taskId) {
      assertUsable()
      const task = findTask(taskId)
      if (task.phase !== 'PAUSED') {
        throw new WorkerStateMachineError('invalid-task-phase', `cannot resume task in ${task.phase}`)
      }
      await waitForTask(task)
      task.failure = undefined
      task.controller = new AbortController()
      activeTask = task
      startRun(task, 'resume')
    },

    async cancel(taskId) {
      assertUsable()
      const task = findTask(taskId)
      if (terminalPhases.has(task.phase)) return
      task.controller?.abort(new DOMException('Task cancelled', 'AbortError'))
      setPhase(task, 'CANCELLED')
      await waitForTask(task)
    },

    async respond(taskId, response) {
      assertUsable()
      const task = findTask(taskId)
      if (task.phase !== 'WAITING_USER') {
        throw new WorkerStateMachineError('invalid-task-phase', `cannot respond to task in ${task.phase}`)
      }
      if (task.question?.questionId !== response.questionId) {
        throw new WorkerStateMachineError('invalid-task-phase', 'response does not match the pending question')
      }
      task.question = undefined
      task.response = cloneFrozen(response)
      task.controller = new AbortController()
      activeTask = task
      startRun(task, 'respond')
    },

    async recover() {
      assertUsable()
      const result = await options.persistence.read({
        schemaVersion: 1,
        projectId: binding.projectId,
        branchId: binding.branchId,
        sessionId,
        expectedDraftGeneration: draftGeneration,
      })
      draftGeneration = result.draftGeneration
      const record = [...result.records].reverse().find(entry => entry.kind === 'agent-runtime-task')
      const recovered = record ? parseRecoveredTask(record.value) : undefined
      if (!recovered) return
      tasks.set(recovered.taskId, recovered)
      activeTask = recovered
      if (terminalPhases.has(recovered.phase)) {
        emit()
        return
      }
      runtimeStatus = 'recovering'
      recovered.controller = new AbortController()
      startRun(recovered, 'recover')
    },

    getSnapshot() {
      return currentSnapshot
    },

    subscribe(listener) {
      assertUsable()
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async waitForIdle() {
      while (runs.size > 0) await Promise.allSettled([...runs])
    },

    async dispose() {
      if (disposed) return
      disposed = true
      for (const task of tasks.values()) task.controller?.abort(new DOMException('Worker disposed', 'AbortError'))
      await Promise.allSettled([...runs])
      if (activeTask && !terminalPhases.has(activeTask.phase)) await persistTask(activeTask, activeTask.phase)
      listeners.clear()
      runtimeStatus = 'disposed'
      emit()
    },
  }

  return api
}
