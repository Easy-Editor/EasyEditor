export const DEFAULT_GATEWAY_MODEL_PATH = '/api/agent/model/stream'
export const GATEWAY_MODEL_TOKEN_BUDGET = 4_096
const DEFAULT_DEADLINE_MS = 60_000
const DEFAULT_MAX_RESPONSE_BYTES = 1_100_000
const DEFAULT_MAX_RESPONSE_LINES = 258
const DEFAULT_MAX_EVENTS = 256
const DEFAULT_MAX_OUTPUT_BYTES = 262_144
const MAX_REQUEST_BYTES = 196_608
const MESSAGE_CHUNK_LENGTH = 8_000
const MAX_MESSAGE_CHUNKS = 31
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAME_ORIGIN_PATH = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,255}$/u
const encoder = new TextEncoder()
const SYSTEM_MESSAGE = [
  'Return only one JSON array of EasyEditor ModelEvent objects.',
  'Do not use Markdown or prose outside the JSON array.',
  'The following user messages are consecutive chunks of one exact ModelTurnRequest JSON document.',
].join(' ')
const ERROR_MESSAGES = Object.freeze({
  'gateway-aborted': 'The model gateway request was aborted',
  'gateway-deadline': 'The model gateway request exceeded its deadline',
  'gateway-http': 'The model gateway rejected the request',
  'gateway-rate-limited': 'The model gateway is busy',
  'gateway-unavailable': 'The model gateway is unavailable',
  'invalid-config': 'The model gateway configuration is invalid',
  'invalid-correlation': 'The model gateway response correlation is invalid',
  'invalid-gateway-stream': 'The model gateway stream is invalid',
  'invalid-model-output': 'The model gateway output is invalid',
  'request-budget-exceeded': 'The model gateway request exceeded its budget',
  'response-budget-exceeded': 'The model gateway response exceeded its budget',
})
export class GatewayModelAdapterError extends Error {
  code
  constructor(code) {
    super(ERROR_MESSAGES[code])
    this.name = 'GatewayModelAdapterError'
    this.code = code
  }
}
function fail(code) {
  throw new GatewayModelAdapterError(code)
}
const positiveInteger = (value, fallback) => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) fail('invalid-config')
  return resolved
}
const resolveOptions = options => {
  if (!ID.test(options.providerId) || !ID.test(options.model)) fail('invalid-config')
  const path = options.path ?? DEFAULT_GATEWAY_MODEL_PATH
  if (!SAME_ORIGIN_PATH.test(path) || path.includes('?') || path.includes('#')) fail('invalid-config')
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') fail('invalid-config')
  return Object.freeze({
    providerId: options.providerId,
    model: options.model,
    path,
    fetch: fetchImpl,
    deadlineMs: positiveInteger(options.deadlineMs, DEFAULT_DEADLINE_MS),
    maxResponseBytes: positiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES),
    maxResponseLines: positiveInteger(options.maxResponseLines, DEFAULT_MAX_RESPONSE_LINES),
    maxEvents: positiveInteger(options.maxEvents, DEFAULT_MAX_EVENTS),
    maxOutputBytes: positiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES),
  })
}
const chunksOf = value => {
  const chunks = []
  let chunk = ''
  for (const character of value) {
    if (chunk.length + character.length > MESSAGE_CHUNK_LENGTH) {
      chunks.push(chunk)
      chunk = ''
    }
    chunk += character
  }
  if (chunk) chunks.push(chunk)
  if (chunks.length < 1 || chunks.length > MAX_MESSAGE_CHUNKS) fail('request-budget-exceeded')
  return chunks
}
const gatewayBody = (request, options) => {
  let serialized
  try {
    serialized = JSON.stringify(request)
  } catch {
    fail('request-budget-exceeded')
  }
  if (encoder.encode(serialized).byteLength > MAX_REQUEST_BYTES) fail('request-budget-exceeded')
  return {
    schemaVersion: 1,
    projectId: request.projectId,
    branchId: request.branchId,
    sessionId: request.sessionId,
    taskId: request.taskId,
    stepId: request.stepId,
    modelRequestId: request.modelRequestId,
    providerId: options.providerId,
    model: options.model,
    phase: request.phase,
    messages: [
      { role: 'system', content: SYSTEM_MESSAGE },
      ...chunksOf(serialized).map(content => ({ role: 'user', content })),
    ],
    maxOutputTokens: GATEWAY_MODEL_TOKEN_BUDGET,
  }
}
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, required, optional = []) => {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return required.every(key => Object.hasOwn(value, key)) && keys.every(key => allowed.has(key))
}
const assertCorrelation = (frame, expected) => {
  for (const key of ['sessionId', 'taskId', 'stepId', 'modelRequestId']) {
    if (frame[key] !== expected[key]) fail('invalid-correlation')
  }
}
const parseFrame = (line, correlation) => {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    fail('invalid-gateway-stream')
  }
  if (!isRecord(frame) || frame.schemaVersion !== 1 || typeof frame.kind !== 'string') {
    fail('invalid-gateway-stream')
  }
  assertCorrelation(frame, correlation)
  const common = ['schemaVersion', 'kind', 'sessionId', 'taskId', 'stepId', 'modelRequestId']
  if (frame.kind === 'started' && exactKeys(frame, common)) return frame
  if (frame.kind === 'delta' && exactKeys(frame, [...common, 'delta']) && typeof frame.delta === 'string') return frame
  if (
    frame.kind === 'completed' &&
    exactKeys(frame, [...common, 'finishReason'], ['usage']) &&
    typeof frame.finishReason === 'string'
  ) {
    return frame
  }
  if (
    frame.kind === 'error' &&
    exactKeys(frame, [...common, 'error']) &&
    isRecord(frame.error) &&
    exactKeys(frame.error, ['code', 'message', 'retryable']) &&
    typeof frame.error.code === 'string' &&
    typeof frame.error.message === 'string' &&
    typeof frame.error.retryable === 'boolean'
  ) {
    return frame
  }
  fail('invalid-gateway-stream')
}
const waitWithSignal = (promise, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    let settled = false
    const settle = callback => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => settle(() => reject(signal.reason))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => settle(() => resolve(value)),
      error => settle(() => reject(error)),
    )
  })
const readFrames = async (reader, correlation, options, signal) => {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const frames = []
  let responseBytes = 0
  let buffer = ''
  while (true) {
    const next = await waitWithSignal(reader.read(), signal)
    if (next.done) break
    if (!(next.value instanceof Uint8Array)) fail('invalid-gateway-stream')
    responseBytes += next.value.byteLength
    if (responseBytes > options.maxResponseBytes) fail('response-budget-exceeded')
    buffer += decoder.decode(next.value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      let line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (!line) fail('invalid-gateway-stream')
      if (frames.length >= options.maxResponseLines) fail('response-budget-exceeded')
      frames.push(parseFrame(line, correlation))
      newline = buffer.indexOf('\n')
    }
  }
  buffer += decoder.decode()
  if (buffer.length > 0 || frames.length === 0) fail('invalid-gateway-stream')
  return frames
}
const modelEventsFrom = (frames, options) => {
  if (frames[0]?.kind !== 'started') fail('invalid-gateway-stream')
  let terminal = false
  let output = ''
  let outputBytes = 0
  let eventCount = 0
  let remoteError = false
  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index]
    if (!frame || terminal || frame.kind === 'started') fail('invalid-gateway-stream')
    eventCount += 1
    if (eventCount > options.maxEvents) fail('response-budget-exceeded')
    if (frame.kind === 'delta') {
      const delta = frame.delta
      outputBytes += encoder.encode(delta).byteLength
      if (outputBytes > options.maxOutputBytes) fail('response-budget-exceeded')
      output += delta
      continue
    }
    terminal = true
    if (frame.kind === 'error') {
      remoteError = true
      continue
    }
    if (frame.kind !== 'completed' || frame.finishReason !== 'stop') fail('invalid-model-output')
  }
  if (remoteError) fail('gateway-unavailable')
  if (!terminal || output.length === 0) fail('invalid-gateway-stream')
  let parsed
  try {
    parsed = JSON.parse(output)
  } catch {
    fail('invalid-model-output')
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > options.maxEvents) fail('invalid-model-output')
  return parsed
}
const createDeadline = (source, timeoutMs) => {
  const controller = new AbortController()
  let deadlineExceeded = false
  const onAbort = () => controller.abort(source.reason)
  source.addEventListener('abort', onAbort, { once: true })
  if (source.aborted) onAbort()
  const timer = setTimeout(() => {
    deadlineExceeded = true
    controller.abort(new GatewayModelAdapterError('gateway-deadline'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    deadlineExceeded: () => deadlineExceeded,
    close() {
      clearTimeout(timer)
      source.removeEventListener('abort', onAbort)
    },
  }
}
const statusFailure = status => {
  if (status === 429) return fail('gateway-rate-limited')
  if (status >= 500) return fail('gateway-unavailable')
  return fail('gateway-http')
}
export class GatewayModelAdapter {
  #options
  constructor(options) {
    this.#options = resolveOptions(options)
  }
  async *run(request, signal) {
    const deadline = createDeadline(signal, this.#options.deadlineMs)
    let reader
    let streamComplete = false
    try {
      const response = await waitWithSignal(
        this.#options.fetch(this.#options.path, {
          method: 'POST',
          headers: {
            accept: 'application/x-ndjson',
            'content-type': 'application/json',
          },
          body: JSON.stringify(gatewayBody(request, this.#options)),
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: deadline.signal,
        }),
        deadline.signal,
      )
      if (!response.ok) statusFailure(response.status)
      if (!/^application\/x-ndjson(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')) {
        fail('invalid-gateway-stream')
      }
      const body = response.body
      if (!body) fail('invalid-gateway-stream')
      reader = body.getReader()
      const correlation = {
        sessionId: request.sessionId,
        taskId: request.taskId,
        stepId: request.stepId,
        modelRequestId: request.modelRequestId,
      }
      const frames = await readFrames(reader, correlation, this.#options, deadline.signal)
      streamComplete = true
      for (const event of modelEventsFrom(frames, this.#options)) yield event
    } catch (error) {
      if (signal.aborted) throw new DOMException(ERROR_MESSAGES['gateway-aborted'], 'AbortError')
      if (deadline.deadlineExceeded()) throw new GatewayModelAdapterError('gateway-deadline')
      if (error instanceof GatewayModelAdapterError) throw error
      throw new GatewayModelAdapterError('gateway-unavailable')
    } finally {
      deadline.close()
      if (reader) {
        if (!streamComplete) await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    }
  }
}
