import { createDashboardLocalMaterialPromotionCapabilityService } from './service.mjs'

export const LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON = Object.freeze({
  runtimeDisabled: 'agent-runtime-disabled',
  onlineDisabled: 'online-component-feature-disabled',
  featureDisabled: 'promotion-feature-disabled',
  nodeVersionUnsupported: 'promotion-requires-node-20',
  serverUnavailable: 'promotion-server-unavailable',
  localGrantRequired: 'promotion-local-grant-required',
})

export const LOCAL_MATERIAL_PROMOTION_POLICY = Object.freeze({
  scope: 'material.promote.local',
  policyVersion: 'dashboard-local-material-promotion/1',
  providerId: 'dashboard-same-origin-promotion',
  providerFingerprint: 'same-origin:/api/materials/promote',
})

const unavailable = reason => Object.freeze({ available: false, reason })
const AVAILABLE = Object.freeze({ available: true, reason: null })

const requireMethod = (value, method, label) => {
  if (!value || typeof value[method] !== 'function') throw new TypeError(`${label}.${method} must be a function`)
  return value[method].bind(value)
}

const requireString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return value
}

const optionalOwnDataValue = (value, key, label) => {
  let descriptor
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  } catch {
    throw new TypeError(`${label}.${String(key)} could not be inspected`)
  }
  if (!descriptor) return undefined
  if (!('value' in descriptor)) throw new TypeError(`${label}.${String(key)} must be a data property`)
  return descriptor.value
}

const requirePolicyVersion = value => {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (Number.isSafeInteger(value) && value >= 0) return value
  throw new TypeError('grantIdentity.policyVersion must be a non-empty string or non-negative safe integer')
}

const decoratePromotionService = (service, onPromotionApplied) => {
  if (onPromotionApplied === undefined) return service
  if (typeof onPromotionApplied !== 'function') throw new TypeError('onPromotionApplied must be a function')
  const notifyAfterApplied = result => {
    const applied = result?.status === 'applied' || result?.results?.some(candidate => candidate?.status === 'applied')
    if (!applied) return
    queueMicrotask(() => {
      try {
        Promise.resolve(onPromotionApplied()).catch(() => undefined)
      } catch {
        // Catalog refresh is a projection side effect and cannot reverse a durable promotion.
      }
    })
  }
  return Object.freeze({
    async promoteLocal(call) {
      const result = await service.promoteLocal(call)
      notifyAfterApplied(result)
      return result
    },
    queryReceipt: service.queryReceipt.bind(service),
    async resumePending() {
      const result = await service.resumePending()
      notifyAfterApplied(result)
      return result
    },
  })
}

const disabledRuntime = reason =>
  Object.freeze({
    promotionService: null,
    promotionAvailability: async () => unavailable(reason),
  })

export const createDashboardLocalMaterialPromotionRuntime = options => {
  if (!options || typeof options !== 'object')
    throw new TypeError('local material promotion runtime options are required')
  const flags = options.featureFlags ?? {}
  if (flags.runtime !== true) {
    return disabledRuntime(LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.runtimeDisabled)
  }
  if (flags.online !== true) {
    return disabledRuntime(LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.onlineDisabled)
  }
  if (flags.promotion !== true) {
    return disabledRuntime(LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.featureDisabled)
  }

  const authority = options.authority
  const client = options.client
  const persistence = options.persistence
  const grantIdentity = options.grantIdentity
  const admitMaterialRefsUnderSharedMutation = optionalOwnDataValue(
    options,
    'admitMaterialRefsUnderSharedMutation',
    'options',
  )
  const checkAvailability = requireMethod(client, 'checkAvailability', 'client')
  const checkLocalGrant = requireMethod(persistence, 'checkLocalGrant', 'persistence')
  const rawPromotionService = createDashboardLocalMaterialPromotionCapabilityService({
    authority,
    client,
    core: options.core,
    persistence,
    crypto: options.crypto,
    ...(admitMaterialRefsUnderSharedMutation === undefined ? {} : { admitMaterialRefsUnderSharedMutation }),
    ...(typeof options.now === 'function' ? { now: options.now } : {}),
    ...(typeof options.isTransactionCommittedError === 'function'
      ? { isTransactionCommittedError: options.isTransactionCommittedError }
      : {}),
    ...(typeof options.isTransactionRollbackIncompleteError === 'function'
      ? { isTransactionRollbackIncompleteError: options.isTransactionRollbackIncompleteError }
      : {}),
  })
  const promotionService = decoratePromotionService(rawPromotionService, options.onPromotionApplied)
  const projectId = requireString(authority?.projectId, 'authority.projectId')
  const grantRequest = grantIdentity
    ? Object.freeze({
        schemaVersion: 1,
        userId: requireString(grantIdentity.userId, 'grantIdentity.userId'),
        projectId,
        scope: requireString(grantIdentity.scope ?? LOCAL_MATERIAL_PROMOTION_POLICY.scope, 'grantIdentity.scope'),
        policyVersion: requirePolicyVersion(grantIdentity.policyVersion),
        providerId: requireString(grantIdentity.providerId, 'grantIdentity.providerId'),
        providerFingerprint: requireString(grantIdentity.providerFingerprint, 'grantIdentity.providerFingerprint'),
      })
    : null

  const promotionAvailability = async () => {
    let server
    try {
      server = await checkAvailability()
    } catch {
      return unavailable(LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.serverUnavailable)
    }
    if (server?.available !== true) {
      const reason = server?.reason
      return unavailable(
        reason === LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.nodeVersionUnsupported
          ? LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.nodeVersionUnsupported
          : LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.serverUnavailable,
      )
    }
    if (!grantRequest) return unavailable(LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.localGrantRequired)
    let decision
    try {
      decision = await checkLocalGrant(grantRequest)
    } catch {
      return unavailable(LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.localGrantRequired)
    }
    return decision?.granted === true
      ? AVAILABLE
      : unavailable(LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON.localGrantRequired)
  }

  return Object.freeze({ promotionService, promotionAvailability })
}
