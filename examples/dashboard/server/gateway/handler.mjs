import { MODEL_GATEWAY_MAX_BODY_BYTES, MODEL_GATEWAY_PATH, parseModelGatewayRequestBody } from './contract.mjs'

const TRANSPORT_FIELDS = new Set(['method', 'path', 'headers', 'body', 'signal'])
const PROVIDER_EVENT_LIMIT = 256
const OUTPUT_BYTE_LIMIT = 1024 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

class GatewayFailure extends Error {
  constructor(code, status, message, retryable = false) {
    super(message)
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

const failure = {
  invalid: status => new GatewayFailure('INVALID_REQUEST', status, 'Gateway request is invalid'),
  aborted: () => new GatewayFailure('REQUEST_ABORTED', 408, 'Gateway request was aborted', true),
  deadline: () => new GatewayFailure('GATEWAY_DEADLINE_EXCEEDED', 504, 'Gateway deadline was exceeded', true),
  busy: () => new GatewayFailure('GATEWAY_BUSY', 429, 'Model gateway is busy', true),
  invalidProvider: () => new GatewayFailure('PROVIDER_RESPONSE_INVALID', 502, 'Model provider response is invalid'),
  providerDisconnected: () => new GatewayFailure('PROVIDER_DISCONNECTED', 502, 'Model provider disconnected', true),
  providerFailed: () => new GatewayFailure('PROVIDER_FAILED', 502, 'Model provider request failed', true),
  providerRateLimited: () => new GatewayFailure('PROVIDER_RATE_LIMITED', 429, 'Model provider is busy', true),
  providerUnavailable: () => new GatewayFailure('PROVIDER_UNAVAILABLE', 502, 'Model provider is unavailable', true),
  providerBudget: () =>
    new GatewayFailure('PROVIDER_BUDGET_EXCEEDED', 502, 'Model provider response exceeded its budget'),
  unauthorized: status => new GatewayFailure('UNAUTHORIZED', status, 'Gateway request is not authorized'),
}

const exactTransport = value =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === TRANSPORT_FIELDS.size &&
  [...TRANSPORT_FIELDS].every(key => Object.hasOwn(value, key))

const normalizeHeaders = headers => {
  const normalized = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') normalized[name.toLowerCase()] = value
    else if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
      normalized[name.toLowerCase()] = value.join(', ')
    }
  }
  return normalized
}

const bodyBytes = body => {
  if (typeof body === 'string') return encoder.encode(body)
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  throw failure.invalid(400)
}

const parseRequest = body => {
  const bytes = bodyBytes(body)
  if (bytes.byteLength > MODEL_GATEWAY_MAX_BODY_BYTES) throw failure.invalid(413)
  let value
  try {
    value = JSON.parse(decoder.decode(bytes))
    return parseModelGatewayRequestBody(value)
  } catch (error) {
    if (error instanceof GatewayFailure) throw error
    throw failure.invalid(400)
  }
}

const correlation = request => ({
  sessionId: request.sessionId,
  taskId: request.taskId,
  stepId: request.stepId,
  modelRequestId: request.modelRequestId,
})
const encode = frame => encoder.encode(`${JSON.stringify(frame)}\n`)
const frameError = (error, request) => ({
  schemaVersion: 1,
  kind: 'error',
  ...(request ? correlation(request) : {}),
  error: { code: error.code, message: error.message, retryable: error.retryable },
})
const oneFrame = async function* (frame) {
  yield encode(frame)
}
const result = (status, body) => ({
  status,
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/x-ndjson; charset=utf-8',
    'x-content-type-options': 'nosniff',
  },
  body,
})

const safeFailure = (error, signal) => {
  if (error instanceof GatewayFailure) return error
  if (signal?.aborted && signal.reason instanceof GatewayFailure) return signal.reason
  if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'REQUEST_ABORTED') return failure.aborted()
  if (error?.status === 401 || error?.status === 403) return failure.unauthorized(error.status)
  if (error?.status === 429) return failure.providerRateLimited()
  if (error?.code === 'PROVIDER_DISCONNECTED') return failure.providerDisconnected()
  if (Number.isInteger(error?.status) && error.status >= 500) return failure.providerUnavailable()
  return failure.providerFailed()
}

const usageOf = usage => {
  if (usage === undefined) return undefined
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) throw failure.invalidProvider()
  const keys = Object.keys(usage)
  if (
    keys.length === 0 ||
    keys.some(key => !['inputTokens', 'outputTokens', 'totalTokens'].includes(key)) ||
    keys.some(key => !Number.isFinite(usage[key]) || !Number.isInteger(usage[key]) || usage[key] < 0)
  ) {
    throw failure.invalidProvider()
  }
  return Object.fromEntries(keys.map(key => [key, usage[key]]))
}

const providerEvent = event => {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw failure.invalidProvider()
  const keys = Object.keys(event)
  if (event.kind === 'delta' && keys.length === 2 && keys.includes('delta') && typeof event.delta === 'string') {
    return { kind: 'delta', delta: event.delta }
  }
  if (
    event.kind === 'completed' &&
    keys.includes('finishReason') &&
    keys.every(key => ['kind', 'finishReason', 'usage'].includes(key)) &&
    typeof event.finishReason === 'string' &&
    ['stop', 'length', 'tool_calls', 'content_filter', 'cancelled'].includes(event.finishReason)
  ) {
    const usage = usageOf(event.usage)
    return { kind: 'completed', finishReason: event.finishReason, ...(usage ? { usage } : {}) }
  }
  throw failure.invalidProvider()
}

const deadlineSignal = (source, timeoutMs) => {
  const controller = new AbortController()
  const onAbort = () => controller.abort(source.reason ?? failure.aborted())
  source.addEventListener('abort', onAbort, { once: true })
  if (source.aborted) onAbort()
  const timer = setTimeout(() => controller.abort(failure.deadline()), timeoutMs)
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer)
      source.removeEventListener('abort', onAbort)
    },
  }
}

const waitWithSignal = (promise, signal) => {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export const createModelGatewayHandler = ({
  authorizePrincipal,
  providerTransport,
  maxConcurrent = 4,
  timeoutMs = 60_000,
  logger,
} = {}) => {
  if (typeof authorizePrincipal !== 'function' || typeof providerTransport?.stream !== 'function') {
    throw new TypeError('Gateway dependencies are invalid')
  }
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || !Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('Gateway budgets are invalid')
  }
  let active = 0
  return Object.freeze({
    path: MODEL_GATEWAY_PATH,
    async handle(transport) {
      let request
      let release
      let deadline
      try {
        if (!exactTransport(transport) || !(transport.signal instanceof AbortSignal)) throw failure.invalid(400)
        if (transport.method !== 'POST') throw failure.invalid(405)
        if (transport.path !== MODEL_GATEWAY_PATH) throw failure.invalid(404)
        const headers = normalizeHeaders(transport.headers)
        if (!/^application\/json(?:\s*;|$)/iu.test(headers['content-type'] ?? '')) throw failure.invalid(415)
        request = parseRequest(transport.body)
        deadline = deadlineSignal(transport.signal, timeoutMs)
        const principal = await waitWithSignal(
          authorizePrincipal({ headers, projectId: request.projectId, signal: deadline.signal }),
          deadline.signal,
        )
        if (active >= maxConcurrent) throw failure.busy()
        active += 1
        let released = false
        release = () => {
          if (released) return
          released = true
          active -= 1
          deadline.close()
        }
        let events
        try {
          events = await waitWithSignal(
            providerTransport.stream({ principal, request, signal: deadline.signal }),
            deadline.signal,
          )
          if (!events || typeof events[Symbol.asyncIterator] !== 'function') throw failure.invalidProvider()
        } catch (error) {
          release()
          throw error
        }
        const body = async function* () {
          const iterator = events[Symbol.asyncIterator]()
          let eventCount = 0
          let emittedBytes = 0
          let completed = false
          const emit = frame => {
            const bytes = encode(frame)
            if (emittedBytes + bytes.byteLength > OUTPUT_BYTE_LIMIT) throw failure.providerBudget()
            emittedBytes += bytes.byteLength
            return bytes
          }
          try {
            yield emit({ schemaVersion: 1, kind: 'started', ...correlation(request) })
            while (!completed) {
              const next = await waitWithSignal(iterator.next(), deadline.signal)
              if (next.done) throw failure.providerDisconnected()
              eventCount += 1
              if (eventCount > PROVIDER_EVENT_LIMIT) throw failure.providerBudget()
              const event = providerEvent(next.value)
              yield emit({ schemaVersion: 1, ...event, ...correlation(request) })
              completed = event.kind === 'completed'
            }
          } catch (error) {
            const safe = safeFailure(error, deadline.signal)
            logger?.warn?.({ component: 'model-gateway', code: safe.code })
            yield encode(frameError(safe, request))
          } finally {
            await iterator.return?.().catch?.(() => undefined)
            release()
          }
        }
        return result(200, body())
      } catch (error) {
        release?.()
        deadline?.close()
        const safe = safeFailure(error, transport?.signal)
        logger?.warn?.({ component: 'model-gateway', code: safe.code })
        return result(safe.status, oneFrame(frameError(safe, request)))
      }
    },
  })
}
