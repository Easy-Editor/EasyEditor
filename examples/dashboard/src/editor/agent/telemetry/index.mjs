const WORKER_EVENT_TYPES = new Set([
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

const DOMAIN_SCHEMAS = Object.freeze({
  'dashboard.call.observed': {
    required: ['sessionId', 'taskId', 'stepId', 'callId', 'projectRevision'],
    optional: [],
  },
  'dashboard.snapshot.captured': {
    required: ['sessionId', 'taskId', 'snapshotMode', 'projectRevision'],
    optional: ['durationMs', 'byteCount'],
  },
  'dashboard.screen.prepare': {
    required: ['sessionId', 'taskId', 'stepId', 'callId', 'changeSetId', 'projectRevision', 'status'],
    optional: ['durationMs', 'errorCode'],
  },
  'dashboard.screen.commit': {
    required: ['sessionId', 'taskId', 'stepId', 'callId', 'changeSetId', 'projectRevision', 'status'],
    optional: ['durationMs', 'errorCode'],
  },
  'dashboard.screen.verify': {
    required: ['sessionId', 'taskId', 'stepId', 'callId', 'changeSetId', 'projectRevision', 'status'],
    optional: ['durationMs', 'errorCode'],
  },
  'dashboard.screen.stale': {
    required: [
      'sessionId',
      'taskId',
      'stepId',
      'callId',
      'changeSetId',
      'expectedProjectRevision',
      'currentProjectRevision',
      'diagnosticCode',
    ],
    optional: [],
  },
  'dashboard.receipt.recovery': {
    required: ['sessionId', 'taskId', 'callId', 'receiptClassification', 'status'],
    optional: ['durationMs'],
  },
  'dashboard.persistence.read': {
    required: ['sessionId', 'status', 'persistenceGeneration'],
    optional: ['durationMs', 'recordCount', 'byteCount', 'errorCode'],
  },
  'dashboard.persistence.commit': {
    required: ['sessionId', 'status', 'persistenceGeneration', 'recordCount'],
    optional: ['durationMs', 'byteCount', 'errorCode', 'diagnosticCode'],
  },
  'dashboard.compensation.result': {
    required: ['sessionId', 'taskId', 'stepId', 'callId', 'status', 'appliedCount', 'conflictCount'],
    optional: ['durationMs', 'errorCode'],
  },
  'dashboard.iframe.batch': {
    required: ['surfaceId', 'status', 'batchSize', 'instanceCount'],
    optional: ['revisionKey', 'payloadHash'],
  },
  'dashboard.iframe.fault': {
    required: ['surfaceId', 'status', 'diagnosticCode'],
    optional: ['revisionKey'],
  },
  'dashboard.iframe.restart': {
    required: ['surfaceId', 'status', 'diagnosticCode'],
    optional: ['instanceCount'],
  },
  'dashboard.artifact.resolution': {
    required: [
      'sessionId',
      'taskId',
      'stepId',
      'callId',
      'artifactId',
      'sourceRevision',
      'dependencyLockDigest',
      'resolutionStatus',
      'status',
    ],
    optional: ['durationMs', 'errorCode'],
  },
  'dashboard.artifact.revision': {
    required: [
      'sessionId',
      'taskId',
      'stepId',
      'callId',
      'artifactId',
      'sourceRevision',
      'artifactRevision',
      'dependencyLockDigest',
      'status',
    ],
    optional: ['durationMs', 'errorCode', 'projectRevision'],
  },
  'dashboard.promotion.status': {
    required: [
      'sessionId',
      'taskId',
      'stepId',
      'callId',
      'artifactId',
      'sourceRevision',
      'dependencyLockDigest',
      'promotionStatus',
      'status',
    ],
    optional: ['durationMs', 'errorCode', 'artifactRevision', 'projectRevision'],
  },
})

const BASE_KEYS = ['schemaVersion', 'eventType', 'timestampMs']
const FIELD_VALIDATORS = Object.freeze({
  durationMs: 'count',
  byteCount: 'count',
  persistenceGeneration: 'count',
  recordCount: 'count',
  appliedCount: 'count',
  conflictCount: 'count',
  batchSize: 'count',
  instanceCount: 'count',
  status: 'status',
  errorCode: 'errorCode',
  diagnosticCode: 'diagnosticCode',
  sessionId: 'identifier',
  taskId: 'identifier',
  stepId: 'identifier',
  callId: 'identifier',
  modelRequestId: 'identifier',
  changeSetId: 'changeSetId',
  artifactId: 'identifier',
  sourceRevision: 'identifier',
  artifactRevision: 'identifier',
  projectRevision: 'identifier',
  expectedProjectRevision: 'identifier',
  currentProjectRevision: 'identifier',
  snapshotMode: 'snapshotMode',
  receiptClassification: 'receiptClassification',
  surfaceId: 'identifier',
  revisionKey: 'identifier',
  payloadHash: 'digest',
  dependencyLockDigest: 'digest',
  promotionStatus: 'promotionStatus',
  resolutionStatus: 'resolutionStatus',
  phase: 'phase',
  tokenBudget: 'positiveCount',
  disposition: 'disposition',
  reason: 'dispositionReason',
  receiptDisposition: 'receiptDisposition',
})
const STATUSES = new Set([
  'started',
  'completed',
  'failed',
  'cancelled',
  'compensated',
  'recovered',
  'applied',
  'not-applied',
  'rejected',
  'indeterminate',
  'committed',
  'missing',
  'scheduled',
  'restarted',
])
const SNAPSHOT_MODES = new Set(['full', 'delta'])
const RECEIPT_CLASSIFICATIONS = new Set(['committed', 'failed', 'missing', 'indeterminate'])
const PROMOTION_STATUSES = new Set(['prepared', 'registry-active', 'committed', 'failed', 'recovered'])
const RESOLUTION_STATUSES = new Set(['resolved', 'rejected', 'failed'])
const PHASES = new Set(['BLUEPRINT', 'PLAN_STEP', 'REPAIR', 'RECOVERY', 'COMPENSATION'])
const MODEL_PHASES = new Set(['BLUEPRINT', 'PLAN_STEP', 'REPAIR'])
const DISPOSITIONS = new Set(['yielded', 'repair', 'paused'])
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
const QUERY_KEYS = new Set([
  'sessionId',
  'taskId',
  'stepId',
  'callId',
  'changeSetId',
  'modelRequestId',
  'artifactId',
  'sourceRevision',
  'artifactRevision',
  'eventType',
])
const IDENTIFIER_PATTERN = /^[^\p{C}\p{Z}]{1,256}$/u
const DIGEST_PATTERN = /^sha256:[\da-f]{64}$/u
const CHANGE_SET_ID_PATTERN = /^change-set-v1-(?:[a-f0-9]{2})+$/u
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
  'core-transaction-failed',
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
  'persistence-operation-failed',
  'receipt-recovery-failed',
  'repair-budget-exhausted',
  'request-aborted',
  'snapshot-revision-mismatch',
  'tool-call-failed',
  'tool-call-indeterminate',
  'worker-task-failed',
])
const DIAGNOSTIC_CODES = new Set([
  'async-lifecycle',
  'commit-rejected',
  'generation-conflict',
  'global-pollution',
  'initial-revision-mismatch',
  'lifecycle-timeout',
  'message-storm',
  'prepared-fence-mismatch',
  'render-failed',
  'resource-leak',
  'sandbox-fault',
  'surface-restart',
  'unexpected-frame-reload',
])

const invalid = () => {
  throw new TypeError('Dashboard telemetry event is invalid')
}

const assertPlainDataRecord = value => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid()
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') invalid()
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid()
  }
  return value
}

const requireIdentifier = value => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) invalid()
  return value
}

const requireChangeSetId = value => {
  if (typeof value !== 'string' || value.length > 2048 || !CHANGE_SET_ID_PATTERN.test(value)) invalid()
  return value
}

const requireCount = value => {
  if (!Number.isSafeInteger(value) || value < 0) invalid()
  return value
}

const requireEnum = (value, allowed) => {
  if (typeof value !== 'string' || !allowed.has(value)) invalid()
  return value
}

const validateField = (key, value) => {
  const validator = FIELD_VALIDATORS[key]
  if (validator === 'count') return requireCount(value)
  if (validator === 'positiveCount') {
    const result = requireCount(value)
    if (result === 0 || result > 1_000_000) invalid()
    return result
  }
  if (validator === 'identifier') return requireIdentifier(value)
  if (validator === 'changeSetId') return requireChangeSetId(value)
  if (validator === 'errorCode') return requireEnum(value, ERROR_CODES)
  if (validator === 'diagnosticCode') return requireEnum(value, DIAGNOSTIC_CODES)
  if (validator === 'digest') {
    if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) invalid()
    return value
  }
  if (validator === 'status') return requireEnum(value, STATUSES)
  if (validator === 'snapshotMode') return requireEnum(value, SNAPSHOT_MODES)
  if (validator === 'receiptClassification') return requireEnum(value, RECEIPT_CLASSIFICATIONS)
  if (validator === 'promotionStatus') return requireEnum(value, PROMOTION_STATUSES)
  if (validator === 'resolutionStatus') return requireEnum(value, RESOLUTION_STATUSES)
  if (validator === 'phase') return requireEnum(value, PHASES)
  if (validator === 'disposition') return requireEnum(value, DISPOSITIONS)
  if (validator === 'dispositionReason') return requireEnum(value, DISPOSITION_REASONS)
  if (validator === 'receiptDisposition') return requireEnum(value, RECEIPT_DISPOSITIONS)
  invalid()
}

const workerCorrelationKeys = eventType => {
  if (eventType.startsWith('phase.')) return ['stepId', 'phase']
  if (eventType.startsWith('model-request.')) return ['stepId', 'modelRequestId', 'phase', 'tokenBudget']
  if (eventType === 'tool-call.started') return ['stepId', 'callId']
  if (eventType === 'tool-call.completed' || eventType === 'tool-call.failed') {
    return ['stepId', 'callId', 'changeSetId', 'artifactId', 'artifactRevision', 'resultRevision']
  }
  if (eventType.startsWith('compensation.')) return ['stepId', 'callId']
  if (eventType === 'execution.disposition') return ['stepId', 'callId', 'disposition', 'reason']
  if (eventType === 'receipt-recovery.disposition') {
    return ['stepId', 'callId', 'receiptDisposition', 'resultRevision']
  }
  return []
}

const expectedWorkerStatus = eventType => {
  if (eventType.endsWith('.started')) return 'started'
  if (eventType === 'task.recovered') return 'recovered'
  if (eventType === 'task.cancelled') return 'cancelled'
  if (eventType === 'compensation.completed') return 'compensated'
  if (eventType.endsWith('.failed')) return 'failed'
  return 'completed'
}

const normalizeWorkerEvent = record => {
  const eventType = record.eventType
  const correlations = workerCorrelationKeys(eventType)
  const required = ['schemaVersion', 'eventType', 'timestampMs', 'status', 'sessionId', 'taskId']
  if (eventType.startsWith('phase.')) required.push('stepId', 'phase')
  if (eventType.startsWith('model-request.')) required.push('stepId', 'modelRequestId', 'phase')
  if (
    eventType.startsWith('tool-call.') ||
    eventType.startsWith('compensation.') ||
    eventType === 'execution.disposition' ||
    eventType === 'receipt-recovery.disposition'
  ) {
    required.push('stepId', 'callId')
  }
  if (eventType === 'execution.disposition') required.push('disposition', 'reason')
  if (eventType === 'receipt-recovery.disposition') required.push('receiptDisposition')
  const timedEnd = /^(phase|model-request|tool-call|compensation)\.(completed|failed)$/u.test(eventType)
  if (timedEnd) required.push('durationMs')
  const terminalFailure = eventType === 'runtime.terminal' && record.status === 'failed'
  if (eventType.endsWith('.failed') || terminalFailure) required.push('errorCode')
  const allowed = new Set([...required, 'durationMs', 'byteCount', 'errorCode', ...correlations])
  const keys = Reflect.ownKeys(record)
  if (keys.some(key => typeof key !== 'string' || !allowed.has(key))) invalid()
  if (required.some(key => !Object.hasOwn(record, key))) invalid()
  for (const key of [
    'stepId',
    'callId',
    'modelRequestId',
    'changeSetId',
    'artifactId',
    'artifactRevision',
    'resultRevision',
    'phase',
    'tokenBudget',
    'disposition',
    'reason',
    'receiptDisposition',
  ]) {
    if (Object.hasOwn(record, key) && !correlations.includes(key)) invalid()
  }
  if (Object.hasOwn(record, 'errorCode') !== (eventType.endsWith('.failed') || terminalFailure)) invalid()
  if (record.status !== expectedWorkerStatus(eventType) && eventType !== 'runtime.terminal') invalid()
  if (
    eventType === 'runtime.terminal' &&
    record.status !== 'completed' &&
    record.status !== 'cancelled' &&
    record.status !== 'failed'
  ) {
    invalid()
  }
  if (eventType.startsWith('model-request.') && !MODEL_PHASES.has(record.phase)) invalid()
  if (
    (Object.hasOwn(record, 'artifactId') || Object.hasOwn(record, 'artifactRevision')) &&
    Object.hasOwn(record, 'artifactId') !== Object.hasOwn(record, 'artifactRevision')
  ) {
    invalid()
  }
  if (eventType === 'execution.disposition') {
    const validPair =
      (record.disposition === 'yielded' &&
        (record.reason === 'HUMAN_ACTIVITY' || record.reason === 'STALE_REVISION')) ||
      (record.disposition === 'repair' &&
        (record.reason === 'SNAPSHOT_REVISION_MISMATCH' ||
          record.reason === 'RESULT_REVISION_MISMATCH' ||
          record.reason === 'TOOL_FAILURE')) ||
      (record.disposition === 'paused' &&
        (record.reason === 'INDETERMINATE' ||
          record.reason === 'YIELD_LIMIT' ||
          record.reason === 'REPAIR_BUDGET_EXHAUSTED' ||
          record.reason === 'PERSISTENCE_FAILURE'))
    if (!validPair) invalid()
  }
  const normalized = {
    schemaVersion: 1,
    eventType,
    timestampMs: requireCount(record.timestampMs),
  }
  for (const key of ['durationMs', 'byteCount', 'status', 'errorCode', ...correlations]) {
    if (!Object.hasOwn(record, key)) continue
    const outputKey = key === 'resultRevision' ? 'projectRevision' : key
    normalized[outputKey] = validateField(outputKey, record[key])
  }
  normalized.sessionId = requireIdentifier(record.sessionId)
  normalized.taskId = requireIdentifier(record.taskId)
  return Object.freeze(normalized)
}

const normalizeDomainEvent = record => {
  const schema = DOMAIN_SCHEMAS[record.eventType]
  if (!schema) invalid()
  const allowed = new Set([...BASE_KEYS, ...schema.required, ...schema.optional])
  if (Reflect.ownKeys(record).some(key => typeof key !== 'string' || !allowed.has(key))) invalid()
  if (schema.required.some(key => !Object.hasOwn(record, key))) invalid()
  const normalized = {
    schemaVersion: 1,
    eventType: record.eventType,
    timestampMs: requireCount(record.timestampMs),
  }
  for (const key of [...schema.required, ...schema.optional]) {
    if (Object.hasOwn(record, key)) normalized[key] = validateField(key, record[key])
  }
  return Object.freeze(normalized)
}

const normalizeEvent = input => {
  const record = assertPlainDataRecord(input)
  if (record.schemaVersion !== 1 || typeof record.eventType !== 'string') invalid()
  return WORKER_EVENT_TYPES.has(record.eventType) ? normalizeWorkerEvent(record) : normalizeDomainEvent(record)
}

const taskKey = (sessionId, taskId) => `${sessionId}\u0000${taskId}`
const artifactKey = (artifactId, revisionType, revision) => `${artifactId}\u0000${revisionType}\u0000${revision}`

export const createDashboardAgentTelemetryLedger = ({ capacity = 2048 } = {}) => {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65_536) invalid()
  const events = []
  const eventTaskKeys = []
  const taskOwners = new Map()
  const stepOwners = new Map()
  const callOwners = new Map()
  const callStepOwners = new Map()
  const modelRequestOwners = new Map()
  const changeSetOwners = new Map()
  const callChangeSetOwners = new Map()
  const artifactRevisionOwners = new Map()
  const revisionIdentityOwners = new Map()
  const artifactOwners = new Map()
  let accepted = 0
  let dropped = 0
  let failed = 0

  const consistentOwner = (relations, id, owner) => {
    const current = relations.get(id)
    if (current !== undefined && current !== owner) invalid()
  }

  const validateAndRegisterLineage = event => {
    const hasTask = Object.hasOwn(event, 'taskId')
    if (!hasTask) return null
    const owner = taskKey(event.sessionId, event.taskId)
    consistentOwner(taskOwners, event.taskId, event.sessionId)

    const establishesTask =
      event.eventType === 'task.started' ||
      event.eventType === 'task.recovered' ||
      event.eventType === 'dashboard.snapshot.captured' ||
      event.eventType === 'dashboard.call.observed' ||
      event.eventType === 'dashboard.receipt.recovery'
    if (!establishesTask && taskOwners.get(event.taskId) !== event.sessionId) invalid()

    if (Object.hasOwn(event, 'stepId')) {
      consistentOwner(stepOwners, event.stepId, owner)
      const establishesStep = event.eventType === 'phase.started' || event.eventType === 'dashboard.call.observed'
      if (!establishesStep && stepOwners.get(event.stepId) !== owner) invalid()
    }

    if (Object.hasOwn(event, 'callId')) {
      consistentOwner(callOwners, event.callId, owner)
      if (Object.hasOwn(event, 'stepId')) consistentOwner(callStepOwners, event.callId, event.stepId)
      const establishesCall =
        event.eventType === 'tool-call.started' ||
        event.eventType === 'compensation.started' ||
        event.eventType === 'dashboard.call.observed' ||
        event.eventType === 'dashboard.receipt.recovery'
      if (!establishesCall && callOwners.get(event.callId) !== owner) invalid()
      if (!establishesCall && Object.hasOwn(event, 'stepId') && callStepOwners.get(event.callId) !== event.stepId) {
        invalid()
      }
    }

    if (Object.hasOwn(event, 'modelRequestId')) {
      consistentOwner(modelRequestOwners, event.modelRequestId, event.stepId)
      if (
        event.eventType !== 'model-request.started' &&
        modelRequestOwners.get(event.modelRequestId) !== event.stepId
      ) {
        invalid()
      }
    }
    if (Object.hasOwn(event, 'changeSetId')) {
      consistentOwner(changeSetOwners, event.changeSetId, event.callId)
      consistentOwner(callChangeSetOwners, event.callId, event.changeSetId)
    }
    if (Object.hasOwn(event, 'artifactId') && Object.hasOwn(event, 'callId')) {
      for (const [revisionType, revision] of [
        ['source', event.sourceRevision],
        ['artifact', event.artifactRevision],
      ]) {
        if (revision === undefined) continue
        consistentOwner(revisionIdentityOwners, `${revisionType}\u0000${revision}`, event.artifactId)
      }
    }

    taskOwners.set(event.taskId, event.sessionId)
    if (Object.hasOwn(event, 'stepId')) stepOwners.set(event.stepId, owner)
    if (Object.hasOwn(event, 'callId')) {
      callOwners.set(event.callId, owner)
      if (Object.hasOwn(event, 'stepId')) callStepOwners.set(event.callId, event.stepId)
    }
    if (Object.hasOwn(event, 'modelRequestId')) modelRequestOwners.set(event.modelRequestId, event.stepId)
    if (Object.hasOwn(event, 'changeSetId')) {
      changeSetOwners.set(event.changeSetId, event.callId)
      callChangeSetOwners.set(event.callId, event.changeSetId)
    }
    if (Object.hasOwn(event, 'artifactId') && Object.hasOwn(event, 'callId')) {
      const owners = artifactOwners.get(event.artifactId) ?? new Set()
      owners.add(event.callId)
      artifactOwners.set(event.artifactId, owners)
      if (event.sourceRevision !== undefined) {
        revisionIdentityOwners.set(`source\u0000${event.sourceRevision}`, event.artifactId)
        const key = artifactKey(event.artifactId, 'source', event.sourceRevision)
        const calls = artifactRevisionOwners.get(key) ?? new Set()
        calls.add(event.callId)
        artifactRevisionOwners.set(key, calls)
      }
      if (event.artifactRevision !== undefined) {
        revisionIdentityOwners.set(`artifact\u0000${event.artifactRevision}`, event.artifactId)
        const key = artifactKey(event.artifactId, 'artifact', event.artifactRevision)
        const calls = artifactRevisionOwners.get(key) ?? new Set()
        calls.add(event.callId)
        artifactRevisionOwners.set(key, calls)
      }
    }
    return owner
  }

  const append = input => {
    let event
    try {
      event = normalizeEvent(input)
      if (events.length >= capacity) {
        dropped += 1
        invalid()
      }
      const owner = validateAndRegisterLineage(event)
      events.push(event)
      eventTaskKeys.push(owner)
      accepted += 1
      return event
    } catch (error) {
      if (events.length < capacity || event === undefined) failed += 1
      throw error
    }
  }

  const record = input => {
    try {
      return append(input)
    } catch {
      return null
    }
  }

  const resolveTaskOwners = filter => {
    const candidates = []
    if (filter.taskId !== undefined) {
      const sessionId = taskOwners.get(filter.taskId)
      candidates.push(sessionId === undefined ? new Set() : new Set([taskKey(sessionId, filter.taskId)]))
    }
    if (filter.stepId !== undefined) {
      const owner = stepOwners.get(filter.stepId)
      candidates.push(owner === undefined ? new Set() : new Set([owner]))
    }
    if (filter.callId !== undefined) {
      const owner = callOwners.get(filter.callId)
      candidates.push(owner === undefined ? new Set() : new Set([owner]))
    }
    if (filter.modelRequestId !== undefined) {
      const stepId = modelRequestOwners.get(filter.modelRequestId)
      const owner = stepId === undefined ? undefined : stepOwners.get(stepId)
      candidates.push(owner === undefined ? new Set() : new Set([owner]))
    }
    if (filter.changeSetId !== undefined) {
      const callId = changeSetOwners.get(filter.changeSetId)
      const owner = callId === undefined ? undefined : callOwners.get(callId)
      candidates.push(owner === undefined ? new Set() : new Set([owner]))
    }
    if (filter.artifactId !== undefined) {
      let callIds
      if (filter.sourceRevision !== undefined) {
        callIds = [
          ...(artifactRevisionOwners.get(artifactKey(filter.artifactId, 'source', filter.sourceRevision)) ?? []),
        ]
      } else if (filter.artifactRevision !== undefined) {
        callIds = [
          ...(artifactRevisionOwners.get(artifactKey(filter.artifactId, 'artifact', filter.artifactRevision)) ?? []),
        ]
      } else callIds = [...(artifactOwners.get(filter.artifactId) ?? [])]
      candidates.push(new Set(callIds.map(callId => callOwners.get(callId)).filter(Boolean)))
    }
    if (candidates.length === 0) return null
    const [first, ...rest] = candidates
    return new Set([...first].filter(owner => rest.every(candidate => candidate.has(owner))))
  }

  const query = input => {
    const filter = assertPlainDataRecord(input)
    const keys = Reflect.ownKeys(filter)
    if (keys.length === 0 || keys.some(key => typeof key !== 'string' || !QUERY_KEYS.has(key))) invalid()
    for (const key of keys) {
      if (key === 'eventType') {
        if (
          typeof filter.eventType !== 'string' ||
          (!WORKER_EVENT_TYPES.has(filter.eventType) && !DOMAIN_SCHEMAS[filter.eventType])
        ) {
          invalid()
        }
      } else if (key === 'changeSetId') requireChangeSetId(filter[key])
      else requireIdentifier(filter[key])
    }
    if (
      (filter.sourceRevision !== undefined || filter.artifactRevision !== undefined) &&
      filter.artifactId === undefined
    ) {
      invalid()
    }
    const resolvedOwners = resolveTaskOwners(filter)
    return Object.freeze(
      events.filter((event, index) => {
        if (filter.sessionId !== undefined && event.sessionId !== filter.sessionId) return false
        if (filter.eventType !== undefined && event.eventType !== filter.eventType) return false
        if (resolvedOwners !== null) return resolvedOwners.has(eventTaskKeys[index])
        return filter.sessionId !== undefined || filter.eventType !== undefined
      }),
    )
  }

  const stats = () => Object.freeze({ capacity, size: events.length, accepted, dropped, failed })
  const sink = Object.freeze({
    emit(input) {
      record(input)
    },
  })
  return Object.freeze({ append, record, query, stats, sink })
}
