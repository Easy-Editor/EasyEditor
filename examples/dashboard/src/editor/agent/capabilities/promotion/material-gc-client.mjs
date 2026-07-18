import {
  MATERIAL_GC_SCHEMA_VERSION,
  validateMaterialGcPlan,
  validateMaterialGcPlanRequest,
  validateMaterialGcReleaseRequest,
  validateMaterialGcSweepRequest,
} from '../../../../../shared/material-gc-contract.mjs'
import { validateMaterialIdentity } from '../../../../../shared/material-promotion-contract.mjs'

export const DASHBOARD_MATERIAL_GC_PLAN_ROUTE = '/api/materials/gc/plan'
export const DASHBOARD_MATERIAL_GC_SWEEP_ROUTE = '/api/materials/gc/sweep'
export const DASHBOARD_MATERIAL_GC_RELEASE_ROUTE = '/api/materials/gc/release'

const MAX_RESPONSE_BYTES = 1024 * 1024
const textEncoder = new TextEncoder()
const digestPattern = /^sha256:[\da-f]{64}$/u
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u

const isPlainRecord = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertExactFields = (value, fields, label) => {
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be a JSON object`)
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new TypeError(`${label} fields must match the contract`)
  }
}

const requireSameOriginRoute = (value, label) => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    textEncoder.encode(value).byteLength > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new TypeError(`${label} must be a bounded same-origin absolute path`)
  }
  return value
}

const requireDigest = (value, label) => {
  if (typeof value !== 'string' || !digestPattern.test(value)) throw new TypeError(`${label} must be a sha256 digest`)
  return value
}

const requireIdentifier = (value, label) => {
  if (typeof value !== 'string' || !identifierPattern.test(value)) throw new TypeError(`${label} must be an identifier`)
  return value
}

const requirePositiveGeneration = (value, label) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer`)
  return value
}

const normalizeMaterialRefs = (value, label) => {
  if (!Array.isArray(value) || value.length > 4096) throw new TypeError(`${label} must be a bounded array`)
  const refs = value
    .map(validateMaterialIdentity)
    .sort((left, right) =>
      `${left.materialId}\0${left.materialVersion}\0${left.buildIntegrity}`.localeCompare(
        `${right.materialId}\0${right.materialVersion}\0${right.buildIntegrity}`,
      ),
    )
  const keys = refs.map(ref => `${ref.materialId}\0${ref.materialVersion}\0${ref.buildIntegrity}`)
  if (new Set(keys).size !== keys.length) throw new TypeError(`${label} must not contain duplicates`)
  return Object.freeze(refs)
}

export class DashboardMaterialGcClientError extends Error {
  constructor(code, { status = 0, retryable = false, ambiguous = false, message = 'Material GC request failed' } = {}) {
    super(message)
    this.name = 'DashboardMaterialGcClientError'
    this.code = code
    this.status = status
    this.retryable = retryable
    this.ambiguous = ambiguous
  }
}

const invalidResponse = (response, message) =>
  new DashboardMaterialGcClientError('invalid-response', {
    status: response.status,
    retryable: true,
    ambiguous: true,
    message,
  })

const cancelBody = async body => {
  try {
    await body?.cancel?.()
  } catch {
    // The response is already rejected; cancellation is best-effort cleanup.
  }
}

const declaredResponseLength = response => {
  const value = response.headers?.get?.('content-length')
  if (typeof value !== 'string' || !/^\d+$/u.test(value.trim())) return null
  const length = Number(value)
  return Number.isSafeInteger(length) ? length : null
}

const readResponseText = async response => {
  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    if (typeof response.text !== 'function') throw invalidResponse(response, 'Material GC response body is unreadable')
    const text = await response.text()
    if (textEncoder.encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw invalidResponse(response, 'Material GC response exceeded its byte budget')
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
        throw invalidResponse(response, 'Material GC response body is invalid')
      }
      byteLength += value.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) {
        await cancelBody(reader)
        throw invalidResponse(response, 'Material GC response exceeded its byte budget')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof DashboardMaterialGcClientError) throw error
    throw invalidResponse(response, 'Material GC response body could not be read')
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
  const length = declaredResponseLength(response)
  if (length !== null && length > MAX_RESPONSE_BYTES) {
    await cancelBody(response.body)
    throw invalidResponse(response, 'Material GC response exceeded its byte budget')
  }
  const contentType = response.headers?.get?.('content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    await cancelBody(response.body)
    throw invalidResponse(response, 'Material GC endpoint returned a non-JSON response')
  }
  const text = await readResponseText(response)
  try {
    const value = JSON.parse(text)
    if (!isPlainRecord(value)) throw new TypeError('response is not an object')
    return value
  } catch (error) {
    if (error instanceof DashboardMaterialGcClientError) throw error
    throw invalidResponse(response, 'Material GC endpoint returned invalid JSON')
  }
}

const errorFromResponse = (response, value) => {
  try {
    assertExactFields(value, ['error', 'schemaVersion'], 'material-gc-error-response')
    if (value.schemaVersion !== MATERIAL_GC_SCHEMA_VERSION) {
      throw new TypeError('material-gc-error-response schema is unsupported')
    }
    assertExactFields(value.error, ['code', 'message', 'retryable'], 'material-gc-error-response.error')
  } catch {
    throw invalidResponse(response, 'Material GC endpoint returned an invalid error response')
  }
  const error = value.error
  if (
    typeof error.code !== 'string' ||
    error.code.length === 0 ||
    typeof error.message !== 'string' ||
    error.message.length === 0 ||
    typeof error.retryable !== 'boolean'
  ) {
    throw invalidResponse(response, 'Material GC endpoint returned an invalid error response')
  }
  const statusIsTransient = response.status === 408 || response.status === 425 || response.status === 429
  const ambiguous = response.status >= 500 || statusIsTransient || error.retryable
  return new DashboardMaterialGcClientError(error.code, {
    status: response.status,
    retryable: error.retryable,
    ambiguous,
    message: error.message,
  })
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
    const aborted = error?.name === 'AbortError' || signal?.aborted === true
    throw new DashboardMaterialGcClientError(aborted ? 'aborted' : 'transport-failed', {
      retryable: !aborted,
      ambiguous: true,
      message: aborted ? 'Material GC request was cancelled' : 'Material GC server could not be reached',
    })
  }
  const value = await decodeJsonResponse(response)
  if (!response.ok) throw errorFromResponse(response, value)
  return value
}

const normalizeSweepResult = value => {
  assertExactFields(
    value,
    ['deletedMaterials', 'planHash', 'registryGeneration', 'replicaGeneration', 'schemaVersion'],
    'material-gc-sweep-result',
  )
  if (value.schemaVersion !== MATERIAL_GC_SCHEMA_VERSION) {
    throw new TypeError('material-gc-sweep-result schema is unsupported')
  }
  return Object.freeze({
    schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
    deletedMaterials: normalizeMaterialRefs(value.deletedMaterials, 'material-gc-sweep-result.deletedMaterials'),
    registryGeneration: requirePositiveGeneration(
      value.registryGeneration,
      'material-gc-sweep-result.registryGeneration',
    ),
    replicaGeneration: requirePositiveGeneration(value.replicaGeneration, 'material-gc-sweep-result.replicaGeneration'),
    planHash: requireDigest(value.planHash, 'material-gc-sweep-result.planHash'),
  })
}

const normalizeReleaseResult = value => {
  assertExactFields(
    value,
    ['projectId', 'registryGeneration', 'replicaGeneration', 'replicaId', 'requestDigest', 'schemaVersion', 'status'],
    'material-gc-release-result',
  )
  if (value.schemaVersion !== MATERIAL_GC_SCHEMA_VERSION || value.status !== 'released') {
    throw new TypeError('material-gc-release-result schema is unsupported')
  }
  return Object.freeze({
    schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
    status: 'released',
    projectId: requireIdentifier(value.projectId, 'material-gc-release-result.projectId'),
    replicaId: requireIdentifier(value.replicaId, 'material-gc-release-result.replicaId'),
    replicaGeneration: requirePositiveGeneration(
      value.replicaGeneration,
      'material-gc-release-result.replicaGeneration',
    ),
    requestDigest: requireDigest(value.requestDigest, 'material-gc-release-result.requestDigest'),
    registryGeneration: requirePositiveGeneration(
      value.registryGeneration,
      'material-gc-release-result.registryGeneration',
    ),
  })
}

export const createDashboardSameOriginMaterialGcClient = (options = {}) => {
  if (typeof options.fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function')
  const fetchImpl = options.fetchImpl
  const routes = Object.freeze({
    plan: requireSameOriginRoute(options.routes?.plan ?? DASHBOARD_MATERIAL_GC_PLAN_ROUTE, 'routes.plan'),
    sweep: requireSameOriginRoute(options.routes?.sweep ?? DASHBOARD_MATERIAL_GC_SWEEP_ROUTE, 'routes.sweep'),
    release: requireSameOriginRoute(options.routes?.release ?? DASHBOARD_MATERIAL_GC_RELEASE_ROUTE, 'routes.release'),
  })

  return Object.freeze({
    async planGc(request, { signal } = {}) {
      const normalized = validateMaterialGcPlanRequest(request)
      try {
        return validateMaterialGcPlan(await fetchJson(fetchImpl, routes.plan, normalized, signal))
      } catch (error) {
        if (error instanceof DashboardMaterialGcClientError) throw error
        throw invalidResponse({ status: 200, ok: true }, error instanceof Error ? error.message : 'Invalid GC plan')
      }
    },
    async sweepGc(request, { signal } = {}) {
      const normalized = validateMaterialGcSweepRequest(request)
      try {
        return normalizeSweepResult(await fetchJson(fetchImpl, routes.sweep, normalized, signal))
      } catch (error) {
        if (error instanceof DashboardMaterialGcClientError) throw error
        throw invalidResponse({ status: 200, ok: true }, error instanceof Error ? error.message : 'Invalid GC sweep')
      }
    },
    async releaseGc(request, { signal } = {}) {
      const normalized = validateMaterialGcReleaseRequest(request)
      try {
        return normalizeReleaseResult(await fetchJson(fetchImpl, routes.release, normalized, signal))
      } catch (error) {
        if (error instanceof DashboardMaterialGcClientError) throw error
        throw invalidResponse({ status: 200, ok: true }, error instanceof Error ? error.message : 'Invalid GC release')
      }
    },
  })
}
