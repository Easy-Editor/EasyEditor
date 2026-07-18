import { promotionError, runPromotionPhase, throwIfPromotionAborted } from './promotion-error.mjs'
import { validateMaterialPromotionCall, validateMaterialPromotionQuery } from './request-contract.mjs'

const requireMethod = (value, method, label) => {
  if (!value || typeof value[method] !== 'function') {
    throw new TypeError(`${label}.${method} must be a function`)
  }
}

const sourceRevisionOf = artifact => ({
  artifactId: artifact.artifactId,
  sourceRevision: artifact.sourceRevision,
  logicalComponentId: artifact.logicalComponentId,
  sourceIntegrity: artifact.sourceIntegrity,
})

const sameFrozenSource = (material, request) => {
  const artifact = request.artifact
  return (
    material.projectId === request.projectId &&
    material.promotionId === request.promotionId &&
    material.materialId === artifact.logicalComponentId &&
    material.materialVersion === artifact.sourceRevision &&
    material.logicalComponentId === artifact.logicalComponentId &&
    material.dependencyLockDigest === artifact.dependencyLockDigest &&
    material.sourceRevision?.artifactId === artifact.artifactId &&
    material.sourceRevision?.sourceRevision === artifact.sourceRevision &&
    material.sourceRevision?.logicalComponentId === artifact.logicalComponentId &&
    material.sourceRevision?.sourceIntegrity === artifact.sourceIntegrity
  )
}

const activeResponse = (material, promotionId, rollbackTo) =>
  Object.freeze({
    schemaVersion: 1,
    status: 'active',
    promotionId,
    materialId: material.materialId,
    materialVersion: material.materialVersion,
    buildIntegrity: material.buildIntegrity,
    rollbackTo: Object.freeze(rollbackTo),
  })

export const createMaterialPromotionCoordinator = ({ authorizePrincipal, author, registry } = {}) => {
  if (typeof authorizePrincipal !== 'function') throw new TypeError('authorizePrincipal must be a function')
  requireMethod(author, 'authorPromotion', 'author')
  requireMethod(registry, 'stagePromotion', 'registry')
  requireMethod(registry, 'publishPromotion', 'registry')

  return Object.freeze({
    async promote({ headers, request: requestValue, signal } = {}) {
      throwIfPromotionAborted(signal)
      const request = validateMaterialPromotionCall(requestValue)
      const principal = await runPromotionPhase(
        () => authorizePrincipal({ headers, projectId: request.projectId, signal }),
        signal,
      )
      throwIfPromotionAborted(signal)
      if (typeof registry.listMaterials === 'function') {
        const materials = await runPromotionPhase(
          () => registry.listMaterials({ projectId: request.projectId }, { signal }),
          signal,
        )
        throwIfPromotionAborted(signal)
        const existing = materials.find(material => material.promotionId === request.promotionId)
        if (existing) {
          if (!sameFrozenSource(existing, request)) {
            throw promotionError('promotion-conflict', 409, 'promotionId is already bound to different frozen inputs')
          }
          return activeResponse(existing, request.promotionId, sourceRevisionOf(request.artifact))
        }
      }
      const authored = await runPromotionPhase(() => author.authorPromotion({ principal, request, signal }), signal)
      try {
        throwIfPromotionAborted(signal)
        await runPromotionPhase(() => registry.stagePromotion(authored, { signal }), signal)
        throwIfPromotionAborted(signal)
        const published = await runPromotionPhase(
          () => registry.publishPromotion({ promotionId: request.promotionId }, { signal }),
          signal,
        )
        throwIfPromotionAborted(signal)
        return activeResponse(published, request.promotionId, sourceRevisionOf(request.artifact))
      } finally {
        if (typeof author.releasePromotion === 'function') {
          await author.releasePromotion(authored).catch(() => undefined)
        }
      }
    },
    async query({ headers, request: requestValue, signal } = {}) {
      throwIfPromotionAborted(signal)
      const request = validateMaterialPromotionQuery(requestValue)
      await runPromotionPhase(() => authorizePrincipal({ headers, projectId: request.projectId, signal }), signal)
      if (typeof registry.queryPromotion !== 'function') {
        throw promotionError('promotion-state-unknown', 409, 'Promotion state is unavailable', true)
      }
      const record = await runPromotionPhase(() => registry.queryPromotion(request, { signal }), signal)
      throwIfPromotionAborted(signal)
      if (!record) throw promotionError('promotion-not-found', 404, 'Promotion was not found')
      if (record.state !== 'active') {
        throw promotionError('promotion-state-unknown', 409, 'Promotion state is not active', true)
      }
      return activeResponse(record, request.promotionId, record.sourceRevision)
    },
  })
}
