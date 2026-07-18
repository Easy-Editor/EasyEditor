export const MODEL_GATEWAY_PATH = '/api/agent/model/stream'

export const MODEL_GATEWAY_SCHEMA_VERSION = 1
export const MODEL_GATEWAY_MAX_BODY_BYTES = 262_144
export const MODEL_GATEWAY_MAX_ID_LENGTH = 128
export const MODEL_GATEWAY_MAX_PROVIDER_LENGTH = 128
export const MODEL_GATEWAY_MAX_MODEL_LENGTH = 128
export const MODEL_GATEWAY_MAX_MESSAGES = 32
export const MODEL_GATEWAY_MAX_MESSAGE_CONTENT_LENGTH = 16_384
export const MODEL_GATEWAY_MAX_OUTPUT_TOKENS = 8_192

const REQUIRED_KEYS = Object.freeze([
  'schemaVersion',
  'projectId',
  'branchId',
  'sessionId',
  'taskId',
  'stepId',
  'modelRequestId',
  'providerId',
  'model',
  'phase',
  'messages',
])

const OPTIONAL_KEYS = Object.freeze(['maxOutputTokens'])
const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, ...OPTIONAL_KEYS])
const ID_KEYS = Object.freeze(['projectId', 'branchId', 'sessionId', 'taskId', 'stepId', 'modelRequestId'])
const PHASES = new Set(['BLUEPRINT', 'PLAN_STEP', 'REPAIR'])
const MESSAGE_ROLES = new Set(['system', 'user', 'assistant'])

const ERROR_DEFINITIONS = Object.freeze({
  INVALID_BODY: Object.freeze({
    message: 'Gateway request body must be an object.',
    status: 400,
    retryable: false,
  }),
  BODY_TOO_LARGE: Object.freeze({
    message: 'Gateway request body is too large.',
    status: 413,
    retryable: false,
  }),
  INVALID_FIELDS: Object.freeze({
    message: 'Gateway request body has invalid fields.',
    status: 400,
    retryable: false,
  }),
  INVALID_SCHEMA_VERSION: Object.freeze({
    message: 'Gateway request schema version is invalid.',
    status: 400,
    retryable: false,
  }),
  INVALID_ID: Object.freeze({
    message: 'Gateway request identifier is invalid.',
    status: 400,
    retryable: false,
  }),
  INVALID_PROVIDER: Object.freeze({
    message: 'Gateway request provider is invalid.',
    status: 400,
    retryable: false,
  }),
  INVALID_MODEL: Object.freeze({
    message: 'Gateway request model is invalid.',
    status: 400,
    retryable: false,
  }),
  INVALID_PHASE: Object.freeze({
    message: 'Gateway request phase is invalid.',
    status: 400,
    retryable: false,
  }),
  INVALID_MESSAGES: Object.freeze({
    message: 'Gateway request messages are invalid.',
    status: 400,
    retryable: false,
  }),
  INVALID_MAX_OUTPUT_TOKENS: Object.freeze({
    message: 'Gateway request output token limit is invalid.',
    status: 400,
    retryable: false,
  }),
})

export class GatewayError extends Error {
  constructor(code, options = {}) {
    const definition = ERROR_DEFINITIONS[code] ?? ERROR_DEFINITIONS.INVALID_BODY
    super(definition.message, options)
    this.name = 'GatewayError'
    this.code = code in ERROR_DEFINITIONS ? code : 'INVALID_BODY'
    this.status = definition.status
    this.retryable = definition.retryable
  }
}

function fail(code) {
  throw new GatewayError(code)
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isBoundedNonEmptyString(value, maximumLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength
}

function encodedBodySize(body) {
  try {
    const encoded = JSON.stringify(body)
    if (typeof encoded !== 'string') {
      fail('INVALID_BODY')
    }
    return new TextEncoder().encode(encoded).byteLength
  } catch (error) {
    if (error instanceof GatewayError) {
      throw error
    }
    fail('INVALID_BODY')
  }
}

function validateExactKeys(value, requiredKeys, allowedKeys) {
  const keys = Object.keys(value)
  if (keys.some(key => !allowedKeys.has(key))) {
    fail('INVALID_FIELDS')
  }
  if (requiredKeys.some(key => !Object.hasOwn(value, key))) {
    fail('INVALID_FIELDS')
  }
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MODEL_GATEWAY_MAX_MESSAGES) {
    fail('INVALID_MESSAGES')
  }

  const allowedMessageKeys = new Set(['role', 'content'])
  for (const message of messages) {
    if (!isPlainObject(message)) {
      fail('INVALID_MESSAGES')
    }
    const keys = Object.keys(message)
    if (
      keys.length !== 2 ||
      !Object.hasOwn(message, 'role') ||
      !Object.hasOwn(message, 'content') ||
      keys.some(key => !allowedMessageKeys.has(key)) ||
      !MESSAGE_ROLES.has(message.role) ||
      !isBoundedNonEmptyString(message.content, MODEL_GATEWAY_MAX_MESSAGE_CONTENT_LENGTH)
    ) {
      fail('INVALID_MESSAGES')
    }
  }
}

export function parseModelGatewayRequestBody(body) {
  if (!isPlainObject(body)) {
    fail('INVALID_BODY')
  }
  if (encodedBodySize(body) > MODEL_GATEWAY_MAX_BODY_BYTES) {
    fail('BODY_TOO_LARGE')
  }

  validateExactKeys(body, REQUIRED_KEYS, ALLOWED_KEYS)

  if (body.schemaVersion !== MODEL_GATEWAY_SCHEMA_VERSION) {
    fail('INVALID_SCHEMA_VERSION')
  }
  for (const key of ID_KEYS) {
    if (!isBoundedNonEmptyString(body[key], MODEL_GATEWAY_MAX_ID_LENGTH)) {
      fail('INVALID_ID')
    }
  }
  if (!isBoundedNonEmptyString(body.providerId, MODEL_GATEWAY_MAX_PROVIDER_LENGTH)) {
    fail('INVALID_PROVIDER')
  }
  if (!isBoundedNonEmptyString(body.model, MODEL_GATEWAY_MAX_MODEL_LENGTH)) {
    fail('INVALID_MODEL')
  }
  if (!PHASES.has(body.phase)) {
    fail('INVALID_PHASE')
  }

  validateMessages(body.messages)

  if (
    Object.hasOwn(body, 'maxOutputTokens') &&
    (!Number.isInteger(body.maxOutputTokens) ||
      body.maxOutputTokens < 1 ||
      body.maxOutputTokens > MODEL_GATEWAY_MAX_OUTPUT_TOKENS)
  ) {
    fail('INVALID_MAX_OUTPUT_TOKENS')
  }

  return body
}
