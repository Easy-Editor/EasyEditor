export const WORKER_TELEMETRY_SCHEMA_VERSION = 1 as const

export const workerTelemetryEventTypes = [
  'task.started',
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
  'runtime.terminal',
] as const

export type WorkerTelemetryEventType = (typeof workerTelemetryEventTypes)[number]
export type WorkerTelemetryStatus = 'started' | 'completed' | 'failed' | 'cancelled' | 'compensated'

interface WorkerTelemetryBase<EventType extends WorkerTelemetryEventType> {
  readonly schemaVersion: typeof WORKER_TELEMETRY_SCHEMA_VERSION
  readonly eventType: EventType
  readonly timestampMs: number
  readonly byteCount?: number
  readonly status?: WorkerTelemetryStatus
  readonly sessionId: string
  readonly taskId: string
}

type TimedTelemetryEvent<Event> = Event & { readonly durationMs: number }
type FailedTelemetryEvent<Event> = Event & { readonly errorCode: string }

type TaskTelemetryEvent =
  | WorkerTelemetryBase<'task.started' | 'task.completed' | 'task.cancelled'>
  | FailedTelemetryEvent<WorkerTelemetryBase<'task.failed'>>
type PhaseCorrelation = {
  readonly stepId: string
}
type PhaseTelemetryEvent =
  | (WorkerTelemetryBase<'phase.started'> & PhaseCorrelation)
  | TimedTelemetryEvent<WorkerTelemetryBase<'phase.completed'> & PhaseCorrelation>
  | FailedTelemetryEvent<TimedTelemetryEvent<WorkerTelemetryBase<'phase.failed'> & PhaseCorrelation>>
type ModelRequestCorrelation = {
  readonly stepId: string
  readonly modelRequestId: string
}
type ModelRequestTelemetryEvent =
  | (WorkerTelemetryBase<'model-request.started'> & ModelRequestCorrelation)
  | TimedTelemetryEvent<WorkerTelemetryBase<'model-request.completed'> & ModelRequestCorrelation>
  | FailedTelemetryEvent<TimedTelemetryEvent<WorkerTelemetryBase<'model-request.failed'> & ModelRequestCorrelation>>
type ToolCallCorrelation = {
  readonly stepId: string
  readonly callId: string
  readonly changeSetId?: string
  readonly artifactId?: string
  readonly revision?: string
}
type ToolCallTelemetryEvent =
  | (WorkerTelemetryBase<'tool-call.started'> & ToolCallCorrelation)
  | TimedTelemetryEvent<WorkerTelemetryBase<'tool-call.completed'> & ToolCallCorrelation>
  | FailedTelemetryEvent<TimedTelemetryEvent<WorkerTelemetryBase<'tool-call.failed'> & ToolCallCorrelation>>
type CompensationCorrelation = {
  readonly stepId: string
  readonly callId: string
}
type CompensationTelemetryEvent =
  | (WorkerTelemetryBase<'compensation.started'> & CompensationCorrelation)
  | TimedTelemetryEvent<WorkerTelemetryBase<'compensation.completed'> & CompensationCorrelation>
  | FailedTelemetryEvent<TimedTelemetryEvent<WorkerTelemetryBase<'compensation.failed'> & CompensationCorrelation>>
type RuntimeTerminalTelemetryEvent = WorkerTelemetryBase<'runtime.terminal'> &
  (
    | { readonly status: 'failed'; readonly errorCode: string }
    | { readonly status?: Exclude<WorkerTelemetryStatus, 'failed'>; readonly errorCode?: never }
  )

export type WorkerTelemetryEvent =
  | TaskTelemetryEvent
  | PhaseTelemetryEvent
  | ModelRequestTelemetryEvent
  | ToolCallTelemetryEvent
  | CompensationTelemetryEvent
  | RuntimeTerminalTelemetryEvent

export interface WorkerTelemetrySink {
  emit(event: WorkerTelemetryEvent): void | Promise<void>
}

const eventTypes = new Set<string>(workerTelemetryEventTypes)
const statuses = new Set<string>(['started', 'completed', 'failed', 'cancelled', 'compensated'])
const baseKeys = [
  'schemaVersion',
  'eventType',
  'timestampMs',
  'durationMs',
  'byteCount',
  'status',
  'errorCode',
  'sessionId',
  'taskId',
] as const
const correlationKeys = ['stepId', 'callId', 'modelRequestId', 'changeSetId', 'artifactId', 'revision'] as const
const allowedKeys = new Set<string>([...baseKeys, ...correlationKeys])
const unsafeIdentifierCharacter = /[\p{C}\p{Z}]/u

const fail = (): never => {
  throw new TypeError('Worker telemetry event is invalid')
}

const requireIdentifier = (value: unknown): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || unsafeIdentifierCharacter.test(value)) {
    fail()
  }
  return value as string
}

const optionalIdentifier = (record: Record<string, unknown>, key: string): string | undefined =>
  Object.hasOwn(record, key) ? requireIdentifier(record[key]) : undefined

const optionalCount = (record: Record<string, unknown>, key: string): number | undefined => {
  if (!Object.hasOwn(record, key)) return undefined
  const value = record[key]
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail()
  return value as number
}

const correlationsFor = (eventType: WorkerTelemetryEventType) => {
  if (eventType.startsWith('phase.')) return new Set(['stepId'])
  if (eventType.startsWith('model-request.')) return new Set(['stepId', 'modelRequestId'])
  if (eventType.startsWith('tool-call.')) {
    return new Set(['stepId', 'callId', 'changeSetId', 'artifactId', 'revision'])
  }
  if (eventType.startsWith('compensation.')) return new Set(['stepId', 'callId'])
  return new Set<string>()
}

export const createWorkerTelemetryEvent = (input: unknown): WorkerTelemetryEvent => {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    fail()
  }
  const record = input as Record<string, unknown>
  const ownKeys = Reflect.ownKeys(record)
  if (ownKeys.some(key => typeof key !== 'string' || !allowedKeys.has(key))) fail()
  if (
    ownKeys.some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key)
      return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
    })
  ) {
    fail()
  }
  if (record.schemaVersion !== WORKER_TELEMETRY_SCHEMA_VERSION || !eventTypes.has(record.eventType as string)) fail()
  if (!Number.isSafeInteger(record.timestampMs) || (record.timestampMs as number) < 0) fail()
  if (Object.hasOwn(record, 'status') && !statuses.has(record.status as string)) fail()

  const eventType = record.eventType as WorkerTelemetryEventType
  const allowedCorrelations = correlationsFor(eventType)
  for (const key of correlationKeys) {
    if (Object.hasOwn(record, key) && !allowedCorrelations.has(key)) fail()
  }
  for (const key of allowedCorrelations) {
    if (key === 'changeSetId' || key === 'artifactId' || key === 'revision') continue
    if (!Object.hasOwn(record, key)) fail()
  }
  const failed = eventType.endsWith('.failed')
  const terminalFailure = eventType === 'runtime.terminal' && record.status === 'failed'
  if ((failed || terminalFailure) !== Object.hasOwn(record, 'errorCode')) fail()
  const timedEnd = /^(phase|model-request|tool-call|compensation)\.(completed|failed)$/u.test(eventType)
  if (timedEnd && !Object.hasOwn(record, 'durationMs')) fail()

  const durationMs = optionalCount(record, 'durationMs')
  const byteCount = optionalCount(record, 'byteCount')
  const stepId = optionalIdentifier(record, 'stepId')
  const callId = optionalIdentifier(record, 'callId')
  const modelRequestId = optionalIdentifier(record, 'modelRequestId')
  const changeSetId = optionalIdentifier(record, 'changeSetId')
  const artifactId = optionalIdentifier(record, 'artifactId')
  const revision = optionalIdentifier(record, 'revision')
  const event = {
    schemaVersion: WORKER_TELEMETRY_SCHEMA_VERSION,
    eventType,
    timestampMs: record.timestampMs as number,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(byteCount === undefined ? {} : { byteCount }),
    ...(Object.hasOwn(record, 'status') ? { status: record.status as WorkerTelemetryStatus } : {}),
    ...(failed || terminalFailure ? { errorCode: requireIdentifier(record.errorCode) } : {}),
    sessionId: requireIdentifier(record.sessionId),
    taskId: requireIdentifier(record.taskId),
    ...(stepId === undefined ? {} : { stepId }),
    ...(callId === undefined ? {} : { callId }),
    ...(modelRequestId === undefined ? {} : { modelRequestId }),
    ...(changeSetId === undefined ? {} : { changeSetId }),
    ...(artifactId === undefined ? {} : { artifactId }),
    ...(revision === undefined ? {} : { revision }),
  }
  return Object.freeze(event) as WorkerTelemetryEvent
}

export interface WorkerTelemetryLedger {
  append(input: unknown): WorkerTelemetryEvent
  query(filter: { readonly sessionId: string; readonly taskId?: string }): readonly WorkerTelemetryEvent[]
  readonly size: number
}

export const createWorkerTelemetryLedger = ({
  capacity = 256,
}: { readonly capacity?: number } = {}): WorkerTelemetryLedger => {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65_536) fail()
  const events: WorkerTelemetryEvent[] = []
  const tasks = new Set<string>()
  const steps = new Map<string, string>()
  const calls = new Map<string, string>()
  const modelRequests = new Map<string, string>()
  const changeSets = new Map<string, string>()
  const artifacts = new Map<string, string>()
  const key = (...parts: string[]) => parts.join('\u0000')

  return Object.freeze({
    append(input: unknown) {
      const event = createWorkerTelemetryEvent(input)
      if (events.length >= capacity) fail()
      const taskKey = key(event.sessionId, event.taskId)
      const startsTask = event.eventType === 'task.started'
      if (!startsTask && !tasks.has(taskKey)) fail()

      let registeredStep: readonly [string, string] | undefined
      let registeredCall: readonly [string, string] | undefined
      let registeredModelRequest: readonly [string, string] | undefined
      const registeredRelations: Array<readonly [Map<string, string>, string, string]> = []
      if ('stepId' in event) {
        const stepKey = key(event.sessionId, event.taskId, event.stepId)
        if (event.eventType === 'phase.started') registeredStep = [stepKey, taskKey]
        else if (steps.get(stepKey) !== taskKey) fail()

        if ('modelRequestId' in event) {
          const requestKey = key(event.sessionId, event.taskId, event.modelRequestId)
          if (event.eventType === 'model-request.started') registeredModelRequest = [requestKey, stepKey]
          else if (modelRequests.get(requestKey) !== stepKey) fail()
        }
        if ('callId' in event) {
          const callKey = key(event.sessionId, event.taskId, event.callId)
          if (event.eventType === 'tool-call.started' || event.eventType === 'compensation.started') {
            const owner = calls.get(callKey)
            if (owner && owner !== stepKey) fail()
            registeredCall = [callKey, stepKey]
          } else if (calls.get(callKey) !== stepKey) fail()

          for (const [field, relations] of [
            ['changeSetId', changeSets],
            ['artifactId', artifacts],
          ] as const) {
            if (!(field in event)) continue
            const relationKey = key(event.sessionId, event.taskId, (event as ToolCallTelemetryEvent)[field] as string)
            const owner = relations.get(relationKey)
            if (owner && owner !== callKey) fail()
            registeredRelations.push([relations, relationKey, callKey])
          }
        }
      }
      if (startsTask) tasks.add(taskKey)
      if (registeredStep) steps.set(...registeredStep)
      if (registeredCall) calls.set(...registeredCall)
      if (registeredModelRequest) modelRequests.set(...registeredModelRequest)
      for (const [relations, relationKey, ownerKey] of registeredRelations) relations.set(relationKey, ownerKey)
      events.push(event)
      return event
    },
    query(filter: { readonly sessionId: string; readonly taskId?: string }) {
      const sessionId = requireIdentifier(filter?.sessionId)
      const taskId = filter?.taskId === undefined ? undefined : requireIdentifier(filter.taskId)
      return Object.freeze(
        events.filter(event => event.sessionId === sessionId && (!taskId || event.taskId === taskId)),
      )
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
      const event = createWorkerTelemetryEvent(input)
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
