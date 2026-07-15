import type {
  AgentPersistenceBatch,
  AgentRuntimeFailure,
  CapabilitySchema,
  CapabilitySchemaRequest,
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
  SemanticCall,
  ToolReceipt,
} from '../../contracts.js'
import { ProtocolValidationError, assertExactFields, assertJsonValue } from '../protocol/index.js'

export interface RpcValueContract<Request = unknown, Response = unknown> {
  readonly parseRequest: (value: unknown) => Request
  readonly parseResponse: (value: unknown) => Response
}

export type RpcContractMap = Readonly<Record<string, RpcValueContract>>

export type RpcContractRequest<Contract> = Contract extends RpcValueContract<infer Request, unknown>
  ? Request
  : never

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

const parsePersistenceRecord = (value: unknown, field: string): PersistenceRecord => {
  assertExactFields(value, ['recordId', 'kind', 'value'], [], field)
  stringField(value.recordId, `${field}.recordId`)
  stringField(value.kind, `${field}.kind`)
  assertJsonValue(value.value, `${field}.value`)
  return value as unknown as PersistenceRecord
}

const parseRecords = (value: unknown, field: string): readonly PersistenceRecord[] => {
  if (!Array.isArray(value)) fail(`${field} must be an array`)
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

const parseHostSnapshot = (value: unknown): HostSnapshot => {
  assertExactFields(value, ['schemaVersion', 'revision', 'projection'], ['cursor'], 'HostSnapshot')
  schemaVersion(value.schemaVersion)
  stringField(value.revision, 'HostSnapshot.revision')
  optionalStringField(value.cursor, 'HostSnapshot.cursor')
  jsonObjectField(value.projection, 'HostSnapshot.projection')
  return value as unknown as HostSnapshot
}

const parseHostSnapshotDelta = (value: unknown): HostSnapshotDelta => {
  assertExactFields(
    value,
    [
      'schemaVersion',
      'baseRevision',
      'newRevision',
      'providerId',
      'providerGeneration',
      'baseCursor',
      'newCursor',
      'changes',
    ],
    [],
    'HostSnapshotDelta',
  )
  schemaVersion(value.schemaVersion)
  for (const field of ['baseRevision', 'newRevision', 'providerId', 'baseCursor', 'newCursor'] as const) {
    stringField(value[field], `HostSnapshotDelta.${field}`)
  }
  integerField(value.providerGeneration, 'HostSnapshotDelta.providerGeneration')
  if (!Array.isArray(value.changes)) fail('HostSnapshotDelta.changes must be an array')
  value.changes.forEach((change, index) => jsonObjectField(change, `HostSnapshotDelta.changes[${index}]`))
  return value as unknown as HostSnapshotDelta
}

export const parseObserveResponse = (value: unknown): HostSnapshot | HostSnapshotDelta => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('observe response must be an object')
  return Object.hasOwn(value, 'projection') ? parseHostSnapshot(value) : parseHostSnapshotDelta(value)
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

export const parseInvocationResult = (value: unknown): InvocationResult => {
  assertExactFields(value, ['schemaVersion', 'callId', 'status'], ['revision', 'output', 'failure'], 'InvocationResult')
  schemaVersion(value.schemaVersion)
  stringField(value.callId, 'InvocationResult.callId')
  literalField(value.status, ['applied', 'not-applied', 'indeterminate', 'rejected'], 'InvocationResult.status')
  optionalStringField(value.revision, 'InvocationResult.revision')
  if (value.output !== undefined) assertJsonValue(value.output, 'InvocationResult.output')
  if (value.failure !== undefined) parseFailure(value.failure, 'InvocationResult.failure')
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
    ['revision', 'witness'],
    'ToolReceipt',
  )
  schemaVersion(value.schemaVersion)
  stringField(value.projectId, 'ToolReceipt.projectId')
  stringField(value.branchId, 'ToolReceipt.branchId')
  stringField(value.callId, 'ToolReceipt.callId')
  literalField(value.status, ['applied', 'not-applied', 'indeterminate', 'rejected'], 'ToolReceipt.status')
  optionalStringField(value.revision, 'ToolReceipt.revision')
  if (value.witness !== undefined) jsonObjectField(value.witness, 'ToolReceipt.witness')
  return value as unknown as ToolReceipt
}

export const parsePersistenceReadRequest = (value: unknown): PersistenceReadRequest => {
  assertExactFields(
    value,
    ['schemaVersion', 'projectId', 'branchId', 'sessionId', 'expectedDraftGeneration'],
    [],
    'PersistenceReadRequest',
  )
  schemaVersion(value.schemaVersion)
  stringField(value.projectId, 'PersistenceReadRequest.projectId')
  stringField(value.branchId, 'PersistenceReadRequest.branchId')
  stringField(value.sessionId, 'PersistenceReadRequest.sessionId')
  integerField(value.expectedDraftGeneration, 'PersistenceReadRequest.expectedDraftGeneration')
  return value as unknown as PersistenceReadRequest
}

export const parsePersistenceReadResult = (value: unknown): PersistenceReadResult => {
  assertExactFields(
    value,
    ['schemaVersion', 'projectId', 'branchId', 'sessionId', 'draftGeneration', 'records'],
    [],
    'PersistenceReadResult',
  )
  schemaVersion(value.schemaVersion)
  stringField(value.projectId, 'PersistenceReadResult.projectId')
  stringField(value.branchId, 'PersistenceReadResult.branchId')
  stringField(value.sessionId, 'PersistenceReadResult.sessionId')
  integerField(value.draftGeneration, 'PersistenceReadResult.draftGeneration')
  parseRecords(value.records, 'PersistenceReadResult.records')
  return value as unknown as PersistenceReadResult
}

export const parsePersistenceBatch = (value: unknown): AgentPersistenceBatch => {
  assertExactFields(
    value,
    [
      'schemaVersion',
      'projectId',
      'branchId',
      'sessionId',
      'batchId',
      'expectedDraftGeneration',
      'records',
    ],
    [],
    'AgentPersistenceBatch',
  )
  schemaVersion(value.schemaVersion)
  stringField(value.projectId, 'AgentPersistenceBatch.projectId')
  stringField(value.branchId, 'AgentPersistenceBatch.branchId')
  stringField(value.sessionId, 'AgentPersistenceBatch.sessionId')
  stringField(value.batchId, 'AgentPersistenceBatch.batchId')
  integerField(value.expectedDraftGeneration, 'AgentPersistenceBatch.expectedDraftGeneration')
  parseRecords(value.records, 'AgentPersistenceBatch.records')
  return value as unknown as AgentPersistenceBatch
}

export const parsePersistenceCommitResult = (value: unknown): PersistenceCommitResult => {
  assertExactFields(
    value,
    ['schemaVersion', 'batchId', 'status', 'draftGeneration'],
    ['failure'],
    'PersistenceCommitResult',
  )
  schemaVersion(value.schemaVersion)
  stringField(value.batchId, 'PersistenceCommitResult.batchId')
  literalField(value.status, ['committed', 'generation-conflict', 'rejected'], 'PersistenceCommitResult.status')
  integerField(value.draftGeneration, 'PersistenceCommitResult.draftGeneration')
  if (value.failure !== undefined) parseFailure(value.failure, 'PersistenceCommitResult.failure')
  return value as unknown as PersistenceCommitResult
}

export const agentBoundaryRpcContracts = {
  'host.observe': { parseRequest: parseObserveRequest, parseResponse: parseObserveResponse },
  'host.describeCapability': {
    parseRequest: parseCapabilitySchemaRequest,
    parseResponse: parseCapabilitySchema,
  },
  'host.invoke': { parseRequest: parseSemanticCall, parseResponse: parseInvocationResult },
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
