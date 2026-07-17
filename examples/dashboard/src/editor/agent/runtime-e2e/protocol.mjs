const MODEL_PHASES = new Set(['BLUEPRINT', 'PLAN_STEP', 'REPAIR'])
const SCRIPT_FAULTS = new Set(['disconnect', 'malformed', 'timeout'])
const STEP_FIELDS = new Set(['delayMs', 'events', 'expectedPhase', 'fault'])

export const AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION = 1

export class AgentRuntimeE2EWorkerError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'AgentRuntimeE2EWorkerError'
    this.code = code
  }
}

const fail = (code, message, options) => {
  throw new AgentRuntimeE2EWorkerError(code, message, options)
}

const assertPlainCloneData = (value, path, ancestors) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid-steps', `${path} must contain only finite numbers`)
    return
  }
  if (typeof value !== 'object') {
    fail('invalid-steps', `${path} contains a non-cloneable ${typeof value} value`)
  }
  if (ancestors.has(value)) fail('invalid-steps', `${path} contains a circular reference`)

  ancestors.add(value)
  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value).filter(key => key !== 'length')
    if (ownKeys.length !== value.length) fail('invalid-steps', `${path} must be a dense array without custom fields`)
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        fail('invalid-steps', `${path}[${index}] must be a data property`)
      }
      assertPlainCloneData(descriptor.value, `${path}[${index}]`, ancestors)
    }
    ancestors.delete(value)
    return
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    fail('invalid-steps', `${path} must contain only plain objects and arrays`)
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('invalid-steps', `${path} contains a symbol field`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      fail('invalid-steps', `${path}.${key} must not use an accessor`)
    }
    assertPlainCloneData(descriptor.value, `${path}.${key}`, ancestors)
  }
  ancestors.delete(value)
}

const deepFreeze = value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const entry of Object.values(value)) deepFreeze(entry)
  return Object.freeze(value)
}

export const cloneAgentRuntimeE2ESteps = steps => {
  if (!Array.isArray(steps)) fail('invalid-steps', 'steps must be an array')
  assertPlainCloneData(steps, 'steps', new WeakSet())

  for (const [index, step] of steps.entries()) {
    if (Array.isArray(step) || step === null || typeof step !== 'object') {
      fail('invalid-steps', `steps[${index}] must be a plain object`)
    }
    for (const field of Reflect.ownKeys(step)) {
      if (!STEP_FIELDS.has(field)) fail('invalid-steps', `steps[${index}] contains unsupported field ${field}`)
    }
    if (!Object.hasOwn(step, 'expectedPhase') || !MODEL_PHASES.has(step.expectedPhase)) {
      fail('invalid-steps', `steps[${index}].expectedPhase is invalid`)
    }
    if (!Object.hasOwn(step, 'events') || !Array.isArray(step.events)) {
      fail('invalid-steps', `steps[${index}].events must be an array`)
    }
    if (Object.hasOwn(step, 'delayMs') && (!Number.isSafeInteger(step.delayMs) || step.delayMs < 0)) {
      fail('invalid-steps', `steps[${index}].delayMs must be a non-negative safe integer`)
    }
    if (Object.hasOwn(step, 'fault') && !SCRIPT_FAULTS.has(step.fault)) {
      fail('invalid-steps', `steps[${index}].fault is invalid`)
    }
  }

  try {
    return deepFreeze(structuredClone(steps))
  } catch (cause) {
    fail('invalid-steps', 'steps must cross the Worker boundary through structuredClone', { cause })
  }
}

const assertControlRecord = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid-handshake', 'Worker control message must be an object')
  }
  if (value.schemaVersion !== AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION) {
    fail('invalid-handshake', 'Worker control message schemaVersion is invalid')
  }
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) {
    fail('invalid-handshake', 'Worker control message generation is invalid')
  }
}

export const parseAgentRuntimeE2EWorkerControlMessage = value => {
  assertControlRecord(value)
  if (value.kind === 'ready') {
    if (Object.keys(value).length !== 3) fail('invalid-handshake', 'Worker ready message has unexpected fields')
    return Object.freeze({
      schemaVersion: AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION,
      kind: 'ready',
      generation: value.generation,
    })
  }
  if (value.kind === 'fault') {
    if (Object.keys(value).length !== 4 || typeof value.message !== 'string' || value.message.length === 0) {
      fail('invalid-handshake', 'Worker fault message is invalid')
    }
    return Object.freeze({
      schemaVersion: AGENT_RUNTIME_E2E_WORKER_PROTOCOL_VERSION,
      kind: 'fault',
      generation: value.generation,
      message: value.message,
    })
  }
  fail('invalid-handshake', `Unsupported Worker control message kind ${String(value.kind)}`)
}
