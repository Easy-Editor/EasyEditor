import {
  MATERIAL_CATALOG_LIST_ROUTE,
  MATERIAL_CATALOG_READ_ROUTE,
  MATERIAL_GC_PLAN_ROUTE,
  MATERIAL_GC_RELEASE_ROUTE,
  MATERIAL_GC_SWEEP_ROUTE,
  MATERIAL_PROMOTION_AVAILABILITY_ROUTE,
  MATERIAL_PROMOTION_MAX_INBOUND_BYTES,
  MATERIAL_PROMOTION_QUERY_ROUTE,
  MATERIAL_PROMOTION_ROUTE,
} from './handler.mjs'
import { abortedPromotion, createPromotionErrorEnvelope, invalidPromotionRequest } from './promotion-error.mjs'

const DEFAULT_INBOUND_TIMEOUT_MS = 5000
const DEFAULT_OPERATION_TIMEOUT_MS = 60_000
const MATERIAL_PROMOTION_ROUTES = new Set([
  MATERIAL_CATALOG_LIST_ROUTE,
  MATERIAL_CATALOG_READ_ROUTE,
  MATERIAL_GC_PLAN_ROUTE,
  MATERIAL_GC_RELEASE_ROUTE,
  MATERIAL_GC_SWEEP_ROUTE,
  MATERIAL_PROMOTION_ROUTE,
  MATERIAL_PROMOTION_QUERY_ROUTE,
  MATERIAL_PROMOTION_AVAILABILITY_ROUTE,
])

const sendJson = (response, result, closeConnection = false) => {
  const body = Buffer.from(JSON.stringify(result.body))
  if (closeConnection) response.shouldKeepAlive = false
  response.writeHead(result.status, {
    'Cache-Control': 'no-store',
    ...(closeConnection ? { Connection: 'close' } : {}),
    'Content-Length': body.byteLength,
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

const readBody = (request, timeoutMs, signal) =>
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
      signal?.removeEventListener('abort', onSignalAborted)
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const onData = chunk => {
      bytes += chunk.byteLength
      if (bytes >= MATERIAL_PROMOTION_MAX_INBOUND_BYTES) {
        finish(reject, invalidPromotionRequest(413))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => finish(resolve, Buffer.concat(chunks))
    const onError = error => finish(reject, error)
    const onAborted = () => finish(reject, abortedPromotion())
    const onSignalAborted = () => finish(reject, abortedPromotion())
    const timeout = setTimeout(() => finish(reject, abortedPromotion()), timeoutMs)
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
    request.on('aborted', onAborted)
    signal?.addEventListener('abort', onSignalAborted, { once: true })
    if (signal?.aborted) onSignalAborted()
  })

const expectedOriginsFor = (request, publicOrigins) => {
  if (publicOrigins?.length) return publicOrigins
  const host = request.headers.host
  if (typeof host !== 'string' || /[\r\n,]/u.test(host)) return []
  return [`${request.socket.encrypted ? 'https' : 'http'}://${host}`]
}

export const createNodeMaterialPromotionMiddleware = ({
  handler,
  publicOrigins = [],
  inboundTimeoutMs = DEFAULT_INBOUND_TIMEOUT_MS,
  operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
} = {}) => {
  if (!handler || typeof handler.handle !== 'function') throw new TypeError('handler.handle must be a function')
  return async (request, response, next) => {
    let pathname
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    } catch {
      pathname = ''
    }
    if (!MATERIAL_PROMOTION_ROUTES.has(pathname)) {
      next?.()
      return false
    }

    const controller = new AbortController()
    const onAborted = () => controller.abort(abortedPromotion())
    const onClosed = () => {
      if (!response.writableEnded) onAborted()
    }
    let operationTimeout
    try {
      request.once('aborted', onAborted)
      response.once('close', onClosed)
      operationTimeout = setTimeout(
        () => controller.abort(abortedPromotion()),
        Number.isInteger(operationTimeoutMs) && operationTimeoutMs > 0
          ? operationTimeoutMs
          : DEFAULT_OPERATION_TIMEOUT_MS,
      )
      const body = await readBody(
        request,
        Number.isInteger(inboundTimeoutMs) && inboundTimeoutMs > 0 ? inboundTimeoutMs : DEFAULT_INBOUND_TIMEOUT_MS,
        controller.signal,
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
        sendJson(response, createPromotionErrorEnvelope(error?.status ? error : invalidPromotionRequest()), true)
      }
    } finally {
      clearTimeout(operationTimeout)
      // This is also safe when body reading failed before the timer was observed.
      controller.abort(controller.signal.reason ?? abortedPromotion())
      request.removeListener('aborted', onAborted)
      response.removeListener('close', onClosed)
    }
    return true
  }
}
