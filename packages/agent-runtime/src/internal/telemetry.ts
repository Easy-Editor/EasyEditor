import type { ModelTurnPhase } from '../contracts.js'

export const WORKER_TELEMETRY_SCHEMA_VERSION = 1 as const

export const workerTelemetryEventTypes = [
  'task.started',
  'task.recovered',
  'task.completed',
  'task.cancelled',
  'task.failed',
  'phase.started',
  'phase.completed',
  'phase.failed',
  'model-request.started',
  'model-request.completed',
  'model-request.failed',
  'tool-call.started',
  'tool-call.completed',
  'tool-call.failed',
  'compensation.started',
  'compensation.completed',
  'compensation.failed',
  'execution.disposition',
  'receipt-recovery.disposition',
  'runtime.terminal',
] as const

export const workerTelemetryPhases = ['BLUEPRINT', 'PLAN_STEP', 'REPAIR', 'COMPENSATION', 'RECOVERY'] as const
export const workerTelemetryExecutionDispositions = ['yielded', 'repair', 'paused'] as const
export const workerTelemetryDispositionReasons = [
  'HUMAN_ACTIVITY',
  'STALE_REVISION',
  'SNAPSHOT_REVISION_MISMATCH',
  'RESULT_REVISION_MISMATCH',
  'TOOL_FAILURE',
  'INDETERMINATE',
  'YIELD_LIMIT',
  'REPAIR_BUDGET_EXHAUSTED',
  'PERSISTENCE_FAILURE',
] as const
export const workerTelemetryReceiptDispositions = [
  'missing',
  'applied',
  'not-applied',
  'rejected',
  'indeterminate',
  'resume-safe-retry',
] as const

export type WorkerTelemetryEventType = (typeof workerTelemetryEventTypes)[number]
export type WorkerTelemetryPhase = (typeof workerTelemetryPhases)[number]
export type WorkerTelemetryExecutionDisposition = (typeof workerTelemetryExecutionDispositions)[number]
export type WorkerTelemetryDispositionReason = (typeof workerTelemetryDispositionReasons)[number]
export type WorkerTelemetryReceiptDisposition = (typeof workerTelemetryReceiptDispositions)[number]
export type WorkerTelemetryStatus = 'started' | 'recovered' | 'completed' | 'failed' | 'cancelled' | 'compensated'

interface WorkerTelemetryBase<EventType extends WorkerTelemetryEventType, Status extends WorkerTelemetryStatus> {
  readonly schemaVersion: typeof WORKER_TELEMETRY_SCHEMA_VERSION
  readonly eventType: EventType
  readonly timestampMs: number
  readonly byteCount?: number
  readonly status: Status
  readonly sessionId: string
  readonly taskId: string
}

type TimedTelemetryEvent<Event> = Event & { readonly durationMs: number }
type FailedTelemetryEvent<Event> = Event & { readonly errorCode: string }

type TaskTelemetryEvent =
  | WorkerTelemetryBase<'task.started', 'started'>
  | WorkerTelemetryBase<'task.recovered', 'recovered'>
  | WorkerTelemetryBase<'task.completed', 'completed'>
  | WorkerTelemetryBase<'task.cancelled', 'cancelled'>
  | FailedTelemetryEvent<WorkerTelemetryBase<'task.failed', 'failed'>>

type PhaseCorrelation = {
  readonly stepId: string
  readonly phase: WorkerTelemetryPhase
}
type PhaseTelemetryEvent =
  | (WorkerTelemetryBase<'phase.started', 'started'> & PhaseCorrelation)
  | TimedTelemetryEvent<WorkerTelemetryBase<'phase.completed', 'completed'> & PhaseCorrelation>
  | FailedTelemetryEvent<TimedTelemetryEvent<WorkerTelemetryBase<'phase.failed', 'failed'> & PhaseCorrelation>>

type ModelRequestCorrelation = {
  readonly stepId: string
  readonly modelRequestId: string
  readonly phase: ModelTurnPhase
  readonly tokenBudget?: number
}
type ModelRequestTelemetryEvent =
  | (WorkerTelemetryBase<'model-request.started', 'started'> & ModelRequestCorrelation)
  | TimedTelemetryEvent<WorkerTelemetryBase<'model-request.completed', 'completed'> & ModelRequestCorrelation>
  | FailedTelemetryEvent<
      TimedTelemetryEvent<WorkerTelemetryBase<'model-request.failed', 'failed'> & ModelRequestCorrelation>
    >

type ToolCallCorrelation = {
  readonly stepId: string
  readonly callId: string
  readonly changeSetId?: string
  readonly artifactId?: string
  readonly artifactRevision?: string
  readonly resultRevision?: string
}
type ToolCallTelemetryEvent =
  | (WorkerTelemetryBase<'tool-call.started', 'started'> & Pick<ToolCallCorrelation, 'stepId' | 'callId'>)
  | TimedTelemetryEvent<WorkerTelemetryBase<'tool-call.completed', 'completed'> & ToolCallCorrelation>
  | FailedTelemetryEvent<TimedTelemetryEvent<WorkerTelemetryBase<'tool-call.failed', 'failed'> & ToolCallCorrelation>>

type CompensationCorrelation = {
  readonly stepId: string
  readonly callId: string
}
type CompensationTelemetryEvent =
  | (WorkerTelemetryBase<'compensation.started', 'started'> & CompensationCorrelation)
  | TimedTelemetryEvent<WorkerTelemetryBase<'compensation.completed', 'compensated'> & CompensationCorrelation>
  | FailedTelemetryEvent<
      TimedTelemetryEvent<WorkerTelemetryBase<'compensation.failed', 'failed'> & CompensationCorrelation>
    >

type ExecutionDispositionTelemetryEvent = WorkerTelemetryBase<'execution.disposition', 'completed'> & {
  readonly stepId: string
  readonly callId: string
  readonly disposition: WorkerTelemetryExecutionDisposition
  readonly reason: WorkerTelemetryDispositionReason
}

type ReceiptRecoveryTelemetryEvent = WorkerTelemetryBase<'receipt-recovery.disposition', 'completed'> & {
  readonly stepId: string
  readonly callId: string
  readonly receiptDisposition: WorkerTelemetryReceiptDisposition
  readonly resultRevision?: string
}

type RuntimeTerminalTelemetryEvent =
  | WorkerTelemetryBase<'runtime.terminal', 'completed' | 'cancelled'>
  | FailedTelemetryEvent<WorkerTelemetryBase<'runtime.terminal', 'failed'>>

export type WorkerTelemetryEvent =
  | TaskTelemetryEvent
  | PhaseTelemetryEvent
  | ModelRequestTelemetryEvent
  | ToolCallTelemetryEvent
  | CompensationTelemetryEvent
  | ExecutionDispositionTelemetryEvent
  | ReceiptRecoveryTelemetryEvent
  | RuntimeTerminalTelemetryEvent

export interface WorkerTelemetrySink {
  emit(event: WorkerTelemetryEvent): void | Promise<void>
}

export interface WorkerTelemetryQuery {
  readonly sessionId?: string
  readonly taskId?: string
  readonly stepId?: string
  readonly callId?: string
  readonly changeSetId?: string
  readonly modelRequestId?: string
  readonly artifactId?: string
  readonly artifactRevision?: string
}

const eventTypes = new Set<string>(workerTelemetryEventTypes)
const phases = new Set<string>(workerTelemetryPhases)
const modelPhases = new Set<string>(['BLUEPRINT', 'PLAN_STEP', 'REPAIR'])
const executionDispositions = new Set<string>(workerTelemetryExecutionDispositions)
const dispositionReasons = new Set<string>(workerTelemetryDispositionReasons)
const receiptDispositions = new Set<string>(workerTelemetryReceiptDispositions)
const statuses = new Set<string>(['started', 'recovered', 'completed', 'failed', 'cancelled', 'compensated'])
const baseKeys = ['schemaVersion', 'eventType', 'timestampMs', 'byteCount', 'status', 'sessionId', 'taskId'] as const
const timedKeys = ['durationMs'] as const
const failedKeys = ['errorCode'] as const
const phaseKeys = ['stepId', 'phase'] as const
const modelKeys = ['stepId', 'modelRequestId', 'phase', 'tokenBudget'] as const
const toolStartKeys = ['stepId', 'callId'] as const
const toolEndKeys = ['stepId', 'callId', 'changeSetId', 'artifactId', 'artifactRevision', 'resultRevision'] as const
const dispositionKeys = ['stepId', 'callId', 'disposition', 'reason'] as const
const receiptKeys = ['stepId', 'callId', 'receiptDisposition', 'resultRevision'] as const
const queryKeys = new Set<string>([
  'sessionId',
  'taskId',
  'stepId',
  'callId',
  'changeSetId',
  'modelRequestId',
  'artifactId',
  'artifactRevision',
])
const unsafeIdentifierCharacter = /[\p{C}\p{Z}]/u

const fail = (): never => {
  throw new TypeError('Worker telemetry event is invalid')
}

const isEnumerableDataRecord = (value: unknown): value is Record<string, unknown> => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false
  }
  const record = value as Record<string, unknown>
  return Reflect.ownKeys(record).every(key => {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
  })
}

const isExactDataRecord = (value: unknown, allowed: ReadonlySet<string>): value is Record<string, unknown> =>
  isEnumerableDataRecord(value) && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.has(key))

const requireIdentifier = (value: unknown, maximumLength = 256): string => {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength ||
    unsafeIdentifierCharacter.test(value)
  ) {
    fail()
  }
  return value as string
}

const optionalIdentifier = (
  record: Record<string, unknown>,
  key: string,
  maximumLength?: number,
): string | undefined => (Object.hasOwn(record, key) ? requireIdentifier(record[key], maximumLength) : undefined)

const optionalCount = (record: Record<string, unknown>, key: string, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Object.hasOwn(record, key)) return undefined
  const value = record[key]
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) fail()
  return value as number
}

const expectedStatus = (eventType: WorkerTelemetryEventType): WorkerTelemetryStatus => {
  if (eventType.endsWith('.started')) return 'started'
  if (eventType === 'task.recovered') return 'recovered'
  if (eventType === 'task.cancelled') return 'cancelled'
  if (eventType === 'compensation.completed') return 'compensated'
  if (eventType.endsWith('.failed')) return 'failed'
  return 'completed'
}

const allowedKeysFor = (eventType: WorkerTelemetryEventType) => {
  const keys: string[] = [...baseKeys]
  if (eventType.startsWith('phase.')) keys.push(...phaseKeys)
  else if (eventType.startsWith('model-request.')) keys.push(...modelKeys)
  else if (eventType === 'tool-call.started') keys.push(...toolStartKeys)
  else if (eventType === 'tool-call.completed' || eventType === 'tool-call.failed') keys.push(...toolEndKeys)
  else if (eventType.startsWith('compensation.')) keys.push(...toolStartKeys)
  else if (eventType === 'execution.disposition') keys.push(...dispositionKeys)
  else if (eventType === 'receipt-recovery.disposition') keys.push(...receiptKeys)
  if (/^(phase|model-request|tool-call|compensation)\.(completed|failed)$/u.test(eventType)) keys.push(...timedKeys)
  if (eventType.endsWith('.failed') || eventType === 'runtime.terminal') keys.push(...failedKeys)
  return new Set<string>(keys)
}

const requireOwn = (record: Record<string, unknown>, ...keys: string[]) => {
  if (keys.some(key => !Object.hasOwn(record, key))) fail()
}

const validateDispositionPair = (
  disposition: WorkerTelemetryExecutionDisposition,
  reason: WorkerTelemetryDispositionReason,
) => {
  const valid =
    (disposition === 'yielded' && (reason === 'HUMAN_ACTIVITY' || reason === 'STALE_REVISION')) ||
    (disposition === 'repair' &&
      (reason === 'SNAPSHOT_REVISION_MISMATCH' ||
        reason === 'RESULT_REVISION_MISMATCH' ||
        reason === 'TOOL_FAILURE')) ||
    (disposition === 'paused' &&
      (reason === 'INDETERMINATE' ||
        reason === 'YIELD_LIMIT' ||
        reason === 'REPAIR_BUDGET_EXHAUSTED' ||
        reason === 'PERSISTENCE_FAILURE'))
  if (!valid) fail()
}

export const createWorkerTelemetryEvent = (input: unknown): WorkerTelemetryEvent => {
  if (!isEnumerableDataRecord(input)) fail()
  const candidate = input as Record<string, unknown>
  if (candidate.schemaVersion !== WORKER_TELEMETRY_SCHEMA_VERSION || !eventTypes.has(candidate.eventType as string)) {
    fail()
  }
  const eventType = candidate.eventType as WorkerTelemetryEventType
  if (!isExactDataRecord(candidate, allowedKeysFor(eventType))) fail()
  requireOwn(candidate, 'schemaVersion', 'eventType', 'timestampMs', 'status', 'sessionId', 'taskId')
  if (!Number.isSafeInteger(candidate.timestampMs) || (candidate.timestampMs as number) < 0) fail()
  if (!statuses.has(candidate.status as string)) fail()
  if (eventType === 'runtime.terminal') {
    if (candidate.status !== 'completed' && candidate.status !== 'cancelled' && candidate.status !== 'failed') fail()
  } else if (candidate.status !== expectedStatus(eventType)) {
    fail()
  }

  const failed = eventType.endsWith('.failed') || (eventType === 'runtime.terminal' && candidate.status === 'failed')
  if (failed !== Object.hasOwn(candidate, 'errorCode')) fail()
  const timedEnd = /^(phase|model-request|tool-call|compensation)\.(completed|failed)$/u.test(eventType)
  if (timedEnd !== Object.hasOwn(candidate, 'durationMs')) fail()

  if (eventType.startsWith('phase.')) {
    requireOwn(candidate, 'stepId', 'phase')
    if (!phases.has(candidate.phase as string)) fail()
  } else if (eventType.startsWith('model-request.')) {
    requireOwn(candidate, 'stepId', 'modelRequestId', 'phase')
    if (!modelPhases.has(candidate.phase as string)) fail()
  } else if (eventType.startsWith('tool-call.') || eventType.startsWith('compensation.')) {
    requireOwn(candidate, 'stepId', 'callId')
  } else if (eventType === 'execution.disposition') {
    requireOwn(candidate, 'stepId', 'callId', 'disposition', 'reason')
    if (
      !executionDispositions.has(candidate.disposition as string) ||
      !dispositionReasons.has(candidate.reason as string)
    ) {
      fail()
    }
    validateDispositionPair(
      candidate.disposition as WorkerTelemetryExecutionDisposition,
      candidate.reason as WorkerTelemetryDispositionReason,
    )
  } else if (eventType === 'receipt-recovery.disposition') {
    requireOwn(candidate, 'stepId', 'callId', 'receiptDisposition')
    if (!receiptDispositions.has(candidate.receiptDisposition as string)) fail()
  }

  const artifactId = optionalIdentifier(candidate, 'artifactId')
  const artifactRevision = optionalIdentifier(candidate, 'artifactRevision')
  if ((artifactId === undefined) !== (artifactRevision === undefined)) fail()
  const durationMs = optionalCount(candidate, 'durationMs')
  const byteCount = optionalCount(candidate, 'byteCount')
  const tokenBudget = optionalCount(candidate, 'tokenBudget', 1_000_000)
  if (tokenBudget === 0) fail()
  const stepId = optionalIdentifier(candidate, 'stepId')
  const callId = optionalIdentifier(candidate, 'callId')
  const modelRequestId = optionalIdentifier(candidate, 'modelRequestId')
  const changeSetId = optionalIdentifier(candidate, 'changeSetId', 2_048)
  const resultRevision = optionalIdentifier(candidate, 'resultRevision')

  const event = {
    schemaVersion: WORKER_TELEMETRY_SCHEMA_VERSION,
    eventType,
    timestampMs: candidate.timestampMs as number,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(byteCount === undefined ? {} : { byteCount }),
    status: candidate.status as WorkerTelemetryStatus,
    ...(failed ? { errorCode: requireIdentifier(candidate.errorCode) } : {}),
    sessionId: requireIdentifier(candidate.sessionId),
    taskId: requireIdentifier(candidate.taskId),
    ...(stepId === undefined ? {} : { stepId }),
    ...(callId === undefined ? {} : { callId }),
    ...(modelRequestId === undefined ? {} : { modelRequestId }),
    ...(Object.hasOwn(candidate, 'phase') ? { phase: candidate.phase as WorkerTelemetryPhase } : {}),
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
    ...(changeSetId === undefined ? {} : { changeSetId }),
    ...(artifactId === undefined ? {} : { artifactId, artifactRevision }),
    ...(resultRevision === undefined ? {} : { resultRevision }),
    ...(Object.hasOwn(candidate, 'disposition')
      ? { disposition: candidate.disposition as WorkerTelemetryExecutionDisposition }
      : {}),
    ...(Object.hasOwn(candidate, 'reason') ? { reason: candidate.reason as WorkerTelemetryDispositionReason } : {}),
    ...(Object.hasOwn(candidate, 'receiptDisposition')
      ? { receiptDisposition: candidate.receiptDisposition as WorkerTelemetryReceiptDisposition }
      : {}),
  }
  return Object.freeze(event) as WorkerTelemetryEvent
}

export interface WorkerTelemetryLedger {
  append(input: unknown): WorkerTelemetryEvent
  query(filter: WorkerTelemetryQuery): readonly WorkerTelemetryEvent[]
  readonly size: number
}

const parseTelemetryQuery = (input: unknown): Required<Pick<WorkerTelemetryQuery, never>> & WorkerTelemetryQuery => {
  if (!isExactDataRecord(input, queryKeys) || Reflect.ownKeys(input).length === 0) fail()
  const query = input as Record<string, unknown>
  const result: Record<string, string> = {}
  for (const key of queryKeys) {
    if (Object.hasOwn(query, key)) result[key] = requireIdentifier(query[key], key === 'changeSetId' ? 2_048 : 256)
  }
  if (Object.hasOwn(result, 'artifactId') !== Object.hasOwn(result, 'artifactRevision')) fail()
  return Object.freeze(result) as WorkerTelemetryQuery
}

export const createWorkerTelemetryLedger = ({
  capacity = 256,
}: { readonly capacity?: number } = {}): WorkerTelemetryLedger => {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65_536) fail()
  const events: WorkerTelemetryEvent[] = []
  const tasks = new Map<string, string>()
  const steps = new Map<string, Readonly<{ taskId: string; phase: WorkerTelemetryPhase }>>()
  const calls = new Map<string, string>()
  const modelRequests = new Map<string, string>()
  const changeSets = new Map<string, string>()
  const artifacts = new Map<string, string>()
  const artifactKey = (artifactId: string, artifactRevision: string) => `${artifactId}\u0000${artifactRevision}`

  const taskForStep = (stepId: string) => steps.get(stepId)?.taskId
  const taskForCall = (callId: string) => {
    const stepId = calls.get(callId)
    return stepId ? taskForStep(stepId) : undefined
  }
  const taskForModelRequest = (modelRequestId: string) => {
    const stepId = modelRequests.get(modelRequestId)
    return stepId ? taskForStep(stepId) : undefined
  }

  return Object.freeze({
    append(input: unknown) {
      const event = createWorkerTelemetryEvent(input)
      if (events.length >= capacity) fail()

      const startsTask = event.eventType === 'task.started' || event.eventType === 'task.recovered'
      if (startsTask) {
        if (tasks.has(event.taskId)) fail()
      } else if (tasks.get(event.taskId) !== event.sessionId) {
        fail()
      }

      let registerTask = false
      let registerStep = false
      let registerCall = false
      let registerModelRequest = false
      let registerChangeSet: readonly [string, string] | undefined
      let registerArtifact: readonly [string, string] | undefined

      if ('stepId' in event) {
        const startsStep = event.eventType === 'phase.started'
        if (startsStep) {
          if (steps.has(event.stepId)) fail()
          registerStep = true
        } else if (steps.get(event.stepId)?.taskId !== event.taskId) {
          fail()
        }
        if ('phase' in event && steps.has(event.stepId) && steps.get(event.stepId)?.phase !== event.phase) fail()

        if ('modelRequestId' in event) {
          if (event.eventType === 'model-request.started') {
            if (modelRequests.has(event.modelRequestId)) fail()
            registerModelRequest = true
          } else if (modelRequests.get(event.modelRequestId) !== event.stepId) {
            fail()
          }
        }

        if ('callId' in event) {
          if (event.eventType === 'tool-call.started') {
            if (calls.has(event.callId)) fail()
            registerCall = true
          } else if (calls.get(event.callId) !== event.stepId) {
            fail()
          }
          if ('changeSetId' in event && event.changeSetId !== undefined) {
            if (changeSets.has(event.changeSetId)) fail()
            registerChangeSet = [event.changeSetId, event.callId]
          }
          if ('artifactId' in event && event.artifactId !== undefined && event.artifactRevision !== undefined) {
            const key = artifactKey(event.artifactId, event.artifactRevision)
            if (artifacts.has(key)) fail()
            registerArtifact = [key, event.callId]
          }
        }
      }

      registerTask = startsTask
      if (registerTask) tasks.set(event.taskId, event.sessionId)
      if (registerStep && 'stepId' in event && 'phase' in event) {
        steps.set(event.stepId, Object.freeze({ taskId: event.taskId, phase: event.phase }))
      }
      if (registerCall && 'callId' in event && 'stepId' in event) calls.set(event.callId, event.stepId)
      if (registerModelRequest && 'modelRequestId' in event && 'stepId' in event) {
        modelRequests.set(event.modelRequestId, event.stepId)
      }
      if (registerChangeSet) changeSets.set(...registerChangeSet)
      if (registerArtifact) artifacts.set(...registerArtifact)
      events.push(event)
      return event
    },
    query(input: WorkerTelemetryQuery) {
      const filter = parseTelemetryQuery(input)
      let resolvedTaskId: string | undefined
      let unresolved = false
      const resolveTask = (taskId: string | undefined) => {
        if (!taskId) {
          unresolved = true
          return
        }
        if (resolvedTaskId !== undefined && resolvedTaskId !== taskId) {
          unresolved = true
          return
        }
        resolvedTaskId = taskId
      }

      if (filter.taskId) resolveTask(tasks.has(filter.taskId) ? filter.taskId : undefined)
      if (filter.stepId) resolveTask(taskForStep(filter.stepId))
      if (filter.callId) resolveTask(taskForCall(filter.callId))
      if (filter.modelRequestId) resolveTask(taskForModelRequest(filter.modelRequestId))
      if (filter.changeSetId) {
        const callId = changeSets.get(filter.changeSetId)
        resolveTask(callId ? taskForCall(callId) : undefined)
      }
      if (filter.artifactId && filter.artifactRevision) {
        const callId = artifacts.get(artifactKey(filter.artifactId, filter.artifactRevision))
        resolveTask(callId ? taskForCall(callId) : undefined)
      }
      if (unresolved) return Object.freeze([])

      if (resolvedTaskId) {
        const resolvedSessionId = tasks.get(resolvedTaskId)
        if (!resolvedSessionId || (filter.sessionId && filter.sessionId !== resolvedSessionId)) {
          return Object.freeze([])
        }
        return Object.freeze(events.filter(event => event.taskId === resolvedTaskId))
      }
      if (!filter.sessionId) fail()
      return Object.freeze(events.filter(event => event.sessionId === filter.sessionId))
    },
    get size() {
      return events.length
    },
  })
}

export interface SafeWorkerTelemetryEmitter {
  emit(input: unknown): void
  stats(): Readonly<{ pending: number; dropped: number; failed: number }>
}

export const createSafeWorkerTelemetryEmitter = (
  sink: WorkerTelemetrySink | undefined,
  { maxPending = 32 }: { readonly maxPending?: number } = {},
): SafeWorkerTelemetryEmitter => {
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 1_024) fail()
  const pending = new Set<Promise<void>>()
  let dropped = 0
  let failed = 0
  return Object.freeze({
    emit(input: unknown) {
      if (!sink) return
      let event: WorkerTelemetryEvent
      try {
        event = createWorkerTelemetryEvent(input)
      } catch {
        failed += 1
        return
      }
      if (pending.size >= maxPending) {
        dropped += 1
        return
      }
      try {
        const result = sink.emit(event)
        if (!result || typeof (result as PromiseLike<void>).then !== 'function') return
        const tracked = Promise.resolve(result)
          .catch(() => {
            failed += 1
          })
          .finally(() => pending.delete(tracked))
        pending.add(tracked)
      } catch {
        failed += 1
      }
    },
    stats: () => Object.freeze({ pending: pending.size, dropped, failed }),
  })
}
