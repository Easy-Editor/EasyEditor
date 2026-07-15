import type {
  AgentPhase,
  AgentQuestion,
  AgentRuntimeBinding,
  AgentRuntimeFailure,
  AgentRuntimeSnapshot,
  AgentRuntimeStatus,
  AgentTaskSnapshot,
  BoundAgentRuntimeBinding,
  JsonObject,
  TaskRef,
  UserIntent,
  UserResponse,
} from '../../contracts.js'
import { assertExactFields, assertJsonValue } from '../protocol/index.js'
import { type RpcContractMap, agentBoundaryRpcContracts } from '../rpc/index.js'

const fail = (message: string): never => {
  throw new TypeError(message)
}

const stringField = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${field} must be a non-empty string`)
}

const finiteNumberField = (value: unknown, field: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} must be a finite number`)
}

const enumField = <Value extends string>(value: unknown, values: readonly Value[], field: string) => {
  if (typeof value !== 'string' || !values.includes(value as Value)) fail(`${field} is invalid`)
}

const jsonObjectField = (value: unknown, field: string): JsonObject => {
  assertJsonValue(value, field)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${field} must be an object`)
  return value as JsonObject
}

const nullValue = (value: unknown): null => (value === null ? null : fail('value must be null'))

const AGENT_PHASES = [
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
] as const satisfies readonly AgentPhase[]

const RUNTIME_STATUSES = [
  'initializing',
  'ready',
  'recovering',
  'disposed',
  'failed',
] as const satisfies readonly AgentRuntimeStatus[]

export interface RuntimeInitializeRequest {
  readonly binding: Required<AgentRuntimeBinding>
  readonly recover: boolean
}

const parseBinding = (value: unknown, field: string): BoundAgentRuntimeBinding => {
  assertExactFields(value, ['projectId', 'branchId', 'sessionId'], [], field)
  for (const key of ['projectId', 'branchId', 'sessionId'] as const) stringField(value[key], `${field}.${key}`)
  return value as unknown as BoundAgentRuntimeBinding
}

const parseFailure = (value: unknown, field: string): AgentRuntimeFailure => {
  assertExactFields(value, ['code', 'message', 'retryable'], ['details'], field)
  stringField(value.code, `${field}.code`)
  stringField(value.message, `${field}.message`)
  if (typeof value.retryable !== 'boolean') fail(`${field}.retryable must be boolean`)
  if (value.details !== undefined) jsonObjectField(value.details, `${field}.details`)
  return value as unknown as AgentRuntimeFailure
}

const parseQuestion = (value: unknown, field: string): AgentQuestion => {
  assertExactFields(value, ['questionId', 'prompt'], ['responseSchema'], field)
  stringField(value.questionId, `${field}.questionId`)
  stringField(value.prompt, `${field}.prompt`)
  if (value.responseSchema !== undefined) jsonObjectField(value.responseSchema, `${field}.responseSchema`)
  return value as unknown as AgentQuestion
}

const parseTaskSnapshot = (value: unknown, field: string): AgentTaskSnapshot => {
  assertExactFields(
    value,
    ['taskId', 'sessionId', 'phase', 'createdAt', 'updatedAt', 'repairAttempts'],
    ['parentTaskId', 'supersedesTaskId', 'question', 'failure'],
    field,
  )
  for (const key of ['taskId', 'sessionId'] as const) stringField(value[key], `${field}.${key}`)
  for (const key of ['parentTaskId', 'supersedesTaskId'] as const) {
    if (value[key] !== undefined) stringField(value[key], `${field}.${key}`)
  }
  enumField(value.phase, AGENT_PHASES, `${field}.phase`)
  for (const key of ['createdAt', 'updatedAt', 'repairAttempts'] as const) {
    finiteNumberField(value[key], `${field}.${key}`)
  }
  if (value.question !== undefined) parseQuestion(value.question, `${field}.question`)
  if (value.failure !== undefined) parseFailure(value.failure, `${field}.failure`)
  return value as unknown as AgentTaskSnapshot
}

export const parseRuntimeSnapshot = (value: unknown): AgentRuntimeSnapshot => {
  assertJsonValue(value, 'AgentRuntimeSnapshot')
  assertExactFields(
    value,
    ['schemaVersion', 'binding', 'status', 'phase', 'revision', 'tasks'],
    ['activeTask', 'failure'],
    'AgentRuntimeSnapshot',
  )
  if (value.schemaVersion !== 1) fail('AgentRuntimeSnapshot.schemaVersion must be 1')
  parseBinding(value.binding, 'AgentRuntimeSnapshot.binding')
  enumField(value.status, RUNTIME_STATUSES, 'AgentRuntimeSnapshot.status')
  enumField(value.phase, AGENT_PHASES, 'AgentRuntimeSnapshot.phase')
  finiteNumberField(value.revision, 'AgentRuntimeSnapshot.revision')
  if (!Array.isArray(value.tasks)) fail('AgentRuntimeSnapshot.tasks must be an array')
  const tasks = value.tasks as unknown[]
  tasks.forEach((task, index) => parseTaskSnapshot(task, `AgentRuntimeSnapshot.tasks[${index}]`))
  if (value.activeTask !== undefined) parseTaskSnapshot(value.activeTask, 'AgentRuntimeSnapshot.activeTask')
  if (value.failure !== undefined) parseFailure(value.failure, 'AgentRuntimeSnapshot.failure')
  return value as unknown as AgentRuntimeSnapshot
}

const parseInitialize = (value: unknown): RuntimeInitializeRequest => {
  assertExactFields(value, ['binding', 'recover'], [], 'RuntimeInitializeRequest')
  assertExactFields(value.binding, ['projectId', 'branchId', 'sessionId'], [], 'RuntimeInitializeRequest.binding')
  for (const field of ['projectId', 'branchId', 'sessionId'] as const) {
    stringField(value.binding[field], `RuntimeInitializeRequest.binding.${field}`)
  }
  if (typeof value.recover !== 'boolean') fail('RuntimeInitializeRequest.recover must be boolean')
  return value as unknown as RuntimeInitializeRequest
}

const parseIntent = (value: unknown): UserIntent => {
  assertExactFields(value, ['text'], ['metadata'], 'UserIntent')
  stringField(value.text, 'UserIntent.text')
  if (value.metadata !== undefined) {
    assertJsonValue(value.metadata, 'UserIntent.metadata')
    if (typeof value.metadata !== 'object' || value.metadata === null || Array.isArray(value.metadata)) {
      fail('UserIntent.metadata must be an object')
    }
  }
  return value as unknown as UserIntent
}

const parseTaskRef = (value: unknown): TaskRef => {
  assertExactFields(value, ['taskId', 'sessionId'], ['parentTaskId', 'supersedesTaskId'], 'TaskRef')
  for (const field of ['taskId', 'sessionId'] as const) stringField(value[field], `TaskRef.${field}`)
  for (const field of ['parentTaskId', 'supersedesTaskId'] as const) {
    if (value[field] !== undefined) stringField(value[field], `TaskRef.${field}`)
  }
  return value as unknown as TaskRef
}

const parseTaskId = (value: unknown): { readonly taskId: string } => {
  assertExactFields(value, ['taskId'], [], 'TaskIdRequest')
  stringField(value.taskId, 'TaskIdRequest.taskId')
  return value as { readonly taskId: string }
}

const parseResponse = (value: unknown): { readonly taskId: string; readonly response: UserResponse } => {
  assertExactFields(value, ['taskId', 'response'], [], 'RuntimeRespondRequest')
  stringField(value.taskId, 'RuntimeRespondRequest.taskId')
  assertExactFields(value.response, ['questionId', 'value'], [], 'UserResponse')
  stringField(value.response.questionId, 'UserResponse.questionId')
  assertJsonValue(value.response.value, 'UserResponse.value')
  return value as unknown as { readonly taskId: string; readonly response: UserResponse }
}

const parseJsonObject = (value: unknown): JsonObject => {
  return jsonObjectField(value, 'value')
}

export const runtimeRpcContracts = {
  ...agentBoundaryRpcContracts,
  'runtime.initialize': { parseRequest: parseInitialize, parseResponse: parseRuntimeSnapshot },
  'runtime.submit': { parseRequest: parseIntent, parseResponse: parseTaskRef },
  'runtime.pause': { parseRequest: parseTaskId, parseResponse: nullValue },
  'runtime.resume': { parseRequest: parseTaskId, parseResponse: nullValue },
  'runtime.cancel': { parseRequest: parseTaskId, parseResponse: nullValue },
  'runtime.respond': { parseRequest: parseResponse, parseResponse: nullValue },
  'runtime.waitForIdle': { parseRequest: nullValue, parseResponse: nullValue },
  'runtime.dispose': { parseRequest: nullValue, parseResponse: nullValue },
  'runtime.publishSnapshot': { parseRequest: parseRuntimeSnapshot, parseResponse: nullValue },
  'runtime.diagnostics': { parseRequest: nullValue, parseResponse: parseJsonObject },
} as const satisfies RpcContractMap
