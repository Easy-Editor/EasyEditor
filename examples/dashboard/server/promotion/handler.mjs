import {
  createPromotionErrorEnvelope,
  invalidPromotionRequest,
  normalizePromotionError,
  promotionError,
  runPromotionPhase,
  unavailablePromotion,
} from './promotion-error.mjs'
import { normalizePromotionHeaders } from './request-contract.mjs'

export const MATERIAL_PROMOTION_ROUTE = '/api/materials/promote'
export const MATERIAL_PROMOTION_QUERY_ROUTE = '/api/materials/promotion/query'
export const MATERIAL_PROMOTION_AVAILABILITY_ROUTE = '/api/materials/promotion/availability'
export const MATERIAL_CATALOG_LIST_ROUTE = '/api/materials/catalog/list'
export const MATERIAL_CATALOG_READ_ROUTE = '/api/materials/catalog/read'
export const MATERIAL_GC_PLAN_ROUTE = '/api/materials/gc/plan'
export const MATERIAL_GC_SWEEP_ROUTE = '/api/materials/gc/sweep'
export const MATERIAL_GC_RELEASE_ROUTE = '/api/materials/gc/release'
export const MATERIAL_PROMOTION_MAX_INBOUND_BYTES = 3 * 1024 * 1024

const parseJsonBody = request => {
  const body =
    typeof request.body === 'string' ? Buffer.from(request.body) : Buffer.from(request.body ?? new Uint8Array())
  if (body.byteLength >= MATERIAL_PROMOTION_MAX_INBOUND_BYTES) throw invalidPromotionRequest(413)
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw invalidPromotionRequest()
  }
}

const parseTransportRequest = request => {
  const headers = normalizePromotionHeaders(request?.headers)
  if (!Array.isArray(request?.expectedOrigins) || !request.expectedOrigins.includes(headers.origin)) {
    throw invalidPromotionRequest(403)
  }

  if (request.path === MATERIAL_PROMOTION_AVAILABILITY_ROUTE) {
    if (request.method === 'GET') {
      const bytes = Buffer.from(request.body ?? new Uint8Array())
      if (bytes.byteLength !== 0) throw invalidPromotionRequest()
      return { operation: 'availability', headers, value: null }
    }
    if (request.method !== 'POST') throw invalidPromotionRequest(405)
    if (!/^application\/json(?:\s*;|$)/iu.test(headers['content-type'] ?? '')) {
      throw invalidPromotionRequest(415)
    }
    const value = parseJsonBody(request)
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      value.schemaVersion !== 1
    ) {
      throw invalidPromotionRequest()
    }
    return { operation: 'availability', headers, value }
  }

  if (request.method !== 'POST') throw invalidPromotionRequest(405)
  if (!/^application\/json(?:\s*;|$)/iu.test(headers['content-type'] ?? '')) {
    throw invalidPromotionRequest(415)
  }
  const value = parseJsonBody(request)
  if (request.path === MATERIAL_PROMOTION_ROUTE) return { operation: 'promote', headers, value }
  if (request.path === MATERIAL_PROMOTION_QUERY_ROUTE) return { operation: 'query', headers, value }
  if (request.path === MATERIAL_CATALOG_LIST_ROUTE) return { operation: 'listCatalog', headers, value }
  if (request.path === MATERIAL_CATALOG_READ_ROUTE) return { operation: 'readCatalog', headers, value }
  if (request.path === MATERIAL_GC_PLAN_ROUTE) return { operation: 'planGc', headers, value }
  if (request.path === MATERIAL_GC_SWEEP_ROUTE) return { operation: 'sweepGc', headers, value }
  if (request.path === MATERIAL_GC_RELEASE_ROUTE) return { operation: 'releaseGc', headers, value }
  throw invalidPromotionRequest(404)
}

const readyAvailability = Object.freeze({
  schemaVersion: 1,
  available: true,
  reason: 'ready',
  minimumNodeMajor: 20,
})

const unavailableMaterialGc = () =>
  promotionError('material-gc-unavailable', 503, 'Durable material garbage collection is unavailable')

export const createMaterialPromotionHandler = ({ coordinator, checkAvailability } = {}) => {
  if (!coordinator || typeof coordinator.promote !== 'function' || typeof coordinator.query !== 'function') {
    throw new TypeError('coordinator promote/query methods must be functions')
  }
  if (checkAvailability !== undefined && typeof checkAvailability !== 'function') {
    throw new TypeError('checkAvailability must be a function')
  }
  return Object.freeze({
    async handle(request) {
      try {
        const { operation, headers, value } = parseTransportRequest(request)
        if (operation === 'availability') {
          return {
            status: 200,
            body: await runPromotionPhase(
              () => checkAvailability?.({ signal: request.signal }) ?? readyAvailability,
              request.signal,
            ),
          }
        }
        const input = { headers, request: value, signal: request.signal }
        let body
        if (operation === 'promote') body = await coordinator.promote(input)
        else if (operation === 'query') body = await coordinator.query(input)
        else if (operation === 'listCatalog') body = await coordinator.listCatalog?.(input)
        else if (operation === 'readCatalog') body = await coordinator.readCatalog?.(input)
        else if (operation === 'planGc') body = await coordinator.planGc?.(input)
        else if (operation === 'sweepGc') body = await coordinator.sweepGc?.(input)
        else body = await coordinator.releaseGc?.(input)
        if (body === undefined) {
          if (operation.endsWith('Gc')) throw unavailableMaterialGc()
          throw unavailablePromotion()
        }
        return { status: 200, body }
      } catch (error) {
        return createPromotionErrorEnvelope(normalizePromotionError(error))
      }
    },
  })
}

export const createDisabledMaterialPromotionHandler = () =>
  createMaterialPromotionHandler({
    coordinator: Object.freeze({
      async promote() {
        throw unavailablePromotion()
      },
      async query() {
        throw unavailablePromotion()
      },
      async listCatalog() {
        throw unavailablePromotion()
      },
      async readCatalog() {
        throw unavailablePromotion()
      },
      async planGc() {
        throw unavailableMaterialGc()
      },
      async sweepGc() {
        throw unavailableMaterialGc()
      },
      async releaseGc() {
        throw unavailableMaterialGc()
      },
    }),
    checkAvailability: async () => ({
      schemaVersion: 1,
      available: false,
      reason: 'disabled',
      minimumNodeMajor: 20,
    }),
  })
