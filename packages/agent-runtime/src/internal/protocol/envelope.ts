import type { JsonValue } from '../../contracts.js'
import {
  AGENT_PROTOCOL_VERSION,
  MAX_PROTOCOL_ARRAY_LENGTH,
  MAX_PROTOCOL_MESSAGE_BYTES,
  MAX_PROTOCOL_NESTING_DEPTH,
  MAX_PROTOCOL_STRING_BYTES,
  RPC_MESSAGE_KINDS,
  type RpcMessageKind,
} from './constants.js'

const textEncoder = new TextEncoder()
const envelopeKeys = [
  'protocolVersion',
  'sessionId',
  'taskId',
  'stepId',
  'messageId',
  'kind',
  'sentAt',
  'payload',
] as const

export type ProtocolValidationCode =
  | 'invalid-envelope'
  | 'invalid-field'
  | 'invalid-json-value'
  | 'message-too-large'
  | 'string-too-large'
  | 'array-too-large'
  | 'nesting-too-deep'
  | 'protocol-version-mismatch'
  | 'unknown-field'
  | 'unknown-kind'

export class ProtocolValidationError extends Error {
  readonly code: ProtocolValidationCode

  constructor(code: ProtocolValidationCode, message: string) {
    super(message)
    this.name = 'ProtocolValidationError'
    this.code = code
  }
}

export interface ProtocolEnvelope<
  Kind extends RpcMessageKind = RpcMessageKind,
  Payload = unknown,
> {
  readonly protocolVersion: typeof AGENT_PROTOCOL_VERSION
  readonly sessionId: string
  readonly taskId: string
  readonly stepId: string
  readonly messageId: string
  readonly kind: Kind
  readonly sentAt: number
  readonly payload: Payload
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const encodedLength = (value: string) => textEncoder.encode(value).byteLength

const assertBoundedString = (value: unknown, field: string): asserts value is string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProtocolValidationError('invalid-field', `${field} must be a non-empty string`)
  }
  if (encodedLength(value) > MAX_PROTOCOL_STRING_BYTES) {
    throw new ProtocolValidationError('string-too-large', `${field} exceeds the string byte limit`)
  }
}

export const assertExactFields = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  label = 'value',
): asserts value is Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new ProtocolValidationError('invalid-field', `${label} must be a plain object`)
  }

  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ProtocolValidationError('unknown-field', `${label} contains unknown field ${key}`)
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new ProtocolValidationError('invalid-field', `${label} is missing field ${key}`)
    }
  }
}

const assertJsonValueInternal = (
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  path: string,
): asserts value is JsonValue => {
  if (depth > MAX_PROTOCOL_NESTING_DEPTH) {
    throw new ProtocolValidationError('nesting-too-deep', `${path} exceeds the nesting depth limit`)
  }

  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ProtocolValidationError('invalid-json-value', `${path} must contain finite numbers`)
    }
    return
  }
  if (typeof value === 'string') {
    if (encodedLength(value) > MAX_PROTOCOL_STRING_BYTES) {
      throw new ProtocolValidationError('string-too-large', `${path} exceeds the string byte limit`)
    }
    return
  }
  if (typeof value !== 'object' || value === null) {
    throw new ProtocolValidationError('invalid-json-value', `${path} is not JSON-safe`)
  }
  if (ancestors.has(value)) {
    throw new ProtocolValidationError('invalid-json-value', `${path} contains a cycle`)
  }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_PROTOCOL_ARRAY_LENGTH) {
        throw new ProtocolValidationError('array-too-large', `${path} exceeds the array length limit`)
      }
      for (let index = 0; index < value.length; index += 1) {
        assertJsonValueInternal(value[index], depth + 1, ancestors, `${path}[${index}]`)
      }
      return
    }

    if (!isRecord(value)) {
      throw new ProtocolValidationError('invalid-json-value', `${path} must contain plain objects only`)
    }
    for (const [key, entry] of Object.entries(value)) {
      if (encodedLength(key) > MAX_PROTOCOL_STRING_BYTES) {
        throw new ProtocolValidationError('string-too-large', `${path} contains an oversized key`)
      }
      assertJsonValueInternal(entry, depth + 1, ancestors, `${path}.${key}`)
    }
  } finally {
    ancestors.delete(value)
  }
}

export const assertJsonValue = (value: unknown, path = 'value'): asserts value is JsonValue => {
  assertJsonValueInternal(value, 0, new WeakSet(), path)
}

export const assertEncodedMessageSize = (value: unknown): void => {
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new ProtocolValidationError('invalid-json-value', 'message cannot be encoded as JSON')
  }
  if (encoded === undefined) {
    throw new ProtocolValidationError('invalid-json-value', 'message cannot be encoded as JSON')
  }
  if (encodedLength(encoded) > MAX_PROTOCOL_MESSAGE_BYTES) {
    throw new ProtocolValidationError('message-too-large', 'message exceeds the encoded byte limit')
  }
}

const parseKind = (value: unknown): RpcMessageKind => {
  if (typeof value !== 'string' || !RPC_MESSAGE_KINDS.includes(value as RpcMessageKind)) {
    throw new ProtocolValidationError('unknown-kind', `unsupported protocol kind ${String(value)}`)
  }
  return value as RpcMessageKind
}

export const parseProtocolEnvelope = (value: unknown): ProtocolEnvelope => {
  assertExactFields(value, envelopeKeys, [], 'protocol envelope')
  if (value.protocolVersion !== AGENT_PROTOCOL_VERSION) {
    throw new ProtocolValidationError(
      'protocol-version-mismatch',
      `expected protocol version ${AGENT_PROTOCOL_VERSION}`,
    )
  }

  assertBoundedString(value.sessionId, 'sessionId')
  assertBoundedString(value.taskId, 'taskId')
  assertBoundedString(value.stepId, 'stepId')
  assertBoundedString(value.messageId, 'messageId')
  const kind = parseKind(value.kind)
  if (typeof value.sentAt !== 'number' || !Number.isFinite(value.sentAt) || value.sentAt < 0) {
    throw new ProtocolValidationError('invalid-field', 'sentAt must be a non-negative finite number')
  }
  assertJsonValue(value.payload, 'payload')
  assertEncodedMessageSize(value)

  return Object.freeze({
    protocolVersion: AGENT_PROTOCOL_VERSION,
    sessionId: value.sessionId,
    taskId: value.taskId,
    stepId: value.stepId,
    messageId: value.messageId,
    kind,
    sentAt: value.sentAt,
    payload: value.payload,
  })
}

export const createProtocolEnvelope = <Kind extends RpcMessageKind, Payload>(input: {
  readonly sessionId: string
  readonly taskId: string
  readonly stepId: string
  readonly messageId: string
  readonly kind: Kind
  readonly sentAt: number
  readonly payload: Payload
}): ProtocolEnvelope<Kind, Payload> =>
  parseProtocolEnvelope({ protocolVersion: AGENT_PROTOCOL_VERSION, ...input }) as ProtocolEnvelope<Kind, Payload>
