import { parseWorkerTelemetryControlEvent } from '../worker-telemetry-control.mjs'

export const PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION = 1

export const PRODUCTION_AGENT_MODEL_ENV = Object.freeze({
  providerId: 'VITE_DASHBOARD_AGENT_MODEL_PROVIDER_ID',
  model: 'VITE_DASHBOARD_AGENT_MODEL',
  path: 'VITE_DASHBOARD_AGENT_MODEL_PATH',
})

export const DEFAULT_PRODUCTION_AGENT_MODEL_PATH = '/api/agent/model/stream'

const CONFIG_FIELDS = Object.freeze(['model', 'path', 'providerId'])
const CONTROL_FIELDS = Object.freeze({
  ready: Object.freeze(['generation', 'kind', 'schemaVersion']),
  fault: Object.freeze(['generation', 'kind', 'message', 'schemaVersion']),
  telemetry: Object.freeze(['event', 'generation', 'kind', 'schemaVersion']),
})
const START_FIELDS = Object.freeze(['config', 'generation', 'kind', 'port', 'schemaVersion'])
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAME_ORIGIN_PATH = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,255}$/u

export class ProductionAgentWorkerError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProductionAgentWorkerError'
    this.code = code
  }
}

const fail = (code, message) => {
  throw new ProductionAgentWorkerError(code, message)
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

const exactDataValues = (value, fields) => {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string')) return undefined
  keys.sort()
  if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) return undefined
  const values = {}
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return undefined
    values[field] = descriptor.value
  }
  return values
}

export const cloneProductionAgentModelConfig = value => {
  const values = exactDataValues(value, CONFIG_FIELDS)
  if (!values || !SAFE_IDENTIFIER.test(values.providerId) || !SAFE_IDENTIFIER.test(values.model)) {
    fail('invalid-config', 'Production Agent model configuration is invalid')
  }
  if (!SAME_ORIGIN_PATH.test(values.path) || values.path.includes('?') || values.path.includes('#')) {
    fail('invalid-config', 'Production Agent model configuration is invalid')
  }
  return Object.freeze({ providerId: values.providerId, model: values.model, path: values.path })
}

export const readProductionAgentModelConfig = (source = {}) => {
  if (!isRecord(source)) fail('invalid-config', 'Production Agent model configuration is invalid')
  return cloneProductionAgentModelConfig({
    providerId: source[PRODUCTION_AGENT_MODEL_ENV.providerId],
    model: source[PRODUCTION_AGENT_MODEL_ENV.model],
    path: source[PRODUCTION_AGENT_MODEL_ENV.path] ?? DEFAULT_PRODUCTION_AGENT_MODEL_PATH,
  })
}

export const createProductionAgentGrantAuthority = config => {
  const safe = cloneProductionAgentModelConfig(config)
  return Object.freeze({
    userId: 'dashboard-browser-session',
    policyVersion: 'dashboard-agent-gateway/1',
    providerId: safe.providerId,
    providerFingerprint: `same-origin:${JSON.stringify([safe.path, safe.providerId, safe.model])}`,
    providerLabel: `${safe.providerId} / ${safe.model}`,
  })
}

export const parseProductionAgentWorkerControlMessage = value => {
  const kind = isRecord(value) ? Object.getOwnPropertyDescriptor(value, 'kind')?.value : undefined
  const fields =
    kind === 'ready'
      ? CONTROL_FIELDS.ready
      : kind === 'fault'
        ? CONTROL_FIELDS.fault
        : kind === 'telemetry'
          ? CONTROL_FIELDS.telemetry
          : undefined
  const values = fields ? exactDataValues(value, fields) : undefined
  if (!values || values.schemaVersion !== PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION) {
    fail('invalid-handshake', 'Production Agent Worker control message is invalid')
  }
  if (!Number.isSafeInteger(values.generation) || values.generation < 1) {
    fail('invalid-handshake', 'Production Agent Worker control message is invalid')
  }
  if (values.kind === 'ready') {
    return Object.freeze({
      schemaVersion: PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION,
      kind: 'ready',
      generation: values.generation,
    })
  }
  if (
    values.kind === 'fault' &&
    typeof values.message === 'string' &&
    values.message.length > 0 &&
    values.message.length <= 512
  ) {
    return Object.freeze({
      schemaVersion: PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION,
      kind: 'fault',
      generation: values.generation,
      message: values.message,
    })
  }
  if (values.kind === 'telemetry') {
    return Object.freeze({
      schemaVersion: PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION,
      kind: 'telemetry',
      generation: values.generation,
      event: parseWorkerTelemetryControlEvent(values.event),
    })
  }
  fail('invalid-handshake', 'Production Agent Worker control message is invalid')
}

export const parseProductionAgentWorkerStartMessage = value => {
  const values = exactDataValues(value, START_FIELDS)
  if (
    !values ||
    values.schemaVersion !== PRODUCTION_AGENT_WORKER_PROTOCOL_VERSION ||
    values.kind !== 'start' ||
    !Number.isSafeInteger(values.generation) ||
    values.generation < 1 ||
    !isRecord(values.port) ||
    typeof values.port.postMessage !== 'function' ||
    typeof values.port.addEventListener !== 'function'
  ) {
    fail('invalid-start', 'Production Agent Worker start message is invalid')
  }
  return Object.freeze({
    generation: values.generation,
    port: values.port,
    config: cloneProductionAgentModelConfig(values.config),
  })
}
