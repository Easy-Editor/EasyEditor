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
  HostInvocationContextV1,
  HostSnapshot,
  IdFactory,
  InvocationResult,
  JsonObject,
  ModelAdapter,
  ModelEvent,
  ModelTurnPhase,
  ModelTurnRequest,
  PersistenceCommitResult,
  RuntimeTaskCompensationTargetV1,
  SemanticCall,
  TaskRef,
  UserIntent,
  UserResponse,
} from '../../contracts.js'
import { collectModelEvents } from '../model/index.js'
import { assertExactFields, assertJsonValue } from '../protocol/index.js'
import { applyHostSnapshotDelta, cloneFrozenHostSnapshot } from '../snapshot/index.js'

type RuntimeTaskCallIndexEntryV1 = RuntimeTaskCompensationTargetV1['callIndex'][number]
type ModelToolCallProposal = Extract<ModelEvent, { readonly kind: 'tool-call' }>['call']

export type WorkerStateMachineErrorCode =
  | 'disposed'
  | 'invalid-task-phase'
  | 'missing-task'
  | 'invalid-model-turn'
  | 'invalid-tool-call-context'
  | 'persistence-failed'

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
  controlPersistence?: Promise<void>
  controlPersistenceFailure?: AgentRuntimeFailure
  pendingCancellationKind?: 'explicit' | 'supersede'
  pendingControlPhase?: 'PAUSED' | 'CANCELLED'
  lastDurablePhase?: AgentPhase
  nextModelPhase: ModelTurnPhase
  pendingInvocation?: PendingInvocationV1
  pendingInvocationDurable: boolean
  callIds: string[]
  callIndex: RuntimeTaskCallIndexEntryV1[]
  callIndexComplete: boolean
  consecutiveYields: number
}

interface PendingInvocationV1 {
  readonly schemaVersion: 1
  readonly state: 'invoked'
  readonly completeAfterTool: boolean
  readonly call: SemanticCall
}

type ExecutionDisposition = 'satisfied' | 'completed' | 'repair' | 'repair-durable' | 'yielded' | 'paused'

interface TurnOutcome {
  readonly complete: boolean
  readonly question?: AgentQuestion
  readonly pauseReason?: string
  readonly toolCall?: ModelToolCallProposal
}

const terminalPhases = new Set<AgentPhase>(['COMPLETED', 'CANCELLED', 'FAILED'])
const compensationTargetPhases = new Set<AgentPhase>(['COMPLETED', 'CANCELLED'])
const MAX_RUNTIME_ID_LENGTH = 96
const MAX_SCOPED_ID_LENGTH = 256
const agentPhases = new Set<AgentPhase>([
  'IDLE',
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
  'COMPLETED',
  'CANCELLED',
  'FAILED',
])

const isAbortError = (error: unknown) =>
  error instanceof DOMException ? error.name === 'AbortError' : error instanceof Error && error.name === 'AbortError'

const failureFrom = (code: string, error: unknown, retryable = false): AgentRuntimeFailure => ({
  code,
  message: error instanceof Error ? error.message : String(error),
  retryable,
})

const retryablePersistenceErrorCodes = new Set([
  'generation-conflict',
  'storage-unavailable',
  'database-blocked',
  'quota-exceeded',
  'transaction-aborted',
])

const retryablePersistenceFailureFrom = (error: unknown): AgentRuntimeFailure | undefined => {
  if (!isRecord(error) || typeof error.code !== 'string' || !retryablePersistenceErrorCodes.has(error.code)) {
    return undefined
  }
  return failureFrom(error.code, error, true)
}

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

const parseRecoveredSemanticCall = (value: unknown, taskId: string, sessionId: string): SemanticCall | undefined => {
  if (!isRecord(value) || !isRecord(value.arguments)) return undefined
  const stringFields = [
    'projectId',
    'branchId',
    'sessionId',
    'taskId',
    'stepId',
    'callId',
    'capability',
    'expectedRevision',
  ]
  if (value.schemaVersion !== 1 || stringFields.some(field => typeof value[field] !== 'string' || !value[field])) {
    return undefined
  }
  if (value.taskId !== taskId || value.sessionId !== sessionId) return undefined
  return cloneFrozen(value as unknown as SemanticCall)
}

const parseRecoveredPendingInvocation = (
  value: unknown,
  taskId: string,
  sessionId: string,
): PendingInvocationV1 | undefined => {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.state !== 'invoked') return undefined
  if (typeof value.completeAfterTool !== 'boolean') return undefined
  const call = parseRecoveredSemanticCall(value.call, taskId, sessionId)
  if (!call) return undefined
  return cloneFrozen({ schemaVersion: 1, state: 'invoked', completeAfterTool: value.completeAfterTool, call })
}

interface RecoveredCallIndex {
  readonly entries: RuntimeTaskCallIndexEntryV1[]
  readonly provided: boolean
}

const parseRecoveredCallIndex = (value: unknown): RecoveredCallIndex | undefined => {
  if (value === undefined) return { entries: [], provided: false }
  if (!Array.isArray(value)) return undefined
  const callIds = new Set<string>()
  const entries: RuntimeTaskCallIndexEntryV1[] = []
  for (const entry of value) {
    if (!isRecord(entry) || Object.keys(entry).length !== 2) return undefined
    const { callId, capability } = entry
    if (
      typeof callId !== 'string' ||
      callId.length === 0 ||
      typeof capability !== 'string' ||
      capability.length === 0 ||
      callIds.has(callId)
    ) {
      return undefined
    }
    callIds.add(callId)
    entries.push({ callId, capability })
  }
  return { entries, provided: true }
}

const parseRecoveredTask = (value: unknown, expectedSessionId: string): MutableTask | undefined => {
  if (!isRecord(value) || !isRecord(value.intent)) return undefined
  const { taskId, sessionId, phase, createdAt, updatedAt, repairAttempts } = value
  if (
    typeof taskId !== 'string' ||
    typeof sessionId !== 'string' ||
    typeof phase !== 'string' ||
    !agentPhases.has(phase as AgentPhase) ||
    typeof createdAt !== 'number' ||
    typeof updatedAt !== 'number' ||
    typeof repairAttempts !== 'number' ||
    typeof value.intent.text !== 'string' ||
    sessionId !== expectedSessionId
  ) {
    return undefined
  }
  const callIdsValue = value.callIds
  const callIdsProvided = callIdsValue !== undefined
  const callIds =
    callIdsValue === undefined
      ? []
      : Array.isArray(callIdsValue) &&
          callIdsValue.every(callId => typeof callId === 'string' && callId.length > 0) &&
          new Set(callIdsValue).size === callIdsValue.length
        ? [...callIdsValue]
        : undefined
  if (!callIds) return undefined
  const recoveredCallIndex = parseRecoveredCallIndex(value.callIndex)
  if (!recoveredCallIndex) return undefined
  const callIndex = recoveredCallIndex.entries
  const consecutiveYieldsValue = value.consecutiveYields
  const consecutiveYields = consecutiveYieldsValue === undefined ? 0 : consecutiveYieldsValue
  if (typeof consecutiveYields !== 'number' || !Number.isSafeInteger(consecutiveYields) || consecutiveYields < 0) {
    return undefined
  }
  let failure: AgentRuntimeFailure | undefined
  if (value.failure !== undefined) {
    try {
      assertExactFields(value.failure, ['code', 'message', 'retryable'], ['details'], 'persisted task failure')
      if (
        typeof value.failure.code !== 'string' ||
        value.failure.code.length === 0 ||
        typeof value.failure.message !== 'string' ||
        value.failure.message.length === 0 ||
        typeof value.failure.retryable !== 'boolean'
      ) {
        return undefined
      }
      if (value.failure.details !== undefined) {
        assertJsonValue(value.failure.details, 'persisted task failure.details')
        if (
          typeof value.failure.details !== 'object' ||
          value.failure.details === null ||
          Array.isArray(value.failure.details)
        ) {
          return undefined
        }
      }
      failure = cloneFrozen(value.failure as unknown as AgentRuntimeFailure)
    } catch {
      return undefined
    }
  }
  const pendingInvocation =
    value.pendingInvocation === undefined
      ? undefined
      : parseRecoveredPendingInvocation(value.pendingInvocation, taskId, sessionId)
  if (value.pendingInvocation !== undefined && !pendingInvocation) return undefined
  const pendingCallIdWasIndexed = !pendingInvocation || callIds.includes(pendingInvocation.call.callId)
  const pendingCallIndexEntry = pendingInvocation
    ? callIndex.find(entry => entry.callId === pendingInvocation.call.callId)
    : undefined
  if (
    pendingInvocation &&
    pendingCallIndexEntry &&
    pendingCallIndexEntry.capability !== pendingInvocation.call.capability
  ) {
    return undefined
  }
  const pendingCapabilityWasIndexed = !pendingInvocation || pendingCallIndexEntry !== undefined
  if (pendingInvocation && !pendingCallIdWasIndexed) callIds.push(pendingInvocation.call.callId)
  if (pendingInvocation && !pendingCallIndexEntry) {
    callIndex.push({ callId: pendingInvocation.call.callId, capability: pendingInvocation.call.capability })
  }
  const knownCallIds = new Set(callIds)
  if (callIndex.some(entry => !knownCallIds.has(entry.callId))) return undefined
  if (value.callIndexComplete !== undefined && typeof value.callIndexComplete !== 'boolean') return undefined
  const indexesAlign =
    callIdsProvided &&
    recoveredCallIndex.provided &&
    callIndex.length === callIds.length &&
    callIndex.every((entry, index) => entry.callId === callIds[index])
  if (value.callIndexComplete === true && !indexesAlign) return undefined
  const callIndexComplete = value.callIndexComplete === true && indexesAlign
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
    lastDurablePhase: phase as AgentPhase,
    nextModelPhase: phase === 'REPAIR' ? 'REPAIR' : 'PLAN_STEP',
    callIds,
    callIndex,
    callIndexComplete,
    consecutiveYields,
    ...(failure ? { failure } : {}),
    pendingInvocationDurable: pendingInvocation !== undefined && pendingCallIdWasIndexed && pendingCapabilityWasIndexed,
    ...(pendingInvocation ? { pendingInvocation } : {}),
  }
}

const isLaterRecoveredTask = (candidate: MutableTask, selected: MutableTask) =>
  candidate.updatedAt > selected.updatedAt ||
  (candidate.updatedAt === selected.updatedAt && candidate.createdAt > selected.createdAt) ||
  (candidate.updatedAt === selected.updatedAt &&
    candidate.createdAt === selected.createdAt &&
    candidate.taskId > selected.taskId)

const recoverTasks = (
  records: readonly { readonly recordId: string; readonly kind: string; readonly value: unknown }[],
  sessionId: string,
) => {
  const recovered = new Map<string, MutableTask>()
  for (const record of records) {
    if (record.kind !== 'agent-runtime-task') continue
    const candidate = parseRecoveredTask(record.value, sessionId)
    if (!candidate || record.recordId !== `task:${candidate.taskId}`) continue
    const prior = recovered.get(candidate.taskId)
    if (!prior || isLaterRecoveredTask(candidate, prior)) recovered.set(candidate.taskId, candidate)
  }
  return [...recovered.values()]
}

const selectLatestRecoveredTask = (tasks: readonly MutableTask[]) => {
  const nonterminal = tasks.filter(task => !terminalPhases.has(task.phase))
  const candidates = nonterminal.length > 0 ? nonterminal : tasks
  let selected: MutableTask | undefined
  for (const candidate of candidates) {
    if (!selected || isLaterRecoveredTask(candidate, selected)) selected = candidate
  }
  return selected
}

const assertUniqueSessionCallIds = (tasks: readonly MutableTask[]) => {
  const owners = new Map<string, string>()
  for (const task of tasks) {
    for (const callId of task.callIds) {
      const owner = owners.get(callId)
      if (owner && owner !== task.taskId) {
        throw new WorkerStateMachineError(
          'invalid-tool-call-context',
          `callId ${callId} is persisted by multiple tasks in session ${task.sessionId}`,
        )
      }
      owners.set(callId, task.taskId)
    }
  }
}

const toRecordValue = (task: MutableTask, persistedPhase: AgentPhase): JsonObject => ({
  taskId: task.taskId,
  sessionId: task.sessionId,
  phase: persistedPhase,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  repairAttempts: task.repairAttempts,
  consecutiveYields: task.consecutiveYields,
  callIds: task.callIds,
  callIndex: task.callIndex.map(entry => ({ callId: entry.callId, capability: entry.capability })),
  callIndexComplete: task.callIndexComplete,
  ...(task.failure ? { failure: task.failure as unknown as JsonObject } : {}),
  intent: {
    text: task.intent.text,
    ...(task.intent.metadata ? { metadata: task.intent.metadata } : {}),
  },
  ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
  ...(task.supersedesTaskId ? { supersedesTaskId: task.supersedesTaskId } : {}),
  ...(task.pendingInvocation ? { pendingInvocation: task.pendingInvocation as unknown as JsonObject } : {}),
})

export const createWorkerStateMachine = (options: WorkerStateMachineOptions): WorkerStateMachine => {
  const sessionId = options.binding.sessionId ?? options.idFactory.next('session')
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > MAX_RUNTIME_ID_LENGTH) {
    throw new WorkerStateMachineError(
      'invalid-tool-call-context',
      `runtime sessionId must contain 1-${MAX_RUNTIME_ID_LENGTH} characters`,
    )
  }
  const binding = cloneFrozen({ ...options.binding, sessionId })
  const listeners = new Set<(snapshot: AgentRuntimeSnapshot) => void>()
  const tasks = new Map<string, MutableTask>()
  const runs = new Set<Promise<void>>()
  const repairBudget = options.repairBudget ?? 2
  let activeTask: MutableTask | undefined
  let currentSnapshot: AgentRuntimeSnapshot
  let disposed = false
  let disposeComplete = false
  let disposePromise: Promise<void> | undefined
  let revision = 0
  let runtimeStatus: AgentRuntimeStatus = 'ready'
  let runtimeFailure: AgentRuntimeFailure | undefined
  let persistenceGeneration = 0
  let commitTail = Promise.resolve()
  let persistenceTail = Promise.resolve()

  const sessionCallIds = () => {
    const callIds = new Set<string>()
    for (const task of tasks.values()) {
      for (const callId of task.callIds) callIds.add(callId)
    }
    return callIds
  }

  const nextRuntimeId = (kind: 'task' | 'step' | 'call' | 'batch') => {
    const value = options.idFactory.next(kind)
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_RUNTIME_ID_LENGTH) {
      throw new WorkerStateMachineError(
        'invalid-tool-call-context',
        `idFactory must return a ${kind} id containing 1-${MAX_RUNTIME_ID_LENGTH} characters`,
      )
    }
    return value
  }

  const scopeRuntimeId = (kind: 'call' | 'batch', scope: string, localId: string) => {
    const value = `${kind}:${scope.length}:${scope}:${localId}`
    if (value.length > MAX_SCOPED_ID_LENGTH) {
      throw new WorkerStateMachineError(
        'invalid-tool-call-context',
        `${kind} id exceeds the ${MAX_SCOPED_ID_LENGTH}-character host boundary`,
      )
    }
    return value
  }

  const nextUniqueTaskId = () => {
    for (let attempt = 0; attempt <= tasks.size; attempt += 1) {
      const candidate = nextRuntimeId('task')
      if (!tasks.has(candidate)) return candidate
    }
    throw new WorkerStateMachineError(
      'invalid-tool-call-context',
      'idFactory could not allocate a session-unique taskId',
    )
  }

  const nextUniqueCallId = () => {
    const used = sessionCallIds()
    for (let attempt = 0; attempt <= used.size; attempt += 1) {
      const candidate = scopeRuntimeId('call', sessionId, nextRuntimeId('call'))
      if (!used.has(candidate)) return candidate
    }
    throw new WorkerStateMachineError(
      'invalid-tool-call-context',
      'idFactory could not allocate a session-unique callId',
    )
  }

  const nextBatchId = (task: MutableTask, persistedPhase: AgentPhase) => {
    const scope = `${persistenceGeneration}:${task.taskId}:${persistedPhase}`
    return scopeRuntimeId('batch', scope, nextRuntimeId('batch'))
  }

  const createRuntimeOwnedCall = (task: MutableTask, proposal: ModelToolCallProposal): SemanticCall =>
    cloneFrozen({
      schemaVersion: 1,
      projectId: binding.projectId,
      branchId: binding.branchId,
      sessionId: task.sessionId,
      taskId: task.taskId,
      stepId: nextRuntimeId('step'),
      callId: nextUniqueCallId(),
      capability: proposal.capability,
      arguments: proposal.arguments,
      expectedRevision: proposal.expectedRevision,
    })

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
    let toolCall: ModelToolCallProposal | undefined
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

  const compensationTargetId = (call: SemanticCall): string | undefined => {
    if (call.capability !== 'task.compensate') return undefined
    const fields = Object.keys(call.arguments)
    if (
      fields.length !== 2 ||
      !Object.hasOwn(call.arguments, 'schemaVersion') ||
      !Object.hasOwn(call.arguments, 'targetTaskId') ||
      call.arguments.schemaVersion !== 1 ||
      typeof call.arguments.targetTaskId !== 'string' ||
      call.arguments.targetTaskId.length === 0
    ) {
      return undefined
    }
    return call.arguments.targetTaskId
  }

  const hostInvocationContext = (task: MutableTask, call: SemanticCall): HostInvocationContextV1 => {
    if (call.capability !== 'task.compensate') return cloneFrozen({ schemaVersion: 1 })
    const targetTaskId = compensationTargetId(call)
    if (!targetTaskId) {
      throw new WorkerStateMachineError(
        'invalid-model-turn',
        'task.compensate requires exact {schemaVersion: 1, targetTaskId} arguments',
      )
    }
    const target = tasks.get(targetTaskId)
    if (
      !target ||
      target === task ||
      target.sessionId !== task.sessionId ||
      !compensationTargetPhases.has(target.phase) ||
      !target.callIndexComplete ||
      target.callIndex.some(entry => entry.capability === 'task.compensate')
    ) {
      throw new WorkerStateMachineError(
        'invalid-model-turn',
        'task.compensate target is unknown, ineligible, foreign, current, incomplete, or nested',
      )
    }
    const compensationTarget: RuntimeTaskCompensationTargetV1 = {
      schemaVersion: 1,
      taskId: target.taskId,
      sessionId: target.sessionId,
      phase: target.phase as 'COMPLETED' | 'CANCELLED',
      callIndexComplete: true,
      callIndex: target.callIndex.map(entry => ({ callId: entry.callId, capability: entry.capability })),
    }
    return cloneFrozen({ schemaVersion: 1, compensationTarget })
  }

  const failureCode = (value: { readonly failure?: AgentRuntimeFailure }) => value.failure?.code

  const isResumeSafeCompensation = (call: SemanticCall, value: { readonly failure?: AgentRuntimeFailure }) =>
    call.capability === 'task.compensate' &&
    value.failure?.code === 'COMPENSATION_IN_PROGRESS' &&
    value.failure.details?.resumeSafe === true

  const invocationFromReceipt = (receipt: Awaited<ReturnType<AgentHost['queryReceipt']>>): InvocationResult | null => {
    if (!receipt) return null
    const base = {
      schemaVersion: 1 as const,
      callId: receipt.callId,
      ...(receipt.revision ? { revision: receipt.revision } : {}),
    }
    return receipt.status === 'applied'
      ? { ...base, status: 'applied' }
      : { ...base, status: receipt.status, failure: receipt.failure }
  }

  const queryInvocationReceipt = async (task: MutableTask, call: SemanticCall) => {
    setPhase(task, 'QUERY_RECEIPT')
    const receipt = await options.host.queryReceipt({
      projectId: binding.projectId,
      branchId: binding.branchId,
      callId: call.callId,
    })
    if (
      receipt &&
      (receipt.projectId !== binding.projectId ||
        receipt.branchId !== binding.branchId ||
        receipt.callId !== call.callId)
    ) {
      throw new WorkerStateMachineError(
        'invalid-tool-call-context',
        'tool receipt does not belong to the active runtime binding and call',
      )
    }
    return receipt
  }

  const invokeWithReceiptRecovery = async (
    task: MutableTask,
    call: SemanticCall,
    context: HostInvocationContextV1,
    allowSafeResume = true,
  ) => {
    let result: InvocationResult
    let invokeThrew = false
    try {
      result = await options.host.invoke(call, context)
    } catch (error) {
      invokeThrew = true
      result = {
        schemaVersion: 1 as const,
        callId: call.callId,
        status: 'indeterminate' as const,
        failure: failureFrom('host-invoke-failed', error, true),
      }
    }
    if (result.status !== 'indeterminate') return result

    const receipt = await queryInvocationReceipt(task, call)
    const recovered = invocationFromReceipt(receipt)
    if (recovered && recovered.status !== 'indeterminate') return recovered
    const safeToResume =
      (invokeThrew && receipt === null) || (recovered !== null && isResumeSafeCompensation(call, recovered))
    if (allowSafeResume && safeToResume) {
      setPhase(task, 'EXECUTE')
      return invokeWithReceiptRecovery(task, call, context, false)
    }
    return recovered ?? result
  }

  const pauseIndeterminateInvocation = async (
    task: MutableTask,
    result: { readonly failure?: AgentRuntimeFailure },
  ): Promise<ExecutionDisposition> => {
    await observeFull(task)
    task.failure =
      result.failure ??
      ({
        code: 'indeterminate-tool-result',
        message: 'The tool outcome could not be proven from durable receipt lineage',
        retryable: false,
      } satisfies AgentRuntimeFailure)
    setPhase(task, 'PAUSED')
    await persistTask(task, 'PAUSED')
    return 'paused'
  }

  const clearPendingAndPersist = async (task: MutableTask, phase: AgentPhase) => {
    const pending = task.pendingInvocation
    const pendingWasDurable = task.pendingInvocationDurable
    task.pendingInvocation = undefined
    task.pendingInvocationDurable = false
    const persisted = await persistTask(task, phase)
    if (persisted) return true
    task.pendingInvocation = pending
    task.pendingInvocationDurable = pendingWasDurable
    setPhase(task, 'PAUSED')
    return false
  }

  const clearPendingAndComplete = async (task: MutableTask): Promise<ExecutionDisposition> => {
    const pending = task.pendingInvocation
    const pendingWasDurable = task.pendingInvocationDurable
    task.pendingInvocation = undefined
    task.pendingInvocationDurable = false
    setPhase(task, 'CHECKPOINT')
    const persisted = await persistTask(task, 'COMPLETED')
    if (persisted) {
      setPhase(task, 'COMPLETED')
      return 'completed'
    }
    task.pendingInvocation = pending
    task.pendingInvocationDurable = pendingWasDurable
    setPhase(task, 'PAUSED')
    return 'paused'
  }

  const persistRepairTransition = async (
    task: MutableTask,
    options: { readonly clearPendingInvocation: boolean },
  ): Promise<ExecutionDisposition> => {
    const persist = async (phase: 'REPAIR' | 'PAUSED') => {
      setPhase(task, phase)
      if (options.clearPendingInvocation) return clearPendingAndPersist(task, phase)
      const persisted = await persistTask(task, phase)
      if (!persisted) setPhase(task, 'PAUSED')
      return persisted
    }

    if (task.repairAttempts >= repairBudget) {
      task.failure = {
        code: 'repair-budget-exhausted',
        message: `repair budget ${repairBudget} exhausted`,
        retryable: true,
      }
      await persist('PAUSED')
      return 'paused'
    }

    task.repairAttempts += 1
    return (await persist('REPAIR')) ? 'repair-durable' : 'paused'
  }

  const handleInvocationResult = async (
    task: MutableTask,
    call: SemanticCall,
    result: Awaited<ReturnType<AgentHost['invoke']>>,
    completeAfterTool: boolean,
  ): Promise<ExecutionDisposition> => {
    if (task.controller?.signal.aborted || activeTask !== task) return 'paused'
    if (result.callId !== call.callId) {
      throw new WorkerStateMachineError('invalid-tool-call-context', 'tool result callId does not match the request')
    }

    const code = failureCode(result)
    const satisfied = result.status === 'applied' || (result.status === 'not-applied' && code === 'NO_CHANGE')
    if (satisfied) {
      task.failure = undefined
      task.consecutiveYields = 0
      setPhase(task, 'VERIFY')
      const observed = await observeAfterInvoke(task)
      const verified = result.revision === undefined || result.revision === observed.revision
      if (verified && completeAfterTool) return clearPendingAndComplete(task)
      if (verified) {
        if (!(await clearPendingAndPersist(task, 'VERIFY'))) return 'paused'
        return 'satisfied'
      }
      return persistRepairTransition(task, { clearPendingInvocation: true })
    }

    if (result.status === 'not-applied' && (code === 'STALE_REVISION' || code === 'HUMAN_ACTIVITY')) {
      task.consecutiveYields += 1
      if (task.consecutiveYields > 1) {
        task.failure = {
          code: 'human-priority-yield-limit',
          message: 'The Agent yielded twice without a successful intervening commit',
          retryable: true,
        }
        setPhase(task, 'PAUSED')
        await clearPendingAndPersist(task, 'PAUSED')
        return 'paused'
      }
      setPhase(task, 'YIELDED')
      await observeFull(task)
      if (!(await clearPendingAndPersist(task, 'YIELDED'))) return 'paused'
      return 'yielded'
    }

    if (result.status === 'indeterminate') return pauseIndeterminateInvocation(task, result)

    task.failure = result.failure
    return persistRepairTransition(task, { clearPendingInvocation: true })
  }

  const persistPendingInvocation = async (task: MutableTask, call: SemanticCall, completeAfterTool: boolean) => {
    const priorOwner = [...tasks.values()].find(candidate => candidate.callIds.includes(call.callId))
    if (priorOwner) {
      throw new WorkerStateMachineError(
        'invalid-model-turn',
        `callId ${call.callId} has already been used by task ${priorOwner.taskId}`,
      )
    }
    task.pendingInvocation = cloneFrozen({ schemaVersion: 1, state: 'invoked', completeAfterTool, call })
    task.pendingInvocationDurable = false
    task.callIds.push(call.callId)
    task.callIndex.push({ callId: call.callId, capability: call.capability })
    if (task.callIndexComplete) {
      task.callIndexComplete =
        task.callIndex.length === task.callIds.length &&
        task.callIndex.every((entry, index) => entry.callId === task.callIds[index])
    }
    setPhase(task, 'EXECUTE')
    const persisted = await persistTask(task, 'EXECUTE')
    if (persisted) return true
    setPhase(task, 'PAUSED')
    return false
  }

  const executeAndVerify = async (
    task: MutableTask,
    call: SemanticCall,
    completeAfterTool: boolean,
  ): Promise<ExecutionDisposition> => {
    assertCallContext(task, call)
    if (call.expectedRevision !== task.latestSnapshot?.revision) return 'repair'
    const context = hostInvocationContext(task, call)

    return withCommitLock(task, async () => {
      if (!(await persistPendingInvocation(task, call, completeAfterTool))) return 'paused'
      if (task.controller?.signal.aborted || activeTask !== task) return 'paused'
      const result = await invokeWithReceiptRecovery(task, call, context)
      return handleInvocationResult(task, call, result, completeAfterTool)
    })
  }

  const recoverPendingInvocation = async (task: MutableTask): Promise<ExecutionDisposition> => {
    const pending = task.pendingInvocation
    if (!pending) return 'repair'
    const call = pending.call
    assertCallContext(task, call)
    const context = hostInvocationContext(task, call)
    return withCommitLock(task, async () => {
      if (!task.pendingInvocationDurable) {
        setPhase(task, 'EXECUTE')
        if (!(await persistTask(task, 'EXECUTE'))) {
          setPhase(task, 'PAUSED')
          return 'paused'
        }
      }
      if (task.controller?.signal.aborted || activeTask !== task) return 'paused'
      const receipt = await queryInvocationReceipt(task, call)
      const recovered = invocationFromReceipt(receipt)
      if (recovered && !isResumeSafeCompensation(call, recovered)) {
        return handleInvocationResult(task, call, recovered, pending.completeAfterTool)
      }
      setPhase(task, 'EXECUTE')
      const result = await invokeWithReceiptRecovery(task, call, context)
      return handleInvocationResult(task, call, result, pending.completeAfterTool)
    })
  }

  const persistTaskNow = async (task: MutableTask, persistedPhase: AgentPhase) => {
    const batchId = nextBatchId(task, persistedPhase)
    const persistedPendingInvocation = task.pendingInvocation !== undefined
    let result: PersistenceCommitResult
    try {
      result = await options.persistence.commit({
        schemaVersion: 1,
        projectId: binding.projectId,
        branchId: binding.branchId,
        sessionId: task.sessionId,
        batchId,
        expectedPersistenceGeneration: persistenceGeneration,
        records: [
          {
            recordId: `task:${task.taskId}`,
            kind: 'agent-runtime-task',
            value: toRecordValue(task, persistedPhase),
          },
        ],
      })
    } catch (error) {
      const failure = retryablePersistenceFailureFrom(error)
      if (!failure) throw error
      task.failure = failure
      return false
    }
    if (result.status === 'committed') {
      persistenceGeneration = result.persistenceGeneration
      task.lastDurablePhase = persistedPhase
      task.pendingInvocationDurable = persistedPendingInvocation
      return true
    }
    persistenceGeneration = Math.max(persistenceGeneration, result.persistenceGeneration)
    if (result.status === 'generation-conflict') {
      try {
        const current = await options.persistence.read({
          schemaVersion: 1,
          projectId: binding.projectId,
          branchId: binding.branchId,
          sessionId: task.sessionId,
          expectedPersistenceGeneration: persistenceGeneration,
        })
        persistenceGeneration = Math.max(persistenceGeneration, current.persistenceGeneration)
      } catch (error) {
        const failure = retryablePersistenceFailureFrom(error)
        if (!failure) throw error
        task.failure = failure
        return false
      }
    }
    task.failure = result.failure ?? {
      code: result.status,
      message: `persistence commit ${result.status}`,
      retryable: result.status === 'generation-conflict',
    }
    return false
  }

  const persistTask = async (task: MutableTask, persistedPhase: AgentPhase) => {
    const previous = persistenceTail
    let release = () => {}
    persistenceTail = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    try {
      return await persistTaskNow(task, persistedPhase)
    } finally {
      release()
    }
  }

  const completeTask = async (task: MutableTask) => {
    setPhase(task, 'CHECKPOINT')
    const persisted = await persistTask(task, 'COMPLETED')
    if (disposed || activeTask !== task || task.controller?.signal.aborted || terminalPhases.has(task.phase)) return
    if (!persisted) {
      setPhase(task, 'PAUSED')
      return
    }
    setPhase(task, 'COMPLETED')
  }

  const consumeDisposition = async (
    task: MutableTask,
    disposition: ExecutionDisposition,
    completeAfterTool: boolean,
  ): Promise<ModelTurnPhase | undefined> => {
    if (disposition === 'paused') return undefined
    if (disposition === 'completed') return undefined
    if (disposition === 'satisfied') {
      if (completeAfterTool) {
        await completeTask(task)
        return undefined
      }
      return 'PLAN_STEP'
    }
    if (disposition === 'yielded') return 'PLAN_STEP'
    if (disposition === 'repair-durable') return 'REPAIR'

    const repair = await persistRepairTransition(task, { clearPendingInvocation: false })
    return repair === 'repair-durable' ? 'REPAIR' : undefined
  }

  const drive = async (task: MutableTask, mode: 'fresh' | 'resume' | 'respond' | 'recover') => {
    if (mode === 'recover') setPhase(task, 'RECOVERING')
    setPhase(task, 'OBSERVE')
    await observeFull(task)

    if (task.pendingInvocation) {
      const pending = task.pendingInvocation
      const disposition = await recoverPendingInvocation(task)
      const nextPhase = await consumeDisposition(task, disposition, pending.completeAfterTool)
      if (!nextPhase) return
      task.nextModelPhase = nextPhase
    }

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

      const call = createRuntimeOwnedCall(task, outcome.toolCall)
      const disposition = await executeAndVerify(task, call, outcome.complete)
      const nextPhase = await consumeDisposition(task, disposition, outcome.complete)
      if (!nextPhase) return
      phase = nextPhase
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

  const persistControlPhase = async (task: MutableTask, phase: 'PAUSED' | 'CANCELLED') => {
    const persisted = await persistTask(task, phase)
    if (task.pendingControlPhase !== phase) return
    if (persisted) {
      task.pendingControlPhase = undefined
      task.pendingCancellationKind = undefined
      const clearedFailure = task.failure === task.controlPersistenceFailure && task.failure !== undefined
      if (clearedFailure) task.failure = undefined
      task.controlPersistenceFailure = undefined
      if (clearedFailure) emit()
      return
    }
    task.controlPersistenceFailure = task.failure
    emit()
    throw new WorkerStateMachineError(
      'persistence-failed',
      task.failure?.message ?? `failed to persist the ${phase.toLowerCase()} task state`,
    )
  }

  const queueControlPersistence = (task: MutableTask) => {
    if (!task.pendingControlPhase) return Promise.resolve()
    if (task.controlPersistence) return task.controlPersistence
    const transition = (async () => {
      await waitForTask(task)
      const phase = task.pendingControlPhase
      if (phase) await persistControlPhase(task, phase)
    })()
    const tracked = transition.finally(() => {
      if (task.controlPersistence === tracked) task.controlPersistence = undefined
    })
    task.controlPersistence = tracked
    return tracked
  }

  const interruptAndPersist = (
    task: MutableTask,
    phase: 'PAUSED' | 'CANCELLED',
    reason: string,
    cancellationKind?: 'explicit' | 'supersede',
  ) => {
    const previous = task.controlPersistence
    task.controller?.abort(new DOMException(reason, 'AbortError'))
    task.pendingControlPhase = phase
    task.pendingCancellationKind = phase === 'CANCELLED' ? cancellationKind : undefined
    setPhase(task, phase)
    if (!previous) return queueControlPersistence(task)

    const transition = (async () => {
      try {
        await previous
      } catch {
        // A newer control phase still has to become durable even if the superseded write failed.
      }
      await waitForTask(task)
      if (task.pendingControlPhase === phase) await persistControlPhase(task, phase)
    })()
    const tracked = transition.finally(() => {
      if (task.controlPersistence === tracked) task.controlPersistence = undefined
    })
    task.controlPersistence = tracked
    return tracked
  }

  const flushControlPersistence = async () => {
    while (true) {
      const pending = [...tasks.values()].filter(task => task.pendingControlPhase)
      if (pending.length === 0) break
      await Promise.all(pending.map(queueControlPersistence))
    }
    await persistenceTail
  }

  const api: WorkerStateMachine = {
    async submit(input) {
      assertUsable()
      runtimeStatus = 'ready'
      runtimeFailure = undefined
      const previous = activeTask
      const pendingCancellation = previous?.phase === 'CANCELLED' && previous.pendingControlPhase === 'CANCELLED'
      const retryingSupersession = pendingCancellation && previous.pendingCancellationKind === 'supersede'
      const supersedesPrevious = previous !== undefined && (!terminalPhases.has(previous.phase) || retryingSupersession)
      if (pendingCancellation) {
        await queueControlPersistence(previous)
      } else if (supersedesPrevious) {
        await interruptAndPersist(previous, 'CANCELLED', 'Task superseded', 'supersede')
      }
      const now = options.clock.now()
      const task: MutableTask = {
        taskId: nextUniqueTaskId(),
        sessionId,
        phase: 'IDLE',
        createdAt: now,
        updatedAt: now,
        repairAttempts: 0,
        consecutiveYields: 0,
        pendingInvocationDurable: false,
        callIds: [],
        callIndex: [],
        callIndexComplete: true,
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
      if (task.phase === 'PAUSED' && task.pendingControlPhase === 'PAUSED') {
        await queueControlPersistence(task)
        return
      }
      if (terminalPhases.has(task.phase) || task.phase === 'PAUSED') {
        throw new WorkerStateMachineError('invalid-task-phase', `cannot pause task in ${task.phase}`)
      }
      await interruptAndPersist(task, 'PAUSED', 'Task paused')
    },

    async resume(taskId) {
      assertUsable()
      const task = findTask(taskId)
      if (task.phase !== 'PAUSED') {
        throw new WorkerStateMachineError('invalid-task-phase', `cannot resume task in ${task.phase}`)
      }
      await queueControlPersistence(task)
      await waitForTask(task)
      task.failure = undefined
      task.controller = new AbortController()
      activeTask = task
      startRun(task, 'resume')
    },

    async cancel(taskId) {
      assertUsable()
      const task = findTask(taskId)
      if (task.phase === 'CANCELLED') {
        await queueControlPersistence(task)
        return
      }
      if (terminalPhases.has(task.phase)) return
      await interruptAndPersist(task, 'CANCELLED', 'Task cancelled', 'explicit')
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
        expectedPersistenceGeneration: persistenceGeneration,
      })
      persistenceGeneration = result.persistenceGeneration
      const recoveredTasks = recoverTasks(result.records, sessionId)
      const mergedTasks = new Map(tasks)
      for (const task of recoveredTasks) mergedTasks.set(task.taskId, task)
      assertUniqueSessionCallIds([...mergedTasks.values()])
      for (const task of recoveredTasks) tasks.set(task.taskId, task)
      const recovered = selectLatestRecoveredTask(recoveredTasks)
      if (!recovered) return
      activeTask = recovered
      if (terminalPhases.has(recovered.phase) || recovered.phase === 'PAUSED' || recovered.phase === 'WAITING_USER') {
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
      await flushControlPersistence()
    },

    async dispose() {
      if (disposeComplete) return
      if (disposePromise) return disposePromise
      disposed = true
      const transition = (async () => {
        for (const task of tasks.values()) task.controller?.abort(new DOMException('Worker disposed', 'AbortError'))
        await Promise.allSettled([...runs])
        await flushControlPersistence()
        if (
          activeTask &&
          !terminalPhases.has(activeTask.phase) &&
          activeTask.lastDurablePhase !== activeTask.phase &&
          !terminalPhases.has(activeTask.lastDurablePhase ?? 'IDLE')
        ) {
          await persistTask(activeTask, activeTask.phase)
        }
        listeners.clear()
        runtimeStatus = 'disposed'
        disposeComplete = true
        emit()
      })()
      disposePromise = transition
      try {
        await transition
      } finally {
        if (!disposeComplete && disposePromise === transition) disposePromise = undefined
      }
    },
  }

  return api
}
