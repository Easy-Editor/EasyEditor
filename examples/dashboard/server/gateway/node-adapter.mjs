import { MODEL_GATEWAY_MAX_BODY_BYTES, MODEL_GATEWAY_PATH } from './contract.mjs'

const encoder = new TextEncoder()

class AdapterFailure extends Error {
  constructor(code, status, message, retryable = false) {
    super(message)
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

const failure = {
  invalid: status => new AdapterFailure('INVALID_REQUEST', status, 'Gateway request is invalid'),
  aborted: () => new AdapterFailure('REQUEST_ABORTED', 408, 'Gateway request was aborted', true),
  failed: () => new AdapterFailure('GATEWAY_FAILED', 502, 'Model gateway request failed', true),
}

const safeFailure = error => (error instanceof AdapterFailure ? error : failure.invalid(400))

const errorBytes = error =>
  encoder.encode(
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'error',
      error: { code: error.code, message: error.message, retryable: error.retryable },
    })}\n`,
  )

const combineChunks = (chunks, byteLength) => {
  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

const readBody = (request, { signal, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let byteLength = 0
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('error', onError)
      request.removeListener('aborted', onAborted)
      signal.removeEventListener('abort', onSignalAbort)
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const onData = value => {
      if (!(value instanceof Uint8Array)) {
        finish(reject, failure.invalid(400))
        return
      }
      byteLength += value.byteLength
      if (byteLength > MODEL_GATEWAY_MAX_BODY_BYTES) {
        finish(reject, failure.invalid(413))
        return
      }
      chunks.push(value)
    }
    const onEnd = () => finish(resolve, combineChunks(chunks, byteLength))
    const onError = () => finish(reject, failure.invalid(400))
    const onAborted = () => finish(reject, failure.aborted())
    const onSignalAbort = () => finish(reject, signal.reason ?? failure.aborted())
    const timer = setTimeout(() => finish(reject, failure.aborted()), timeoutMs)
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    request.once('aborted', onAborted)
    signal.addEventListener('abort', onSignalAbort, { once: true })
    if (request.aborted || signal.aborted) onSignalAbort()
  })

const waitForDrain = (response, signal) =>
  new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      response.removeListener('drain', onDrain)
      response.removeListener('error', onError)
      response.removeListener('close', onClose)
      signal.removeEventListener('abort', onAbort)
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const onDrain = () => finish(resolve)
    const onError = () => finish(reject, failure.failed())
    const onClose = () => finish(reject, failure.aborted())
    const onAbort = () => finish(reject, signal.reason ?? failure.aborted())
    response.once('drain', onDrain)
    response.once('error', onError)
    response.once('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted || response.destroyed) onAbort()
  })

const sendFailure = (response, error) => {
  if (response.destroyed || response.writableEnded) return
  const body = errorBytes(error)
  response.shouldKeepAlive = false
  response.writeHead(error.status, {
    'Cache-Control': 'no-store',
    Connection: 'close',
    'Content-Length': body.byteLength,
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

const pathnameOf = request => {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname
  } catch {
    return ''
  }
}

const expectedOriginsFor = (request, publicOrigins) => {
  if (publicOrigins.length > 0) return publicOrigins
  const host = request.headers?.host
  if (typeof host !== 'string' || /[\r\n,]/u.test(host)) return []
  return [`${request.socket?.encrypted ? 'https' : 'http'}://${host}`]
}

const hasAllowedOrigin = (request, publicOrigins) => {
  const origin = request.headers?.origin
  if (typeof origin !== 'string' || /[\r\n,]/u.test(origin)) return false
  try {
    const parsed = new URL(origin)
    if (
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return false
    }
  } catch {
    return false
  }
  return expectedOriginsFor(request, publicOrigins).includes(origin)
}

export const createNodeModelGatewayMiddleware = ({ handler, inboundTimeoutMs = 5_000, publicOrigins = [] } = {}) => {
  if (!handler || typeof handler.handle !== 'function') throw new TypeError('handler.handle must be a function')
  if (!Number.isInteger(inboundTimeoutMs) || inboundTimeoutMs < 1) {
    throw new TypeError('inboundTimeoutMs must be a positive integer')
  }
  if (!Array.isArray(publicOrigins) || publicOrigins.some(origin => typeof origin !== 'string')) {
    throw new TypeError('publicOrigins must be an array of strings')
  }
  return async (request, response, next) => {
    const pathname = pathnameOf(request)
    if (pathname !== MODEL_GATEWAY_PATH) {
      next?.()
      return false
    }

    if (!hasAllowedOrigin(request, publicOrigins)) {
      request.resume?.()
      sendFailure(response, failure.invalid(403))
      return true
    }

    const controller = new AbortController()
    const abort = () => controller.abort(failure.aborted())
    const onResponseClose = () => {
      if (!response.writableEnded) abort()
    }
    request.once('aborted', abort)
    response.once('close', onResponseClose)
    try {
      const body = await readBody(request, { signal: controller.signal, timeoutMs: inboundTimeoutMs })
      const result = await handler.handle({
        method: request.method,
        path: pathname,
        headers: request.headers,
        body,
        signal: controller.signal,
      })
      if (
        !result ||
        !Number.isInteger(result.status) ||
        !result.headers ||
        typeof result.headers !== 'object' ||
        !result.body ||
        typeof result.body[Symbol.asyncIterator] !== 'function'
      ) {
        throw failure.failed()
      }
      if (response.destroyed || response.writableEnded) return true
      response.writeHead(result.status, result.headers)
      for await (const chunk of result.body) {
        if (!(chunk instanceof Uint8Array)) throw failure.failed()
        if (controller.signal.aborted || response.destroyed || response.writableEnded) throw failure.aborted()
        if (!response.write(chunk)) await waitForDrain(response, controller.signal)
      }
      if (!response.destroyed && !response.writableEnded) response.end()
    } catch (error) {
      const safe = safeFailure(error)
      controller.abort(safe)
      request.resume?.()
      if (!response.headersSent) sendFailure(response, safe)
      else if (!response.destroyed && !response.writableEnded) response.end()
    } finally {
      controller.abort(controller.signal.reason ?? failure.aborted())
      request.removeListener('aborted', abort)
      response.removeListener('close', onResponseClose)
    }
    return true
  }
}
