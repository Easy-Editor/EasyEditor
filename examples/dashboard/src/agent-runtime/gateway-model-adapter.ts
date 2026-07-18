import type { ModelAdapter, ModelEvent, ModelTurnRequest } from '@easy-editor/agent-runtime/worker'

export const DEFAULT_GATEWAY_MODEL_PATH = '/api/agent/model/stream'

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

export interface GatewayModelAdapterOptions {
  readonly providerId: string
  readonly model: string
  readonly path?: string
  readonly fetch?: typeof globalThis.fetch
  readonly deadlineMs?: number
  readonly maxResponseBytes?: number
  readonly maxResponseLines?: number
  readonly maxEvents?: number
  readonly maxOutputBytes?: number
}

export type GatewayModelAdapterErrorCode =
  | 'gateway-aborted'
  | 'gateway-deadline'
  | 'gateway-http'
  | 'gateway-rate-limited'
  | 'gateway-unavailable'
  | 'invalid-config'
  | 'invalid-correlation'
  | 'invalid-gateway-stream'
  | 'invalid-model-output'
  | 'request-budget-exceeded'
  | 'response-budget-exceeded'

const ERROR_MESSAGES: Readonly<Record<GatewayModelAdapterErrorCode, string>> = Object.freeze({
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
  readonly code: GatewayModelAdapterErrorCode

  constructor(code: GatewayModelAdapterErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'GatewayModelAdapterError'
    this.code = code
  }
}

type ResolvedOptions = Readonly<{
  providerId: string
  model: string
  path: string
  fetch: typeof globalThis.fetch
  deadlineMs: number
  maxResponseBytes: number
  maxResponseLines: number
  maxEvents: number
  maxOutputBytes: number
}>

type Correlation = Pick<ModelTurnRequest, 'sessionId' | 'taskId' | 'stepId' | 'modelRequestId'>

function fail(code: GatewayModelAdapterErrorCode): never {
  throw new GatewayModelAdapterError(code)
}

const positiveInteger = (value: number | undefined, fallback: number): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) fail('invalid-config')
  return resolved
}

const resolveOptions = (options: GatewayModelAdapterOptions): ResolvedOptions => {
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

const chunksOf = (value: string): readonly string[] => {
  const chunks: string[] = []
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

const gatewayBody = (request: ModelTurnRequest, options: ResolvedOptions) => {
  let serialized: string
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
    maxOutputTokens: 4_096,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const exactKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) => {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return required.every(key => Object.hasOwn(value, key)) && keys.every(key => allowed.has(key))
}

const assertCorrelation = (frame: Record<string, unknown>, expected: Correlation) => {
  for (const key of ['sessionId', 'taskId', 'stepId', 'modelRequestId'] as const) {
    if (frame[key] !== expected[key]) fail('invalid-correlation')
  }
}

const parseFrame = (line: string, correlation: Correlation): Record<string, unknown> => {
  let frame: unknown
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

const waitWithSignal = <Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    let settled = false
    const settle = (callback: () => void) => {
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

const readFrames = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  correlation: Correlation,
  options: ResolvedOptions,
  signal: AbortSignal,
) => {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const frames: Record<string, unknown>[] = []
  let responseBytes = 0
  let buffer = ''
  try {
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
  } catch (error) {
    if (error instanceof GatewayModelAdapterError) throw error
    throw error
  }
  if (buffer.length > 0 || frames.length === 0) fail('invalid-gateway-stream')
  return frames
}

const modelEventsFrom = (frames: readonly Record<string, unknown>[], options: ResolvedOptions): readonly unknown[] => {
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
      const delta = frame.delta as string
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
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    fail('invalid-model-output')
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > options.maxEvents) fail('invalid-model-output')
  return parsed
}

const createDeadline = (source: AbortSignal, timeoutMs: number) => {
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

const statusFailure = (status: number): never => {
  if (status === 429) return fail('gateway-rate-limited')
  if (status >= 500) return fail('gateway-unavailable')
  return fail('gateway-http')
}

export class GatewayModelAdapter implements ModelAdapter {
  readonly #options: ResolvedOptions

  constructor(options: GatewayModelAdapterOptions) {
    this.#options = resolveOptions(options)
  }

  async *run(request: ModelTurnRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const deadline = createDeadline(signal, this.#options.deadlineMs)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
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
      for (const event of modelEventsFrom(frames, this.#options)) yield event as ModelEvent
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
