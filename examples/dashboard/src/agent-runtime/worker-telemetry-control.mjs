const EVENT_TYPES = new Set([
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
])
const PHASES = new Set(['BLUEPRINT', 'PLAN_STEP', 'REPAIR', 'COMPENSATION', 'RECOVERY'])
const MODEL_PHASES = new Set(['BLUEPRINT', 'PLAN_STEP', 'REPAIR'])
const STATUSES = new Set(['started', 'recovered', 'completed', 'failed', 'cancelled', 'compensated'])
const EXECUTION_DISPOSITIONS = new Set(['yielded', 'repair', 'paused'])
const DISPOSITION_REASONS = new Set([
  'HUMAN_ACTIVITY',
  'STALE_REVISION',
  'SNAPSHOT_REVISION_MISMATCH',
  'RESULT_REVISION_MISMATCH',
  'TOOL_FAILURE',
  'INDETERMINATE',
  'YIELD_LIMIT',
  'REPAIR_BUDGET_EXHAUSTED',
  'PERSISTENCE_FAILURE',
])
const RECEIPT_DISPOSITIONS = new Set([
  'missing',
  'applied',
  'not-applied',
  'rejected',
  'indeterminate',
  'resume-safe-retry',
])
const ERROR_CODES = new Set([
  'AMBIGUOUS_RECEIPT',
  'APPLIED_UNDURABLE',
  'AUTHORITY_MISMATCH',
  'BUDGET_EXCEEDED',
  'CAPABILITY_UNAVAILABLE',
  'COMPENSATION_CONFLICT',
  'COMPENSATION_IN_PROGRESS',
  'CORE_TRANSACTION_FAILED',
  'DATA_BINDING_UNSUPPORTED',
  'DATA_BUDGET_EXCEEDED',
  'DATA_NODE_NOT_FOUND',
  'DATA_SOURCE_CONFLICT',
  'DATA_SOURCE_NOT_FOUND',
  'DATA_UNAVAILABLE',
  'HOST_DISPOSED',
  'HUMAN_ACTIVITY',
  'IDEMPOTENCY_CONFLICT',
  'INDETERMINATE_CORE_OUTCOME',
  'INDETERMINATE_RECEIPT',
  'INDETERMINATE_SERVER_OUTCOME',
  'INVALID_CALL',
  'INVALID_CAPABILITY_REQUEST',
  'INVALID_CHANGESET',
  'INVALID_DATA_REQUEST',
  'INVALID_DOCUMENT_STATE',
  'INVALID_JSON',
  'INVALID_LINEAGE_DTO',
  'INVALID_MANIFEST',
  'INVALID_MATERIAL_REF',
  'INVALID_PREPARE_CONTEXT',
  'INVALID_PROJECT_STATE',
  'INVALID_RECOVERY',
  'INVALID_REQUEST',
  'INVALID_SNAPSHOT',
  'MATERIAL_ADMISSION_FAILED',
  'MATERIAL_NOT_FOUND',
  'NO_CHANGE',
  'PERSISTENCE_FAILURE',
  'REPAIR_BUDGET_EXHAUSTED',
  'RESULT_REVISION_MISMATCH',
  'SERVER_PROMOTION_FAILED',
  'SNAPSHOT_REVISION_MISMATCH',
  'STALE_MUTATION_VERSION',
  'STALE_REVISION',
  'TOOL_FAILURE',
  'TRANSACTION_ROLLBACK_INCOMPLETE',
  'UNKNOWN_CAPABILITY',
  'UNKNOWN_FIELD',
  'UNKNOWN_MATERIAL',
  'UNKNOWN_NODE',
  'UNSUPPORTED_FIELD',
  'UNSUPPORTED_VALUE_SCHEMA',
  'VALUE_CONSTRAINT',
  'WRITE_CONFLICT',
  'YIELD_LIMIT',
  'applied-undurable-recovery-locked',
  'compensation-command-incomplete',
  'compensation-failed',
  'compensation-incomplete',
  'disposed',
  'human-priority-yield-limit',
  'indeterminate-tool-result',
  'invalid-model-turn',
  'invalid-task-phase',
  'invalid-tool-call-context',
  'missing-task',
  'model-paused',
  'model-request-failed',
  'persistence-failed',
  'receipt-recovery-failed',
  'repair-budget-exhausted',
  'request-aborted',
  'snapshot-revision-mismatch',
  'tool-call-failed',
  'tool-call-indeterminate',
  'worker-task-failed',
])
const BASE_FIELDS = ['schemaVersion', 'eventType', 'timestampMs', 'byteCount', 'status', 'sessionId', 'taskId']
const PHASE_FIELDS = ['stepId', 'phase']
const MODEL_FIELDS = ['stepId', 'modelRequestId', 'phase', 'tokenBudget']
const TOOL_START_FIELDS = ['stepId', 'callId']
const TOOL_END_FIELDS = ['stepId', 'callId', 'changeSetId', 'artifactId', 'artifactRevision', 'resultRevision']
const DISPOSITION_FIELDS = ['stepId', 'callId', 'disposition', 'reason']
const RECEIPT_FIELDS = ['stepId', 'callId', 'receiptDisposition', 'resultRevision']
const UNSAFE_IDENTIFIER_CHARACTER = /[\p{C}\p{Z}]/u

const fail = () => {
  throw new TypeError('Worker telemetry control event is invalid')
}

const isEnumerableDataRecord = value => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false
  }
  return Reflect.ownKeys(value).every(key => {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
  })
}

const isExactDataRecord = (value, allowedFields) =>
  isEnumerableDataRecord(value) && Reflect.ownKeys(value).every(key => allowedFields.has(key))

const identifier = (value, maximumLength = 256) => {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength ||
    UNSAFE_IDENTIFIER_CHARACTER.test(value)
  ) {
    fail()
  }
  return value
}

const errorCode = value => {
  const code = identifier(value)
  if (!ERROR_CODES.has(code)) fail()
  return code
}

const optionalIdentifier = (value, key, maximumLength) =>
  Object.hasOwn(value, key) ? identifier(value[key], maximumLength) : undefined

const optionalCount = (value, key, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Object.hasOwn(value, key)) return undefined
  if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > maximum) fail()
  return value[key]
}

const expectedStatus = eventType => {
  if (eventType.endsWith('.started')) return 'started'
  if (eventType === 'task.recovered') return 'recovered'
  if (eventType === 'task.cancelled') return 'cancelled'
  if (eventType === 'compensation.completed') return 'compensated'
  if (eventType.endsWith('.failed')) return 'failed'
  return 'completed'
}

const allowedFieldsFor = eventType => {
  const fields = [...BASE_FIELDS]
  if (eventType.startsWith('phase.')) fields.push(...PHASE_FIELDS)
  else if (eventType.startsWith('model-request.')) fields.push(...MODEL_FIELDS)
  else if (eventType === 'tool-call.started') fields.push(...TOOL_START_FIELDS)
  else if (eventType === 'tool-call.completed' || eventType === 'tool-call.failed') fields.push(...TOOL_END_FIELDS)
  else if (eventType.startsWith('compensation.')) fields.push(...TOOL_START_FIELDS)
  else if (eventType === 'execution.disposition') fields.push(...DISPOSITION_FIELDS)
  else if (eventType === 'receipt-recovery.disposition') fields.push(...RECEIPT_FIELDS)
  if (/^(phase|model-request|tool-call|compensation)\.(completed|failed)$/u.test(eventType)) {
    fields.push('durationMs')
  }
  if (eventType.endsWith('.failed') || eventType === 'runtime.terminal') fields.push('errorCode')
  return new Set(fields)
}

const requireFields = (value, ...fields) => {
  if (fields.some(field => !Object.hasOwn(value, field))) fail()
}

const validateDispositionPair = (disposition, reason) => {
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

export const parseWorkerTelemetryControlEvent = value => {
  if (!isEnumerableDataRecord(value) || value.schemaVersion !== 1) fail()
  if (!EVENT_TYPES.has(value.eventType) || !isExactDataRecord(value, allowedFieldsFor(value.eventType))) fail()
  requireFields(value, 'schemaVersion', 'eventType', 'timestampMs', 'status', 'sessionId', 'taskId')
  if (!Number.isSafeInteger(value.timestampMs) || value.timestampMs < 0 || !STATUSES.has(value.status)) fail()
  if (value.eventType === 'runtime.terminal') {
    if (value.status !== 'completed' && value.status !== 'cancelled' && value.status !== 'failed') fail()
  } else if (value.status !== expectedStatus(value.eventType)) {
    fail()
  }

  const failed =
    value.eventType.endsWith('.failed') || (value.eventType === 'runtime.terminal' && value.status === 'failed')
  if (failed !== Object.hasOwn(value, 'errorCode')) fail()
  const timed = /^(phase|model-request|tool-call|compensation)\.(completed|failed)$/u.test(value.eventType)
  if (timed !== Object.hasOwn(value, 'durationMs')) fail()

  if (value.eventType.startsWith('phase.')) {
    requireFields(value, 'stepId', 'phase')
    if (!PHASES.has(value.phase)) fail()
  } else if (value.eventType.startsWith('model-request.')) {
    requireFields(value, 'stepId', 'modelRequestId', 'phase')
    if (!MODEL_PHASES.has(value.phase)) fail()
  } else if (value.eventType.startsWith('tool-call.') || value.eventType.startsWith('compensation.')) {
    requireFields(value, 'stepId', 'callId')
  } else if (value.eventType === 'execution.disposition') {
    requireFields(value, 'stepId', 'callId', 'disposition', 'reason')
    if (!EXECUTION_DISPOSITIONS.has(value.disposition) || !DISPOSITION_REASONS.has(value.reason)) fail()
    validateDispositionPair(value.disposition, value.reason)
  } else if (value.eventType === 'receipt-recovery.disposition') {
    requireFields(value, 'stepId', 'callId', 'receiptDisposition')
    if (!RECEIPT_DISPOSITIONS.has(value.receiptDisposition)) fail()
  }

  const artifactId = optionalIdentifier(value, 'artifactId')
  const artifactRevision = optionalIdentifier(value, 'artifactRevision')
  if ((artifactId === undefined) !== (artifactRevision === undefined)) fail()
  const durationMs = optionalCount(value, 'durationMs')
  const byteCount = optionalCount(value, 'byteCount')
  const tokenBudget = optionalCount(value, 'tokenBudget', 1_000_000)
  if (tokenBudget === 0) fail()
  const event = {
    schemaVersion: 1,
    eventType: value.eventType,
    timestampMs: value.timestampMs,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(byteCount === undefined ? {} : { byteCount }),
    status: value.status,
    ...(failed ? { errorCode: errorCode(value.errorCode) } : {}),
    sessionId: identifier(value.sessionId),
    taskId: identifier(value.taskId),
    ...(Object.hasOwn(value, 'stepId') ? { stepId: identifier(value.stepId) } : {}),
    ...(Object.hasOwn(value, 'callId') ? { callId: identifier(value.callId) } : {}),
    ...(Object.hasOwn(value, 'modelRequestId') ? { modelRequestId: identifier(value.modelRequestId) } : {}),
    ...(Object.hasOwn(value, 'phase') ? { phase: value.phase } : {}),
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
    ...(Object.hasOwn(value, 'changeSetId') ? { changeSetId: identifier(value.changeSetId, 2_048) } : {}),
    ...(artifactId === undefined ? {} : { artifactId, artifactRevision }),
    ...(Object.hasOwn(value, 'resultRevision') ? { resultRevision: identifier(value.resultRevision) } : {}),
    ...(Object.hasOwn(value, 'disposition') ? { disposition: value.disposition } : {}),
    ...(Object.hasOwn(value, 'reason') ? { reason: value.reason } : {}),
    ...(Object.hasOwn(value, 'receiptDisposition') ? { receiptDisposition: value.receiptDisposition } : {}),
  }
  return Object.freeze(event)
}

export const createMainThreadWorkerTelemetryDelivery = (sink, { maxPending = 32 } = {}) => {
  if (sink !== undefined) {
    const emit =
      sink && typeof sink === 'object' && !Array.isArray(sink)
        ? Object.getOwnPropertyDescriptor(sink, 'emit')
        : undefined
    if (!emit || emit.enumerable !== true || !Object.hasOwn(emit, 'value') || typeof emit.value !== 'function') fail()
  }
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 1_024) fail()
  const pending = new Set()
  let dropped = 0
  let failed = 0
  return Object.freeze({
    emit(event) {
      if (!sink) return
      if (pending.size >= maxPending) {
        dropped += 1
        return
      }
      try {
        const emit = Object.getOwnPropertyDescriptor(sink, 'emit')?.value
        const result = typeof emit === 'function' ? emit.call(sink, event) : undefined
        if (!result || typeof result.then !== 'function') return
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
