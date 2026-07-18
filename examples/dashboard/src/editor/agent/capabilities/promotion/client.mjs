export const LOCAL_MATERIAL_PROMOTION_ROUTE = '/api/materials/promote'
export const LOCAL_MATERIAL_PROMOTION_QUERY_ROUTE = '/api/materials/promotion/query'
export const LOCAL_MATERIAL_PROMOTION_AVAILABILITY_ROUTE = '/api/materials/promotion/availability'

const MAX_RESPONSE_BYTES = 1024 * 1024

const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return value
}

const requireSameOriginRoute = (value, label) => {
  const route = requireNonEmptyString(value, label)
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\') || route.includes('\0')) {
    throw new TypeError(`${label} must be a same-origin absolute path`)
  }
  return route
}

const cloneJson = (value, label) => {
  try {
    return structuredClone(value)
  } catch (error) {
    throw new TypeError(`${label} must be structured-cloneable JSON`, { cause: error })
  }
}

export class DashboardLocalMaterialPromotionClientError extends Error {
  constructor(code, { status = 0, retryable = false, message = 'Local material promotion request failed' } = {}) {
    super(message)
    this.name = 'DashboardLocalMaterialPromotionClientError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

const invalidResponse = (response, message) =>
  new DashboardLocalMaterialPromotionClientError('invalid-response', {
    status: response.status,
    message,
  })

const cancelBody = async body => {
  try {
    await body?.cancel?.()
  } catch {
    // The response is already rejected; cancellation is best-effort cleanup.
  }
}

const readDeclaredResponseLength = response => {
  const value = response.headers?.get?.('content-length')
  if (typeof value !== 'string' || !/^\d+$/u.test(value.trim())) return null
  const length = Number(value)
  return Number.isSafeInteger(length) ? length : null
}

const readResponseText = async response => {
  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    if (typeof response.text !== 'function') {
      throw invalidResponse(response, 'Local material promotion response body is unreadable')
    }
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw invalidResponse(response, 'Local material promotion response exceeded its byte budget')
    }
    return text
  }

  const reader = body.getReader()
  const chunks = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) {
        await cancelBody(reader)
        throw invalidResponse(response, 'Local material promotion response body is invalid')
      }
      byteLength += value.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) {
        await cancelBody(reader)
        throw invalidResponse(response, 'Local material promotion response exceeded its byte budget')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof DashboardLocalMaterialPromotionClientError) throw error
    throw invalidResponse(response, 'Local material promotion response body could not be read')
  } finally {
    reader.releaseLock?.()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

const decodeJsonResponse = async response => {
  const declaredLength = readDeclaredResponseLength(response)
  if (declaredLength !== null && declaredLength > MAX_RESPONSE_BYTES) {
    await cancelBody(response.body)
    throw invalidResponse(response, 'Local material promotion response exceeded its byte budget')
  }
  const contentType = response.headers?.get?.('content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    await cancelBody(response.body)
    throw invalidResponse(response, 'Local material promotion returned a non-JSON response')
  }
  const text = await readResponseText(response)
  try {
    const value = JSON.parse(text)
    if (!isPlainRecord(value)) throw new TypeError('response is not a JSON object')
    return value
  } catch (error) {
    if (error instanceof DashboardLocalMaterialPromotionClientError) throw error
    throw invalidResponse(response, 'Local material promotion returned invalid JSON')
  }
}

const errorFromResponse = (response, body) => {
  const error = isPlainRecord(body.error) ? body.error : null
  return new DashboardLocalMaterialPromotionClientError(
    typeof error?.code === 'string' && error.code ? error.code : 'request-failed',
    {
      status: response.status,
      retryable: error?.retryable === true,
      message:
        typeof error?.message === 'string' && error.message ? error.message : 'Local material promotion request failed',
    },
  )
}

const fetchJson = async (fetchImpl, route, { body, method }) => {
  let response
  try {
    response = await fetchImpl(route, {
      method,
      credentials: 'same-origin',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    throw new DashboardLocalMaterialPromotionClientError('transport-failed', {
      retryable: true,
      message: 'Local material promotion server could not be reached',
    })
  }
  const value = await decodeJsonResponse(response)
  if (!response.ok) throw errorFromResponse(response, value)
  return value
}

const unavailableReason = reason => {
  if (reason === 'node-version' || reason === 'promotion-requires-node-20') {
    return 'promotion-requires-node-20'
  }
  return 'promotion-server-unavailable'
}

export const createDashboardSameOriginLocalMaterialPromotionClient = (options = {}) => {
  if (typeof options.fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function')
  const fetchImpl = options.fetchImpl
  const projectId = requireNonEmptyString(options.projectId, 'projectId')
  const routes = Object.freeze({
    promote: requireSameOriginRoute(options.routes?.promote ?? LOCAL_MATERIAL_PROMOTION_ROUTE, 'routes.promote'),
    query: requireSameOriginRoute(options.routes?.query ?? LOCAL_MATERIAL_PROMOTION_QUERY_ROUTE, 'routes.query'),
    availability: requireSameOriginRoute(
      options.routes?.availability ?? LOCAL_MATERIAL_PROMOTION_AVAILABILITY_ROUTE,
      'routes.availability',
    ),
  })

  return Object.freeze({
    async checkAvailability() {
      try {
        const value = await fetchJson(fetchImpl, routes.availability, {
          method: 'POST',
          body: { schemaVersion: 1 },
        })
        if (value.schemaVersion !== 1 || typeof value.available !== 'boolean') {
          throw new DashboardLocalMaterialPromotionClientError('invalid-response')
        }
        return Object.freeze({
          schemaVersion: 1,
          available: value.available,
          reason: value.available ? null : unavailableReason(value.reason),
        })
      } catch (error) {
        if (
          error instanceof DashboardLocalMaterialPromotionClientError &&
          (error.code === 'node-version' || error.code === 'promotion-requires-node-20')
        ) {
          return Object.freeze({ schemaVersion: 1, available: false, reason: 'promotion-requires-node-20' })
        }
        return Object.freeze({ schemaVersion: 1, available: false, reason: 'promotion-server-unavailable' })
      }
    },
    async promote(request) {
      return cloneJson(
        await fetchJson(fetchImpl, routes.promote, { method: 'POST', body: request }),
        'promotion result',
      )
    },
    async queryPromotion(request) {
      const promotionId = requireNonEmptyString(request?.promotionId, 'queryPromotion.promotionId')
      try {
        return cloneJson(
          await fetchJson(fetchImpl, routes.query, {
            method: 'POST',
            body: { schemaVersion: 1, projectId, promotionId },
          }),
          'promotion query result',
        )
      } catch (error) {
        if (error instanceof DashboardLocalMaterialPromotionClientError && error.code === 'promotion-not-found') {
          return null
        }
        throw error
      }
    },
  })
}
