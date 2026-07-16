import type {
  AgentPersistenceBatch,
  AgentRuntimeFailure,
  CapabilitySchema,
  CapabilitySchemaRequest,
  HostInvocationContextV1,
  HostSnapshot,
  HostSnapshotDelta,
  InvocationResult,
  JsonObject,
  JsonValue,
  ObserveRequest,
  PersistenceCommitResult,
  PersistenceReadRequest,
  PersistenceReadResult,
  PersistenceRecord,
  ReceiptQueryRequest,
  RuntimeTaskCompensationTargetV1,
  SemanticCall,
  ToolReceipt,
} from '../../contracts.js'
import { ProtocolValidationError, assertExactFields, assertJsonValue } from '../protocol/index.js'
import {
  parseHostSnapshotDelta as parseSnapshotDeltaResponse,
  parseHostSnapshot as parseSnapshotResponse,
} from '../snapshot/index.js'

type RuntimeTaskCallIndexEntryV1 = RuntimeTaskCompensationTargetV1['callIndex'][number]

export interface RpcValueContract<Request = unknown, Response = unknown> {
  readonly parseRequest: (value: unknown) => Request
  readonly parseResponse: (value: unknown) => Response
}

export type RpcContractMap = Readonly<Record<string, RpcValueContract>>

export type RpcContractRequest<Contract> = Contract extends RpcValueContract<infer Request, unknown> ? Request : never

export type RpcContractResponse<Contract> = Contract extends RpcValueContract<unknown, infer Response>
  ? Response
  : never

const fail = (message: string): never => {
  throw new ProtocolValidationError('invalid-field', message)
}

const stringField = (value: unknown, field: string) =>
  typeof value === 'string' && value.length > 0 ? value : fail(`${field} must be a non-empty string`)

const finiteNumberField = (value: unknown, field: string) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fail(`${field} must be a finite number`)

const integerField = (value: unknown, field: string) => {
  const number = finiteNumberField(value, field)
  return Number.isInteger(number) && number >= 0 ? number : fail(`${field} must be a non-negative integer`)
}

const literalField = <Value extends string | number>(
  value: unknown,
  expected: readonly Value[],
  field: string,
): Value => (expected.includes(value as Value) ? (value as Value) : fail(`${field} has an unsupported value`))

const schemaVersion = (value: unknown, field = 'schemaVersion') => {
  if (value !== 1) fail(`${field} must equal 1`)
}

const optionalStringField = (value: unknown, field: string) => {
  if (value !== undefined) stringField(value, field)
}

function arrayField(value: unknown, field: string): asserts value is unknown[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`)
}

const jsonObjectField = (value: unknown, field: string): JsonObject => {
  assertJsonValue(value, field)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${field} must be an object`)
  return value as JsonObject
}

const parseFailure = (value: unknown, field = 'failure'): AgentRuntimeFailure => {
  assertExactFields(value, ['code', 'message', 'retryable'], ['details'], field)
  stringField(value.code, `${field}.code`)
  stringField(value.message, `${field}.message`)
  if (typeof value.retryable !== 'boolean') fail(`${field}.retryable must be boolean`)
  if (value.details !== undefined) jsonObjectField(value.details, `${field}.details`)
  return value as unknown as AgentRuntimeFailure
}

const parseOutcomeFailure = (status: unknown, failure: unknown, field: string) => {
  if (status === 'applied') {
    if (failure !== undefined) fail(`${field} must be absent when status is applied`)
    return
  }
  if (failure === undefined) fail(`${field} is required when status is not applied`)
  parseFailure(failure, field)
}

const parsePersistenceRecord = (value: unknown, field: string): PersistenceRecord => {
  assertExactFields(value, ['recordId', 'kind', 'value'], [], field)
  stringField(value.recordId, `${field}.recordId`)
  stringField(value.kind, `${field}.kind`)
  assertJsonValue(value.value, `${field}.value`)
  return value as unknown as PersistenceRecord
}

const parseRecords = (value: unknown, field: string): readonly PersistenceRecord[] => {
  arrayField(value, field)
  return value.map((entry, index) => parsePersistenceRecord(entry, `${field}[${index}]`))
}

export const parseObserveRequest = (value: unknown): ObserveRequest => {
  assertExactFields(
    value,
    ['schemaVersion', 'projectId', 'branchId', 'sessionId', 'taskId', 'mode'],
    ['cursor'],
    'ObserveRequest',
  )
  schemaVersion(value.schemaVersion)
  stringField(value.projectId, 'ObserveRequest.projectId')
  stringField(value.branchId, 'ObserveRequest.branchId')
  stringField(value.sessionId, 'ObserveRequest.sessionId')
  stringField(value.taskId, 'ObserveRequest.taskId')
  literalField(value.mode, ['full', 'delta'], 'ObserveRequest.mode')
  optionalStringField(value.cursor, 'ObserveRequest.cursor')
  return value as unknown as ObserveRequest
}

export const parseObserveResponse = (value: unknown): HostSnapshot | HostSnapshotDelta => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('observe response must be an object')
  return Object.hasOwn(value as object, 'projection') ? parseSnapshotResponse(value) : parseSnapshotDeltaResponse(value)
}

export const parseCapabilitySchemaRequest = (value: unknown): CapabilitySchemaRequest => {
  assertExactFields(value, ['schemaVersion', 'projectId', 'branchId', 'capability'], [], 'CapabilitySchemaRequest')
  schemaVersion(value.schemaVersion)
  stringField(value.projectId, 'CapabilitySchemaRequest.projectId')
  stringField(value.branchId, 'CapabilitySchemaRequest.branchId')
  stringField(value.capability, 'CapabilitySchemaRequest.capability')
  return value as unknown as CapabilitySchemaRequest
}

export const parseCapabilitySchema = (value: unknown): CapabilitySchema => {
  assertExactFields(value, ['schemaVersion', 'capability', 'revision', 'input'], ['output'], 'CapabilitySchema')
  schemaVersion(value.schemaVersion)
  stringField(value.capability, 'CapabilitySchema.capability')
  stringField(value.revision, 'CapabilitySchema.revision')
  jsonObjectField(value.input, 'CapabilitySchema.input')
  if (value.output !== undefined) jsonObjectField(value.output, 'CapabilitySchema.output')
  return value as unknown as CapabilitySchema
}

export const parseSemanticCall = (value: unknown): SemanticCall => {
  assertExactFields(
    value,
    [
      'schemaVersion',
      'projectId',
      'branchId',
      'sessionId',
      'taskId',
      'stepId',
      'callId',
      'capability',
      'arguments',
      'expectedRevision',
    ],
    [],
    'SemanticCall',
  )
  schemaVersion(value.schemaVersion)
  for (const field of [
    'projectId',
    'branchId',
    'sessionId',
    'taskId',
    'stepId',
    'callId',
    'capability',
    'expectedRevision',
  ] as const) {
    stringField(value[field], `SemanticCall.${field}`)
  }
  jsonObjectField(value.arguments, 'SemanticCall.arguments')
  return value as unknown as SemanticCall
}

const parseRuntimeTaskCallIndexEntry = (value: unknown, field: string): RuntimeTaskCallIndexEntryV1 => {
  assertExactFields(value, ['callId', 'capability'], [], field)
  stringField(value.callId, `${field}.callId`)
  stringField(value.capability, `${field}.capability`)
  if (value.capability === 'task.compensate') {
    fail(`${field}.capability cannot contain task.compensate`)
  }
  return value as unknown as RuntimeTaskCallIndexEntryV1
}

const parseRuntimeTaskCompensationTarget = (value: unknown): RuntimeTaskCompensationTargetV1 => {
  assertExactFields(
    value,
    ['schemaVersion', 'taskId', 'sessionId', 'phase', 'callIndexComplete', 'callIndex'],
    [],
    'RuntimeTaskCompensationTargetV1',
  )
  schemaVersion(value.schemaVersion, 'RuntimeTaskCompensationTargetV1.schemaVersion')
  stringField(value.taskId, 'RuntimeTaskCompensationTargetV1.taskId')
  stringField(value.sessionId, 'RuntimeTaskCompensationTargetV1.sessionId')
  literalField(value.phase, ['COMPLETED', 'CANCELLED'], 'RuntimeTaskCompensationTargetV1.phase')
  if (value.callIndexComplete !== true) {
    fail('RuntimeTaskCompensationTargetV1.callIndexComplete must equal true')
  }
  arrayField(value.callIndex, 'RuntimeTaskCompensationTargetV1.callIndex')
  const callIds = new Set<string>()
  value.callIndex.forEach((entry, index) => {
    const parsed = parseRuntimeTaskCallIndexEntry(entry, `RuntimeTaskCompensationTargetV1.callIndex[${index}]`)
    if (callIds.has(parsed.callId)) fail('RuntimeTaskCompensationTargetV1.callIndex callId values must be unique')
    callIds.add(parsed.callId)
  })
  return value as unknown as RuntimeTaskCompensationTargetV1
}

export const parseHostInvocationContext = (value: unknown): HostInvocationContextV1 => {
  assertExactFields(value, ['schemaVersion'], ['compensationTarget'], 'HostInvocationContextV1')
  schemaVersion(value.schemaVersion, 'HostInvocationContextV1.schemaVersion')
  if (value.compensationTarget !== undefined) parseRuntimeTaskCompensationTarget(value.compensationTarget)
  return value as unknown as HostInvocationContextV1
}

export interface HostInvokeRequestV1 {
  readonly schemaVersion: 1
  readonly call: SemanticCall
  readonly context: HostInvocationContextV1
}

export const parseHostInvokeRequest = (value: unknown): HostInvokeRequestV1 => {
  assertExactFields(value, ['schemaVersion', 'call', 'context'], [], 'HostInvokeRequestV1')
  schemaVersion(value.schemaVersion, 'HostInvokeRequestV1.schemaVersion')
  const call = parseSemanticCall(value.call)
  const context = parseHostInvocationContext(value.context)
  const target = context.compensationTarget
  if (call.capability === 'task.compensate') {
    assertExactFields(call.arguments, ['schemaVersion', 'targetTaskId'], [], 'task.compensate arguments')
    schemaVersion(call.arguments.schemaVersion, 'task.compensate arguments.schemaVersion')
    const targetTaskId = stringField(call.arguments.targetTaskId, 'task.compensate arguments.targetTaskId')
    const compensationTarget =
      target ?? fail('HostInvocationContextV1.compensationTarget is required for task.compensate')
    if (compensationTarget.sessionId !== call.sessionId) {
      fail('compensation target sessionId must match SemanticCall.sessionId')
    }
    if (compensationTarget.taskId !== targetTaskId) {
      fail('compensation target taskId must match task.compensate targetTaskId')
    }
    if (compensationTarget.taskId === call.taskId) fail('task.compensate cannot target the current task')
  } else if (target) {
    fail('HostInvocationContextV1.compensationTarget is only allowed for task.compensate')
  }
  return value as unknown as HostInvokeRequestV1
}

export const parseInvocationResult = (value: unknown): InvocationResult => {
  assertExactFields(value, ['schemaVersion', 'callId', 'status'], ['revision', 'output', 'failure'], 'InvocationResult')
  schemaVersion(value.schemaVersion)
  stringField(value.callId, 'InvocationResult.callId')
  literalField(value.status, ['applied', 'not-applied', 'indeterminate', 'rejected'], 'InvocationResult.status')
  optionalStringField(value.revision, 'InvocationResult.revision')
  if (value.output !== undefined) assertJsonValue(value.output, 'InvocationResult.output')
  parseOutcomeFailure(value.status, value.failure, 'InvocationResult.failure')
  return value as unknown as InvocationResult
}

export const parseReceiptQueryRequest = (value: unknown): ReceiptQueryRequest => {
  assertExactFields(value, ['projectId', 'branchId', 'callId'], [], 'ReceiptQueryRequest')
  stringField(value.projectId, 'ReceiptQueryRequest.projectId')
  stringField(value.branchId, 'ReceiptQueryRequest.branchId')
  stringField(value.callId, 'ReceiptQueryRequest.callId')
  return value as unknown as ReceiptQueryRequest
}

export const parseToolReceipt = (value: unknown): ToolReceipt | null => {
  if (value === null) return null
  assertExactFields(
    value,
    ['schemaVersion', 'projectId', 'branchId', 'callId', 'status'],
    ['revision', 'witness', 'failure'],
    'ToolReceipt',
  )
  schemaVersion(value.schemaVersion)
  stringField(value.projectId, 'ToolReceipt.projectId')
  stringField(value.branchId, 'ToolReceipt.branchId')
  stringField(value.callId, 'ToolReceipt.callId')
  literalField(value.status, ['applied', 'not-applied', 'indeterminate', 'rejected'], 'ToolReceipt.status')
  optionalStringField(value.revision, 'ToolReceipt.revision')
  if (value.witness !== undefined) jsonObjectField(value.witness, 'ToolReceipt.witness')
  parseOutcomeFailure(value.status, value.failure, 'ToolReceipt.failure')
  return value as unknown as ToolReceipt
}

export const parsePersistenceReadRequest = (value: unknown): PersistenceReadRequest => {
  assertExactFields(
    value,
    ['schemaVersion', 'projectId', 'branchId', 'sessionId', 'expectedPersistenceGeneration'],
    [],
    'PersistenceReadRequest',
  )
  schemaVersion(value.schemaVersion)
  stringField(value.projectId, 'PersistenceReadRequest.projectId')
  stringField(value.branchId, 'PersistenceReadRequest.branchId')
  stringField(value.sessionId, 'PersistenceReadRequest.sessionId')
  integerField(value.expectedPersistenceGeneration, 'PersistenceReadRequest.expectedPersistenceGeneration')
  return value as unknown as PersistenceReadRequest
}

export const parsePersistenceReadResult = (value: unknown): PersistenceReadResult => {
  assertExactFields(
    value,
    ['schemaVersion', 'projectId', 'branchId', 'sessionId', 'persistenceGeneration', 'records'],
    [],
    'PersistenceReadResult',
  )
  schemaVersion(value.schemaVersion)
  stringField(value.projectId, 'PersistenceReadResult.projectId')
  stringField(value.branchId, 'PersistenceReadResult.branchId')
  stringField(value.sessionId, 'PersistenceReadResult.sessionId')
  integerField(value.persistenceGeneration, 'PersistenceReadResult.persistenceGeneration')
  parseRecords(value.records, 'PersistenceReadResult.records')
  return value as unknown as PersistenceReadResult
}

export const parsePersistenceBatch = (value: unknown): AgentPersistenceBatch => {
  assertExactFields(
    value,
    ['schemaVersion', 'projectId', 'branchId', 'sessionId', 'batchId', 'expectedPersistenceGeneration', 'records'],
    [],
    'AgentPersistenceBatch',
  )
  schemaVersion(value.schemaVersion)
  stringField(value.projectId, 'AgentPersistenceBatch.projectId')
  stringField(value.branchId, 'AgentPersistenceBatch.branchId')
  stringField(value.sessionId, 'AgentPersistenceBatch.sessionId')
  stringField(value.batchId, 'AgentPersistenceBatch.batchId')
  integerField(value.expectedPersistenceGeneration, 'AgentPersistenceBatch.expectedPersistenceGeneration')
  parseRecords(value.records, 'AgentPersistenceBatch.records')
  return value as unknown as AgentPersistenceBatch
}

export const parsePersistenceCommitResult = (value: unknown): PersistenceCommitResult => {
  assertExactFields(
    value,
    ['schemaVersion', 'batchId', 'status', 'persistenceGeneration'],
    ['failure'],
    'PersistenceCommitResult',
  )
  schemaVersion(value.schemaVersion)
  stringField(value.batchId, 'PersistenceCommitResult.batchId')
  literalField(value.status, ['committed', 'generation-conflict', 'rejected'], 'PersistenceCommitResult.status')
  integerField(value.persistenceGeneration, 'PersistenceCommitResult.persistenceGeneration')
  if (value.failure !== undefined) parseFailure(value.failure, 'PersistenceCommitResult.failure')
  return value as unknown as PersistenceCommitResult
}

export const agentBoundaryRpcContracts = {
  'host.observe': { parseRequest: parseObserveRequest, parseResponse: parseObserveResponse },
  'host.describeCapability': {
    parseRequest: parseCapabilitySchemaRequest,
    parseResponse: parseCapabilitySchema,
  },
  'host.invoke': { parseRequest: parseHostInvokeRequest, parseResponse: parseInvocationResult },
  'host.queryReceipt': { parseRequest: parseReceiptQueryRequest, parseResponse: parseToolReceipt },
  'persistence.read': {
    parseRequest: parsePersistenceReadRequest,
    parseResponse: parsePersistenceReadResult,
  },
  'persistence.commit': {
    parseRequest: parsePersistenceBatch,
    parseResponse: parsePersistenceCommitResult,
  },
} as const satisfies RpcContractMap

export const jsonValueRpcContract: RpcValueContract<JsonValue, JsonValue> = {
  parseRequest(value) {
    assertJsonValue(value, 'rpc request value')
    return value
  },
  parseResponse(value) {
    assertJsonValue(value, 'rpc response value')
    return value
  },
}
