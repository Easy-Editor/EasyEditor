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

const requirePolicyVersion = value => {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (Number.isSafeInteger(value) && value >= 0) return value
  throw new TypeError('grantIdentity.policyVersion must be a non-empty string or non-negative safe integer')
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
  const checkAvailability = requireMethod(client, 'checkAvailability', 'client')
  const checkLocalGrant = requireMethod(persistence, 'checkLocalGrant', 'persistence')
  const promotionService = createDashboardLocalMaterialPromotionCapabilityService({
    authority,
    client,
    core: options.core,
    persistence,
    crypto: options.crypto,
    ...(typeof options.now === 'function' ? { now: options.now } : {}),
    ...(typeof options.isTransactionCommittedError === 'function'
      ? { isTransactionCommittedError: options.isTransactionCommittedError }
      : {}),
    ...(typeof options.isTransactionRollbackIncompleteError === 'function'
      ? { isTransactionRollbackIncompleteError: options.isTransactionRollbackIncompleteError }
      : {}),
  })
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
