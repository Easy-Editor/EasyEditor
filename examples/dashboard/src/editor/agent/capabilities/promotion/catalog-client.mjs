import {
  validateMaterialCatalogItem,
  validateMaterialCatalogListResponse,
} from '../../../../../shared/material-catalog-contract.mjs'

export const LOCAL_MATERIAL_CATALOG_LIST_ROUTE = '/api/materials/catalog/list'
export const LOCAL_MATERIAL_CATALOG_READ_ROUTE = '/api/materials/catalog/read'

const MAX_RESPONSE_BYTES = 1024 * 1024
const textEncoder = new TextEncoder()
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u

const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const requireBoundedString = (value, label, maximum = 512) => {
  if (typeof value !== 'string' || value.trim().length === 0 || textEncoder.encode(value).byteLength > maximum) {
    throw new TypeError(`${label} must be a bounded non-empty string`)
  }
  return value
}

const requireDigest = (value, label) => {
  if (typeof value !== 'string' || !/^sha256:[\da-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`)
  }
  return value
}

const requireIdentifier = (value, label) => {
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new TypeError(`${label} must be a bounded identifier`)
  }
  return value
}

const requireSameOriginRoute = (value, label) => {
  const route = requireBoundedString(value, label, 2048)
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\') || route.includes('\0')) {
    throw new TypeError(`${label} must be a same-origin absolute path`)
  }
  return route
}

export const normalizeLocalMaterialCatalogItem = validateMaterialCatalogItem
export const normalizeLocalMaterialCatalogList = validateMaterialCatalogListResponse

export class DashboardLocalMaterialCatalogClientError extends Error {
  constructor(code, { status = 0, retryable = false, message = 'Local material catalog request failed' } = {}) {
    super(message)
    this.name = 'DashboardLocalMaterialCatalogClientError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

const invalidResponse = (response, message) =>
  new DashboardLocalMaterialCatalogClientError('invalid-response', {
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
    if (typeof response.text !== 'function') throw invalidResponse(response, 'Catalog response body is unreadable')
    const text = await response.text()
    if (textEncoder.encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw invalidResponse(response, 'Catalog response exceeded its byte budget')
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
        throw invalidResponse(response, 'Catalog response body is invalid')
      }
      byteLength += value.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) {
        await cancelBody(reader)
        throw invalidResponse(response, 'Catalog response exceeded its byte budget')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof DashboardLocalMaterialCatalogClientError) throw error
    throw invalidResponse(response, 'Catalog response body could not be read')
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
    throw invalidResponse(response, 'Catalog response exceeded its byte budget')
  }
  const contentType = response.headers?.get?.('content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    await cancelBody(response.body)
    throw invalidResponse(response, 'Catalog endpoint returned a non-JSON response')
  }
  const text = await readResponseText(response)
  try {
    return JSON.parse(text)
  } catch {
    throw invalidResponse(response, 'Catalog endpoint returned invalid JSON')
  }
}

const errorFromResponse = (response, body) => {
  const error = isPlainRecord(body?.error) ? body.error : null
  return new DashboardLocalMaterialCatalogClientError(
    typeof error?.code === 'string' && error.code ? error.code : 'request-failed',
    {
      status: response.status,
      retryable: error?.retryable === true,
      message: typeof error?.message === 'string' && error.message ? error.message : 'Catalog request failed',
    },
  )
}

const fetchJson = async (fetchImpl, route, body, signal) => {
  let response
  try {
    response = await fetchImpl(route, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    throw new DashboardLocalMaterialCatalogClientError(error?.name === 'AbortError' ? 'aborted' : 'transport-failed', {
      retryable: error?.name !== 'AbortError',
      message: error?.name === 'AbortError' ? 'Catalog request was cancelled' : 'Catalog server could not be reached',
    })
  }
  const value = await decodeJsonResponse(response)
  if (!response.ok) throw errorFromResponse(response, value)
  return value
}

const requireCatalogProjectId = value => requireIdentifier(value, 'Catalog projectId')

export const createDashboardSameOriginLocalMaterialCatalogClient = (options = {}) => {
  if (typeof options.fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function')
  const fetchImpl = options.fetchImpl
  const routes = Object.freeze({
    list: requireSameOriginRoute(options.routes?.list ?? LOCAL_MATERIAL_CATALOG_LIST_ROUTE, 'routes.list'),
    read: requireSameOriginRoute(options.routes?.read ?? LOCAL_MATERIAL_CATALOG_READ_ROUTE, 'routes.read'),
  })

  return Object.freeze({
    async listMaterials(request) {
      const value = await fetchJson(
        fetchImpl,
        routes.list,
        { schemaVersion: 1, projectId: requireCatalogProjectId(request?.projectId) },
        request?.signal,
      )
      try {
        return normalizeLocalMaterialCatalogList(value)
      } catch (error) {
        throw invalidResponse({ status: 200 }, error instanceof Error ? error.message : 'Catalog response is invalid')
      }
    },
    async readMaterial(request) {
      const requestedIdentity = Object.freeze({
        materialId: requireIdentifier(request?.materialId, 'Catalog materialId'),
        materialVersion: requireIdentifier(request?.materialVersion, 'Catalog materialVersion'),
        buildIntegrity: requireDigest(request?.buildIntegrity, 'Catalog buildIntegrity'),
      })
      const value = await fetchJson(
        fetchImpl,
        routes.read,
        {
          schemaVersion: 1,
          projectId: requireCatalogProjectId(request?.projectId),
          ...requestedIdentity,
        },
        request?.signal,
      )
      try {
        const material = normalizeLocalMaterialCatalogItem(value)
        if (
          material.artifactRef.target.materialId !== requestedIdentity.materialId ||
          material.artifactRef.target.materialVersion !== requestedIdentity.materialVersion ||
          material.artifactRef.target.buildIntegrity !== requestedIdentity.buildIntegrity
        ) {
          throw new TypeError('Catalog item does not match the requested durable identity')
        }
        return material
      } catch (error) {
        throw invalidResponse({ status: 200 }, error instanceof Error ? error.message : 'Catalog item is invalid')
      }
    },
  })
}
