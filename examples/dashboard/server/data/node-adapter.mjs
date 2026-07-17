import { DataProxyError, createErrorEnvelope } from './errors.mjs'

export const DATA_PROXY_ROUTE = '/api/data/credentialed-json'
const MAX_INBOUND_BYTES = 128 * 1024
const DEFAULT_INBOUND_TIMEOUT_MS = 5000

const sendJson = (response, result, { closeConnection = false } = {}) => {
  const body = Buffer.from(JSON.stringify(result.body))
  if (closeConnection) response.shouldKeepAlive = false
  response.writeHead(result.status, {
    'Cache-Control': 'no-store',
    ...(closeConnection ? { Connection: 'close' } : {}),
    'Content-Length': body.length,
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

const readBody = (request, { timeoutMs, onTimeout }) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let settled = false
    const cleanup = () => {
      clearTimeout(timeout)
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('error', onError)
      request.removeListener('aborted', onAborted)
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const onData = chunk => {
      bytes += chunk.length
      if (bytes > MAX_INBOUND_BYTES) {
        finish(reject, new DataProxyError('invalid-request', 413, 'Request body exceeded its byte limit'))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => finish(resolve, Buffer.concat(chunks))
    const onError = error => finish(reject, error)
    const onAborted = () => finish(reject, new DataProxyError('request-aborted', 408, 'Request was aborted', true))
    const timeout = setTimeout(() => {
      const error = new DataProxyError('request-aborted', 408, 'Request body read timed out', true)
      onTimeout(error)
      finish(reject, error)
    }, timeoutMs)
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
    request.on('aborted', onAborted)
  })

const expectedOriginsFor = (request, publicOrigins) => {
  if (publicOrigins?.length) return publicOrigins
  const host = request.headers.host
  if (typeof host !== 'string' || /[\r\n,]/.test(host)) return []
  return [`${request.socket.encrypted ? 'https' : 'http'}://${host}`]
}

export const createNodeDataProxyMiddleware =
  ({ handler, publicOrigins = [], inboundTimeoutMs = DEFAULT_INBOUND_TIMEOUT_MS }) =>
  async (request, response, next) => {
    let pathname
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    } catch {
      pathname = ''
    }
    if (pathname !== DATA_PROXY_ROUTE) {
      next?.()
      return false
    }
    const clientAbort = new AbortController()
    const onRequestAborted = () => clientAbort.abort(new Error('client-aborted'))
    const onResponseClosed = () => {
      if (!response.writableEnded) onRequestAborted()
    }
    try {
      if (request.aborted) onRequestAborted()
      else request.once('aborted', onRequestAborted)
      response.once('close', onResponseClosed)
      const body = await readBody(request, {
        timeoutMs:
          Number.isInteger(inboundTimeoutMs) && inboundTimeoutMs > 0 ? inboundTimeoutMs : DEFAULT_INBOUND_TIMEOUT_MS,
        onTimeout: error => clientAbort.abort(error),
      })
      const result = await handler.handle({
        method: request.method,
        path: pathname,
        headers: request.headers,
        body,
        signal: clientAbort.signal,
        expectedOrigins: expectedOriginsFor(request, publicOrigins),
      })
      if (!response.destroyed) sendJson(response, result)
    } catch (error) {
      if (!response.destroyed) {
        request.resume()
        sendJson(
          response,
          error instanceof DataProxyError
            ? createErrorEnvelope(error)
            : {
                status: 400,
                body: {
                  schemaVersion: 1,
                  error: { code: 'invalid-request', message: 'Request is invalid', retryable: false },
                },
              },
          { closeConnection: true },
        )
      }
    } finally {
      request.removeListener('aborted', onRequestAborted)
      response.removeListener('close', onResponseClosed)
    }
    return true
  }
