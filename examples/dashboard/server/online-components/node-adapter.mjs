import { OnlineComponentDependencyError, createDependencyErrorEnvelope } from './errors.mjs'
import { ONLINE_COMPONENT_DEPENDENCY_ROUTE } from './handler.mjs'

const MAX_INBOUND_BYTES = 16 * 1024
const DEFAULT_INBOUND_TIMEOUT_MS = 5000

const sendJson = (response, result, closeConnection = false) => {
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

const readBody = (request, timeoutMs) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('error', onError)
      request.removeListener('aborted', onAborted)
      callback(value)
    }
    const onData = chunk => {
      bytes += chunk.length
      if (bytes > MAX_INBOUND_BYTES) {
        finish(reject, new OnlineComponentDependencyError('invalid-request', 413, 'Request is invalid'))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => finish(resolve, Buffer.concat(chunks))
    const onError = error => finish(reject, error)
    const onAborted = () =>
      finish(reject, new OnlineComponentDependencyError('request-aborted', 408, 'Request was aborted', true))
    const timeout = setTimeout(
      () => finish(reject, new OnlineComponentDependencyError('request-aborted', 408, 'Request was aborted', true)),
      timeoutMs,
    )
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

export const createNodeOnlineComponentDependencyMiddleware =
  ({ handler, publicOrigins = [], inboundTimeoutMs = DEFAULT_INBOUND_TIMEOUT_MS }) =>
  async (request, response, next) => {
    let pathname
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    } catch {
      pathname = ''
    }
    if (pathname !== ONLINE_COMPONENT_DEPENDENCY_ROUTE) {
      next?.()
      return false
    }
    const controller = new AbortController()
    const onAborted = () => controller.abort(new Error('client-aborted'))
    const onClosed = () => {
      if (!response.writableEnded) onAborted()
    }
    try {
      request.once('aborted', onAborted)
      response.once('close', onClosed)
      const body = await readBody(
        request,
        Number.isInteger(inboundTimeoutMs) && inboundTimeoutMs > 0 ? inboundTimeoutMs : DEFAULT_INBOUND_TIMEOUT_MS,
      )
      const result = await handler.handle({
        method: request.method,
        path: pathname,
        headers: request.headers,
        expectedOrigins: expectedOriginsFor(request, publicOrigins),
        body,
        signal: controller.signal,
      })
      if (!response.destroyed) sendJson(response, result)
    } catch (error) {
      if (!response.destroyed) {
        request.resume()
        sendJson(
          response,
          createDependencyErrorEnvelope(
            error instanceof OnlineComponentDependencyError
              ? error
              : new OnlineComponentDependencyError('invalid-request', 400, 'Request is invalid'),
          ),
          true,
        )
      }
    } finally {
      request.removeListener('aborted', onAborted)
      response.removeListener('close', onClosed)
    }
    return true
  }
