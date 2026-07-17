export const AGENT_RUNTIME_E2E_RECOVERY_STORAGE_KEY = 'easy-editor:agent-runtime:e2e-recoveries:v1'

const EMPTY_RECOVERIES = Object.freeze([])
const APPLIED_UNDURABLE_FIELDS = Object.freeze(['callId', 'kind', 'message', 'occurredAt', 'recoveryId', 'taskId'])
const COMPENSATION_CONFLICT_FIELDS = Object.freeze([
  'conflictPaths',
  'kind',
  'message',
  'occurredAt',
  'recoveryId',
  'taskId',
])

export class AgentRuntimeE2ERecoveryConfigError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'AgentRuntimeE2ERecoveryConfigError'
    this.code = code
  }
}

const invalidRecoveries = (message, cause) =>
  new AgentRuntimeE2ERecoveryConfigError(
    'invalid-recoveries',
    `Agent Runtime E2E recoveries stored at ${AGENT_RUNTIME_E2E_RECOVERY_STORAGE_KEY} are invalid: ${message}`,
    cause === undefined ? undefined : { cause },
  )

const requireRecord = (value, label) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRecoveries(`${label} must be an object`)
  }
  return value
}

const assertExactFields = (value, fields, label) => {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw invalidRecoveries(`${label} fields must exactly match ${expected.join(',')}`)
  }
}

const requireString = (value, label) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidRecoveries(`${label} must be a non-empty string`)
  }
  return value
}

const requireTime = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidRecoveries(`${label} must be a non-negative safe integer`)
  }
  return value
}

const normalizeConflictPaths = (value, label) => {
  if (!Array.isArray(value)) throw invalidRecoveries(`${label} must be an array`)
  const normalized = value.map((path, index) => requireString(path, `${label}[${index}]`))
  if (new Set(normalized).size !== normalized.length) throw invalidRecoveries(`${label} must not contain duplicates`)
  return Object.freeze(normalized.sort())
}

const normalizeRecovery = (value, index) => {
  const record = requireRecord(value, `recoveries[${index}]`)
  if (record.kind === 'applied-undurable') {
    assertExactFields(record, APPLIED_UNDURABLE_FIELDS, `recoveries[${index}]`)
    return Object.freeze({
      kind: 'applied-undurable',
      recoveryId: requireString(record.recoveryId, `recoveries[${index}].recoveryId`),
      taskId: requireString(record.taskId, `recoveries[${index}].taskId`),
      callId: requireString(record.callId, `recoveries[${index}].callId`),
      message: requireString(record.message, `recoveries[${index}].message`),
      occurredAt: requireTime(record.occurredAt, `recoveries[${index}].occurredAt`),
    })
  }
  if (record.kind === 'compensation-conflict') {
    assertExactFields(record, COMPENSATION_CONFLICT_FIELDS, `recoveries[${index}]`)
    return Object.freeze({
      kind: 'compensation-conflict',
      recoveryId: requireString(record.recoveryId, `recoveries[${index}].recoveryId`),
      taskId: requireString(record.taskId, `recoveries[${index}].taskId`),
      message: requireString(record.message, `recoveries[${index}].message`),
      occurredAt: requireTime(record.occurredAt, `recoveries[${index}].occurredAt`),
      conflictPaths: normalizeConflictPaths(record.conflictPaths, `recoveries[${index}].conflictPaths`),
    })
  }
  throw invalidRecoveries(`recoveries[${index}].kind is unsupported`)
}

const compareRecovery = (left, right) =>
  left.occurredAt - right.occurredAt ||
  (left.recoveryId < right.recoveryId ? -1 : left.recoveryId > right.recoveryId ? 1 : 0)

export const parseAgentRuntimeE2ERecoveriesJson = source => {
  if (typeof source !== 'string') {
    throw new AgentRuntimeE2ERecoveryConfigError(
      'invalid-json',
      `Agent Runtime E2E recoveries at ${AGENT_RUNTIME_E2E_RECOVERY_STORAGE_KEY} must be a JSON string`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(source)
  } catch (cause) {
    throw new AgentRuntimeE2ERecoveryConfigError(
      'invalid-json',
      `Agent Runtime E2E recoveries at ${AGENT_RUNTIME_E2E_RECOVERY_STORAGE_KEY} are not valid JSON`,
      { cause },
    )
  }
  if (!Array.isArray(parsed)) throw invalidRecoveries('the top-level value must be an array')
  const normalized = parsed.map(normalizeRecovery)
  const ids = normalized.map(recovery => recovery.recoveryId)
  if (new Set(ids).size !== ids.length) throw invalidRecoveries('recoveryId values must be unique')
  return Object.freeze(normalized.sort(compareRecovery))
}

export const readAgentRuntimeE2ERecoveries = storage => {
  const source = storage ?? globalThis.sessionStorage
  if (!source || typeof source.getItem !== 'function') {
    throw new AgentRuntimeE2ERecoveryConfigError(
      'storage-read-failed',
      'Agent Runtime E2E recoveries require an available sessionStorage implementation',
    )
  }
  let serialized
  try {
    serialized = source.getItem(AGENT_RUNTIME_E2E_RECOVERY_STORAGE_KEY)
  } catch (cause) {
    throw new AgentRuntimeE2ERecoveryConfigError(
      'storage-read-failed',
      `Agent Runtime E2E recoveries could not be read from ${AGENT_RUNTIME_E2E_RECOVERY_STORAGE_KEY}`,
      { cause },
    )
  }
  return serialized === null ? EMPTY_RECOVERIES : parseAgentRuntimeE2ERecoveriesJson(serialized)
}

const bindingKey = binding => {
  const record = requireRecord(binding, 'binding')
  return [
    requireString(record.projectId, 'binding.projectId'),
    requireString(record.branchId, 'binding.branchId'),
    requireString(record.sessionId, 'binding.sessionId'),
  ].join('\u0000')
}

const actionMatches = (recovery, action) =>
  (recovery.kind === 'applied-undurable' && action === 'retry-durability') ||
  (recovery.kind === 'compensation-conflict' && action === 'refresh-conflict-report')

export const createAgentRuntimeE2ERecoveryBridge = recoveries => {
  const normalized = parseAgentRuntimeE2ERecoveriesJson(JSON.stringify(recoveries))
  const pending = new Map(normalized.map(recovery => [recovery.recoveryId, recovery]))
  let authorityKey = null

  return Object.freeze({
    async list(input) {
      const record = requireRecord(input, 'list')
      const currentKey = bindingKey(record.binding)
      if (authorityKey === null) authorityKey = currentKey
      if (authorityKey !== currentKey) return EMPTY_RECOVERIES
      return Object.freeze([...pending.values()].sort(compareRecovery))
    },
    async retry(input) {
      const record = requireRecord(input, 'retry')
      const currentKey = bindingKey(record.binding)
      if (authorityKey === null) authorityKey = currentKey
      if (authorityKey !== currentKey) throw invalidRecoveries('retry binding does not match the recovery authority')
      const recoveryId = requireString(record.recoveryId, 'retry.recoveryId')
      const recovery = pending.get(recoveryId)
      if (!recovery) throw invalidRecoveries(`recovery ${recoveryId} does not exist`)
      if (record.kind !== recovery.kind) throw invalidRecoveries(`recovery ${recoveryId} kind does not match`)
      if (!actionMatches(recovery, record.action)) {
        throw invalidRecoveries(`recovery ${recoveryId} action does not match ${recovery.kind}`)
      }
      if (recovery.kind === 'applied-undurable') pending.delete(recoveryId)
    },
  })
}
