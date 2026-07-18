const SSE_LINE_BYTE_LIMIT = 64 * 1024
const SSE_TOTAL_BYTE_LIMIT = 1024 * 1024
const encoder = new TextEncoder()

class ProviderFailure extends Error {
  constructor(code, status, message, retryable = false) {
    super(message)
    this.name = 'ProviderFailure'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

const failure = {
  aborted: () => new ProviderFailure('REQUEST_ABORTED', 408, 'Model provider request was aborted', true),
  timeout: () => new ProviderFailure('PROVIDER_TIMEOUT', 504, 'Model provider request timed out', true),
  rateLimited: () => new ProviderFailure('PROVIDER_RATE_LIMITED', 429, 'Model provider is busy', true),
  unavailable: status => new ProviderFailure('PROVIDER_UNAVAILABLE', status, 'Model provider is unavailable', true),
  rejected: () => new ProviderFailure('PROVIDER_REJECTED', 502, 'Model provider rejected the request'),
  invalid: () => new ProviderFailure('PROVIDER_RESPONSE_INVALID', 502, 'Model provider response is invalid'),
  disconnected: () => new ProviderFailure('PROVIDER_DISCONNECTED', 502, 'Model provider disconnected', true),
}

const combinedSignal = (source, timeoutMs) => {
  const controller = new AbortController()
  const onAbort = () => controller.abort(source.reason ?? failure.aborted())
  source.addEventListener('abort', onAbort, { once: true })
  if (source.aborted) onAbort()
  const timer = setTimeout(() => controller.abort(failure.timeout()), timeoutMs)
  let closed = false
  return {
    signal: controller.signal,
    abort(reason = failure.aborted()) {
      controller.abort(reason)
    },
    close() {
      if (closed) return
      closed = true
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

const safeFailure = (error, deadline, source) => {
  if (error instanceof ProviderFailure) return error
  if (deadline.signal.aborted && deadline.signal.reason instanceof ProviderFailure) return deadline.signal.reason
  if (source.aborted || error?.name === 'AbortError') return failure.aborted()
  return failure.unavailable(502)
}

const usageOf = value => {
  if (value === undefined || value === null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure.invalid()
  const mapping = [
    ['prompt_tokens', 'inputTokens'],
    ['completion_tokens', 'outputTokens'],
    ['total_tokens', 'totalTokens'],
  ]
  const allowed = new Set(mapping.map(([providerKey]) => providerKey))
  if (Object.keys(value).some(key => !allowed.has(key))) throw failure.invalid()
  const usage = {}
  for (const [providerKey, outputKey] of mapping) {
    if (!Object.hasOwn(value, providerKey)) continue
    const count = value[providerKey]
    if (!Number.isFinite(count) || !Number.isInteger(count) || count < 0) throw failure.invalid()
    usage[outputKey] = count
  }
  return Object.keys(usage).length > 0 ? usage : undefined
}

const parseDataFrame = value => {
  let payload
  try {
    payload = JSON.parse(value)
  } catch {
    throw failure.invalid()
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.choices)) {
    throw failure.invalid()
  }
  if (payload.choices.length !== 1) throw failure.invalid()
  const choice = payload.choices[0]
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) throw failure.invalid()
  const delta = choice.delta
  const finishReason = choice.finish_reason
  const usage = usageOf(payload.usage)
  if (delta && typeof delta === 'object' && !Array.isArray(delta) && typeof delta.content === 'string') {
    if (finishReason !== undefined && finishReason !== null) throw failure.invalid()
    return [{ kind: 'delta', delta: delta.content }]
  }
  if (['stop', 'length', 'tool_calls', 'content_filter'].includes(finishReason)) {
    return [{ kind: 'completed', finishReason, ...(usage ? { usage } : {}) }]
  }
  throw failure.invalid()
}

const parseSse = (body, deadline, source) => {
  const events = async function* () {
    const iterator = body[Symbol.asyncIterator]()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let pending = ''
    let totalBytes = 0
    let completed = false
    let done = false
    const parseLine = line => {
      const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
      if (encoder.encode(normalized).byteLength > SSE_LINE_BYTE_LIMIT) throw failure.invalid()
      if (normalized.length === 0) return []
      if (!normalized.startsWith('data:')) throw failure.invalid()
      const data = normalized.slice(5).replace(/^ /u, '')
      if (data === '[DONE]') {
        if (!completed) throw failure.invalid()
        done = true
        return []
      }
      if (done) throw failure.invalid()
      return parseDataFrame(data)
    }
    try {
      while (!done) {
        const next = await waitWithSignal(iterator.next(), deadline.signal)
        if (next.done) break
        if (!(next.value instanceof Uint8Array)) throw failure.invalid()
        totalBytes += next.value.byteLength
        if (totalBytes > SSE_TOTAL_BYTE_LIMIT) throw failure.invalid()
        try {
          pending += decoder.decode(next.value, { stream: true })
        } catch {
          throw failure.invalid()
        }
        let newline = pending.indexOf('\n')
        while (newline >= 0) {
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          for (const event of parseLine(line)) {
            if (event.kind === 'completed') completed = true
            yield event
          }
          newline = pending.indexOf('\n')
        }
        if (encoder.encode(pending).byteLength > SSE_LINE_BYTE_LIMIT) throw failure.invalid()
      }
      try {
        pending += decoder.decode()
      } catch {
        throw failure.invalid()
      }
      if (pending.length > 0) {
        for (const event of parseLine(pending)) {
          if (event.kind === 'completed') completed = true
          yield event
        }
      }
      if (!done) throw failure.disconnected()
    } catch (error) {
      throw safeFailure(error, deadline, source)
    } finally {
      deadline.abort()
      deadline.close()
      const returned = iterator.return?.()
      if (returned && typeof returned.catch === 'function') void returned.catch(() => undefined)
    }
  }
  return events()
}

const endpointOf = baseUrl => {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) throw new TypeError('baseUrl is required')
  let url
  try {
    url = new URL(`${baseUrl.replace(/\/+$/u, '')}/chat/completions`)
  } catch {
    throw new TypeError('baseUrl is invalid')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError('baseUrl is invalid')
  }
  return url.href
}

export const createOpenAICompatibleProviderTransport = ({
  fetchImpl = globalThis.fetch,
  baseUrl,
  apiKey,
  defaultModel,
  timeoutMs = 60_000,
} = {}) => {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  if (typeof apiKey !== 'string' || apiKey.length === 0) throw new TypeError('apiKey is required')
  if (defaultModel !== undefined && (typeof defaultModel !== 'string' || defaultModel.length === 0)) {
    throw new TypeError('defaultModel is invalid')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs is invalid')
  const endpoint = endpointOf(baseUrl)

  const stream = async ({ request, signal }) => {
    if (!request || typeof request !== 'object' || !(signal instanceof AbortSignal)) {
      throw new TypeError('provider stream input is invalid')
    }
    const model = request.model || defaultModel
    if (typeof model !== 'string' || model.length === 0) throw new TypeError('provider model is invalid')
    const deadline = combinedSignal(signal, timeoutMs)
    let response
    try {
      const providerBody = {
        model,
        messages: request.messages,
        stream: true,
        ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
      }
      response = await waitWithSignal(
        fetchImpl(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(providerBody),
          signal: deadline.signal,
        }),
        deadline.signal,
      )
    } catch (error) {
      const safe = safeFailure(error, deadline, signal)
      deadline.close()
      throw safe
    }
    if (response?.status === 429) {
      deadline.close()
      throw failure.rateLimited()
    }
    if (Number.isInteger(response?.status) && response.status >= 500) {
      const status = response.status
      deadline.close()
      throw failure.unavailable(status)
    }
    if (!response?.ok) {
      deadline.close()
      throw failure.rejected()
    }
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') {
      deadline.close()
      throw failure.invalid()
    }
    return parseSse(response.body, deadline, signal)
  }

  return Object.freeze({ stream })
}
