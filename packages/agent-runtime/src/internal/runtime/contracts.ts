import type {
  AgentRuntimeBinding,
  AgentRuntimeSnapshot,
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

const nullValue = (value: unknown): null => (value === null ? null : fail('value must be null'))

export interface RuntimeInitializeRequest {
  readonly binding: Required<AgentRuntimeBinding>
  readonly recover: boolean
}

export const parseRuntimeSnapshot = (value: unknown): AgentRuntimeSnapshot => {
  assertJsonValue(value, 'AgentRuntimeSnapshot')
  assertExactFields(
    value,
    ['schemaVersion', 'binding', 'status', 'phase', 'revision', 'tasks'],
    ['activeTask', 'failure'],
    'AgentRuntimeSnapshot',
  )
  if (value.schemaVersion !== 1 || typeof value.revision !== 'number') fail('invalid runtime snapshot')
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
  assertJsonValue(value)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('value must be an object')
  return value as JsonObject
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
