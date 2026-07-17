export const ONLINE_COMPONENT_PROTOCOL_VERSION = 1

export const ONLINE_COMPONENT_PROTOCOL = Object.freeze({
  connect: 'online-component.connect',
  ready: 'online-component.ready',
  renderBatch: 'online-component.render-batch',
  batchApplied: 'online-component.batch-applied',
  fault: 'online-component.fault',
  event: 'online-component.event',
  shellEvent: 'online-component.shell-event',
  maxMessageBytes: 256 * 1024,
  maxBatchUpdates: 256,
  maxBatchRemovals: 256,
})

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/
const NONCE_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/
const MAX_JSON_DEPTH = 12
const MAX_JSON_KEYS = 128
const MAX_JSON_ARRAY = 512
const MAX_JSON_STRING = 64 * 1024

export class OnlineComponentProtocolError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OnlineComponentProtocolError'
    this.code = code
  }
}

const protocolError = (code, message) => {
  throw new OnlineComponentProtocolError(code, message)
}

const isRecord = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertRecord = (value, name) => {
  if (!isRecord(value)) protocolError('invalid-record', `${name} must be a plain object`)
  return value
}

const assertExactKeys = (value, expectedKeys, name) => {
  assertRecord(value, name)
  const actualKeys = Object.keys(value).sort()
  const sortedExpected = [...expectedKeys].sort()
  if (actualKeys.length !== sortedExpected.length || actualKeys.some((key, index) => key !== sortedExpected[index])) {
    protocolError('unexpected-fields', `${name} must contain exactly ${sortedExpected.join(', ')}`)
  }
  return value
}

const assertIdentifier = (value, name) => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    protocolError('invalid-identifier', `${name} is invalid`)
  }
  return value
}

const assertNonce = value => {
  if (typeof value !== 'string' || !NONCE_PATTERN.test(value)) {
    protocolError('invalid-nonce', 'nonce is invalid')
  }
  return value
}

const assertGeneration = value => {
  if (!Number.isSafeInteger(value) || value < 1) {
    protocolError('invalid-generation', 'generation must be a positive safe integer')
  }
  return value
}

const assertSequence = value => {
  if (!Number.isSafeInteger(value) || value < 1) {
    protocolError('invalid-sequence', 'sequence must be a positive safe integer')
  }
  return value
}

const assertResourceCount = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    protocolError('invalid-resource-count', `${name} must be a non-negative safe integer`)
  }
  return value
}

const assertFiniteNumber = (value, name) => {
  if (!Number.isFinite(value)) protocolError('invalid-number', `${name} must be finite`)
  return value
}

const assertIdentity = identity => {
  assertExactKeys(identity, ['nonce', 'surfaceId', 'generation'], 'protocol identity')
  return Object.freeze({
    nonce: assertNonce(identity.nonce),
    surfaceId: assertIdentifier(identity.surfaceId, 'surfaceId'),
    generation: assertGeneration(identity.generation),
  })
}

const assertEnvelopeIdentity = (message, expectedIdentity) => {
  if (message.protocolVersion !== ONLINE_COMPONENT_PROTOCOL_VERSION) {
    protocolError('protocol-version-mismatch', 'protocolVersion does not match')
  }
  if (message.nonce !== expectedIdentity.nonce) protocolError('nonce-mismatch', 'nonce does not match')
  if (message.surfaceId !== expectedIdentity.surfaceId) {
    protocolError('surface-mismatch', 'surfaceId does not match')
  }
  if (message.generation !== expectedIdentity.generation) {
    protocolError('generation-mismatch', 'generation does not match')
  }
}

const cloneJsonValue = (value, name, depth = 0, seen = new Set()) => {
  if (depth > MAX_JSON_DEPTH) protocolError('payload-too-deep', `${name} exceeds the JSON depth budget`)
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) protocolError('invalid-json-number', `${name} contains a non-finite number`)
    return value
  }
  if (typeof value === 'string') {
    if (value.length > MAX_JSON_STRING) protocolError('payload-too-large', `${name} contains an oversized string`)
    return value
  }
  if (typeof value !== 'object') protocolError('invalid-json-value', `${name} must be JSON-safe`)
  if (seen.has(value)) protocolError('cyclic-payload', `${name} must not contain cycles`)

  seen.add(value)
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY) protocolError('payload-too-large', `${name} contains an oversized array`)
    const cloned = value.map((item, index) => cloneJsonValue(item, `${name}[${index}]`, depth + 1, seen))
    seen.delete(value)
    return Object.freeze(cloned)
  }

  assertRecord(value, name)
  const keys = Object.keys(value)
  if (keys.length > MAX_JSON_KEYS) protocolError('payload-too-large', `${name} contains too many keys`)
  const cloned = {}
  for (const key of keys) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      protocolError('unsafe-json-key', `${name} contains an unsafe key`)
    }
    cloned[key] = cloneJsonValue(value[key], `${name}.${key}`, depth + 1, seen)
  }
  seen.delete(value)
  return Object.freeze(cloned)
}

const assertMessageBudget = message => {
  let serialized
  try {
    serialized = JSON.stringify(message)
  } catch {
    protocolError('message-not-serializable', 'message must be JSON serializable')
  }
  if (new TextEncoder().encode(serialized).byteLength > ONLINE_COMPONENT_PROTOCOL.maxMessageBytes) {
    protocolError('message-too-large', 'message exceeds the protocol byte budget')
  }
}

const normalizeRect = rect => {
  assertExactKeys(rect, ['x', 'y', 'width', 'height'], 'render update rect')
  const normalized = {
    x: assertFiniteNumber(rect.x, 'rect.x'),
    y: assertFiniteNumber(rect.y, 'rect.y'),
    width: assertFiniteNumber(rect.width, 'rect.width'),
    height: assertFiniteNumber(rect.height, 'rect.height'),
  }
  if (normalized.width < 0 || normalized.height < 0) {
    protocolError('invalid-rect', 'rect width and height must be non-negative')
  }
  return Object.freeze(normalized)
}

export const normalizeRenderUpdate = update => {
  assertExactKeys(update, ['instanceId', 'revisionKey', 'rect', 'visible', 'generatedZ', 'payload'], 'render update')
  if (typeof update.visible !== 'boolean') {
    protocolError('invalid-visibility', 'render update visible must be boolean')
  }
  if (!Number.isSafeInteger(update.generatedZ)) {
    protocolError('invalid-generated-z', 'render update generatedZ must be a safe integer')
  }
  return Object.freeze({
    instanceId: assertIdentifier(update.instanceId, 'instanceId'),
    revisionKey: assertIdentifier(update.revisionKey, 'revisionKey'),
    rect: normalizeRect(update.rect),
    visible: update.visible,
    generatedZ: update.generatedZ,
    payload: cloneJsonValue(assertRecord(update.payload, 'render update payload'), 'render update payload'),
  })
}

export const normalizeSandboxResourceCounts = resources => {
  assertExactKeys(
    resources,
    ['instanceCount', 'listenerCount', 'pendingTaskCount', 'objectUrlCount'],
    'sandbox resource counts',
  )
  return Object.freeze({
    instanceCount: assertResourceCount(resources.instanceCount, 'resources.instanceCount'),
    listenerCount: assertResourceCount(resources.listenerCount, 'resources.listenerCount'),
    pendingTaskCount: assertResourceCount(resources.pendingTaskCount, 'resources.pendingTaskCount'),
    objectUrlCount: assertResourceCount(resources.objectUrlCount, 'resources.objectUrlCount'),
  })
}

export const createConnectMessage = input => {
  const identity = assertIdentity(input)
  return Object.freeze({
    kind: ONLINE_COMPONENT_PROTOCOL.connect,
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    nonce: identity.nonce,
    surfaceId: identity.surfaceId,
    generation: identity.generation,
  })
}

export const validateConnectMessage = (message, expected) => {
  const identity = assertIdentity(expected)
  assertExactKeys(message, ['kind', 'protocolVersion', 'nonce', 'surfaceId', 'generation'], 'connect message')
  if (message.kind !== ONLINE_COMPONENT_PROTOCOL.connect) {
    protocolError('unexpected-kind', 'connect message kind is invalid')
  }
  assertEnvelopeIdentity(message, identity)
  assertMessageBudget(message)
  return message
}

export const createRenderBatchMessage = input => {
  assertExactKeys(input, ['nonce', 'surfaceId', 'generation', 'sequence', 'updates', 'removals'], 'render batch input')
  const identity = assertIdentity({
    nonce: input.nonce,
    surfaceId: input.surfaceId,
    generation: input.generation,
  })
  const sequence = assertSequence(input.sequence)
  if (!Array.isArray(input.updates) || input.updates.length > ONLINE_COMPONENT_PROTOCOL.maxBatchUpdates) {
    protocolError('invalid-updates', 'updates must fit the batch budget')
  }
  if (!Array.isArray(input.removals) || input.removals.length > ONLINE_COMPONENT_PROTOCOL.maxBatchRemovals) {
    protocolError('invalid-removals', 'removals must fit the batch budget')
  }
  const updates = Object.freeze(input.updates.map(normalizeRenderUpdate))
  const seenUpdates = new Set()
  for (const update of updates) {
    if (seenUpdates.has(update.instanceId)) {
      protocolError('duplicate-instance', 'updates contain a duplicate instanceId')
    }
    seenUpdates.add(update.instanceId)
  }
  const removals = Object.freeze(input.removals.map(instanceId => assertIdentifier(instanceId, 'removal instanceId')))
  if (new Set(removals).size !== removals.length) {
    protocolError('duplicate-instance', 'removals contain a duplicate instanceId')
  }
  if (removals.some(instanceId => seenUpdates.has(instanceId))) {
    protocolError('conflicting-instance', 'an instance cannot be updated and removed in one batch')
  }

  const message = Object.freeze({
    kind: ONLINE_COMPONENT_PROTOCOL.renderBatch,
    protocolVersion: ONLINE_COMPONENT_PROTOCOL_VERSION,
    nonce: identity.nonce,
    surfaceId: identity.surfaceId,
    generation: identity.generation,
    sequence,
    updates,
    removals,
  })
  assertMessageBudget(message)
  return message
}

const SANDBOX_MESSAGE_KEYS = Object.freeze({
  [ONLINE_COMPONENT_PROTOCOL.ready]: ['kind', 'protocolVersion', 'nonce', 'surfaceId', 'generation', 'resources'],
  [ONLINE_COMPONENT_PROTOCOL.batchApplied]: [
    'kind',
    'protocolVersion',
    'nonce',
    'surfaceId',
    'generation',
    'sequence',
    'resources',
  ],
  [ONLINE_COMPONENT_PROTOCOL.fault]: [
    'kind',
    'protocolVersion',
    'nonce',
    'surfaceId',
    'generation',
    'code',
    'instanceId',
    'resources',
  ],
  [ONLINE_COMPONENT_PROTOCOL.event]: [
    'kind',
    'protocolVersion',
    'nonce',
    'surfaceId',
    'generation',
    'instanceId',
    'event',
  ],
})

export const parseSandboxMessage = (message, expected) => {
  const identity = assertIdentity(expected)
  assertRecord(message, 'sandbox message')
  const expectedKeys = SANDBOX_MESSAGE_KEYS[message.kind]
  if (!expectedKeys) protocolError('unexpected-kind', 'sandbox message kind is invalid')
  assertExactKeys(message, expectedKeys, 'sandbox message')
  assertEnvelopeIdentity(message, identity)

  if (message.kind !== ONLINE_COMPONENT_PROTOCOL.event) {
    normalizeSandboxResourceCounts(message.resources)
  }

  if (message.kind === ONLINE_COMPONENT_PROTOCOL.batchApplied) assertSequence(message.sequence)
  if (message.kind === ONLINE_COMPONENT_PROTOCOL.fault) {
    if (typeof message.code !== 'string' || !EVENT_TYPE_PATTERN.test(message.code)) {
      protocolError('invalid-fault-code', 'fault code is invalid')
    }
    if (message.instanceId !== null) assertIdentifier(message.instanceId, 'fault instanceId')
  }
  if (message.kind === ONLINE_COMPONENT_PROTOCOL.event) {
    assertIdentifier(message.instanceId, 'event instanceId')
    assertExactKeys(message.event, ['type', 'payload'], 'sandbox event')
    if (typeof message.event.type !== 'string' || !EVENT_TYPE_PATTERN.test(message.event.type)) {
      protocolError('invalid-event-type', 'sandbox event type is invalid')
    }
    cloneJsonValue(message.event.payload, 'sandbox event payload')
  }
  assertMessageBudget(message)
  return message
}
