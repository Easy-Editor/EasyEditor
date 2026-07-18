import {
  createMaterialCatalogItem,
  createMaterialCatalogListResponse,
} from '../../shared/material-catalog-contract.mjs'
import { promotionError, runPromotionPhase, throwIfPromotionAborted } from './promotion-error.mjs'
import {
  createCanonicalDurableMaterialIdentity,
  validateMaterialCatalogList,
  validateMaterialCatalogRead,
  validateMaterialGcPlanRequest,
  validateMaterialGcReleaseRequest,
  validateMaterialGcSweepRequest,
  validateMaterialPromotionCall,
  validateMaterialPromotionQuery,
} from './request-contract.mjs'

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

const invalidDescriptor = Symbol('invalid-promotion-binding-descriptor')

const ownDataValue = (value, key) => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return invalidDescriptor
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : invalidDescriptor
  } catch {
    return invalidDescriptor
  }
}

const materialBindingOf = material => {
  const sourceRevision = ownDataValue(material, 'sourceRevision')
  return Object.freeze({
    schemaVersion: ownDataValue(material, 'schemaVersion'),
    promotionId: ownDataValue(material, 'promotionId'),
    projectId: ownDataValue(material, 'projectId'),
    materialId: ownDataValue(material, 'materialId'),
    materialVersion: ownDataValue(material, 'materialVersion'),
    logicalComponentId: ownDataValue(material, 'logicalComponentId'),
    sourceRevision: Object.freeze({
      artifactId: ownDataValue(sourceRevision, 'artifactId'),
      sourceRevision: ownDataValue(sourceRevision, 'sourceRevision'),
      logicalComponentId: ownDataValue(sourceRevision, 'logicalComponentId'),
      sourceIntegrity: ownDataValue(sourceRevision, 'sourceIntegrity'),
    }),
    dependencyLockDigest: ownDataValue(material, 'dependencyLockDigest'),
    buildIntegrity: ownDataValue(material, 'buildIntegrity'),
  })
}

const buildBindingOf = (material, materialBinding) => {
  const filesValue = ownDataValue(material, 'files')
  const length = ownDataValue(filesValue, 'length')
  const entryFile = ownDataValue(material, 'entryFile')
  const createdAt = ownDataValue(material, 'createdAt')
  let filesAreArray = false
  try {
    filesAreArray = Array.isArray(filesValue)
  } catch {
    return null
  }
  if (
    !filesAreArray ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    typeof entryFile !== 'string' ||
    !Number.isSafeInteger(createdAt)
  ) {
    return null
  }
  const files = []
  for (let index = 0; index < length; index += 1) {
    const file = ownDataValue(filesValue, String(index))
    const path = ownDataValue(file, 'path')
    const byteLength = ownDataValue(file, 'byteLength')
    const integrity = ownDataValue(file, 'integrity')
    if (typeof path !== 'string' || !Number.isSafeInteger(byteLength) || typeof integrity !== 'string') return null
    files.push(Object.freeze({ path, byteLength, integrity }))
  }
  return Object.freeze({
    buildIntegrity: materialBinding.buildIntegrity,
    entryFile,
    files: Object.freeze(files),
    createdAt,
  })
}

const requestBoundMaterialOf = request => {
  const artifact = request.artifact
  const materialIdentity = createCanonicalDurableMaterialIdentity(request)
  return Object.freeze({
    schemaVersion: request.schemaVersion,
    promotionId: request.promotionId,
    projectId: request.projectId,
    materialId: materialIdentity.materialId,
    materialVersion: materialIdentity.materialVersion,
    logicalComponentId: artifact.logicalComponentId,
    sourceRevision: Object.freeze(sourceRevisionOf(artifact)),
    dependencyLockDigest: artifact.dependencyLockDigest,
  })
}

const sameRequestBoundMaterial = (material, expected) =>
  material.schemaVersion === expected.schemaVersion &&
  material.promotionId === expected.promotionId &&
  material.projectId === expected.projectId &&
  material.materialId === expected.materialId &&
  material.materialVersion === expected.materialVersion &&
  material.logicalComponentId === expected.logicalComponentId &&
  material.sourceRevision.artifactId === expected.sourceRevision.artifactId &&
  material.sourceRevision.sourceRevision === expected.sourceRevision.sourceRevision &&
  material.sourceRevision.logicalComponentId === expected.sourceRevision.logicalComponentId &&
  material.sourceRevision.sourceIntegrity === expected.sourceRevision.sourceIntegrity &&
  material.dependencyLockDigest === expected.dependencyLockDigest

const sameFrozenSource = (material, request) =>
  sameRequestBoundMaterial(materialBindingOf(material), requestBoundMaterialOf(request))

const sameBuildBinding = (left, right) =>
  left.buildIntegrity === right.buildIntegrity &&
  left.entryFile === right.entryFile &&
  left.createdAt === right.createdAt &&
  left.files.length === right.files.length &&
  left.files.every(
    (file, index) =>
      file.path === right.files[index].path &&
      file.byteLength === right.files[index].byteLength &&
      file.integrity === right.files[index].integrity,
  )

const validateAuthoredBinding = (binding, buildBinding, request) => {
  return (
    sameRequestBoundMaterial(binding, requestBoundMaterialOf(request)) &&
    typeof binding.buildIntegrity === 'string' &&
    binding.buildIntegrity.length > 0 &&
    buildBinding !== null
  )
}

const validatePublishedBinding = (published, request, authoredBuildBinding) => {
  const binding = materialBindingOf(published)
  const buildBinding = buildBindingOf(published, binding)
  return ownDataValue(published, 'state') === 'active' &&
    sameRequestBoundMaterial(binding, requestBoundMaterialOf(request)) &&
    buildBinding !== null &&
    sameBuildBinding(buildBinding, authoredBuildBinding)
    ? binding
    : null
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

const unavailableCatalog = () => promotionError('promotion-unavailable', 503, 'Local material promotion is unavailable')

const authorizeCatalogRequest = (authorizePrincipal, headers, request, signal) =>
  runPromotionPhase(() => authorizePrincipal({ headers, projectId: request.projectId, signal }), signal)

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
        const authoredBinding = materialBindingOf(authored)
        const authoredBuildBinding = buildBindingOf(authored, authoredBinding)
        if (!validateAuthoredBinding(authoredBinding, authoredBuildBinding, request)) {
          throw promotionError(
            'promotion-build-invalid',
            503,
            'Trusted wrapper author returned mismatched immutable promotion bindings',
          )
        }
        await runPromotionPhase(() => registry.stagePromotion(authored, { signal }), signal)
        throwIfPromotionAborted(signal)
        const published = await runPromotionPhase(
          () => registry.publishPromotion({ promotionId: request.promotionId }, { signal }),
          signal,
        )
        throwIfPromotionAborted(signal)
        const publishedBinding = validatePublishedBinding(published, request, authoredBuildBinding)
        if (!publishedBinding) {
          throw promotionError(
            'promotion-build-invalid',
            503,
            'Material registry published mismatched immutable promotion bindings',
          )
        }
        return activeResponse(publishedBinding, request.promotionId, sourceRevisionOf(request.artifact))
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
    async listCatalog({ headers, request: requestValue, signal } = {}) {
      throwIfPromotionAborted(signal)
      const request = validateMaterialCatalogList(requestValue)
      await authorizeCatalogRequest(authorizePrincipal, headers, request, signal)
      throwIfPromotionAborted(signal)
      if (typeof registry.listMaterials !== 'function') throw unavailableCatalog()
      const records = await runPromotionPhase(
        () => registry.listMaterials({ projectId: request.projectId }, { signal }),
        signal,
      )
      throwIfPromotionAborted(signal)
      if (!Array.isArray(records)) throw new TypeError('registry.listMaterials must return an array')
      return createMaterialCatalogListResponse(records.filter(record => record?.projectId === request.projectId))
    },
    async readCatalog({ headers, request: requestValue, signal } = {}) {
      throwIfPromotionAborted(signal)
      const request = validateMaterialCatalogRead(requestValue)
      await authorizeCatalogRequest(authorizePrincipal, headers, request, signal)
      throwIfPromotionAborted(signal)
      if (typeof registry.readMaterial !== 'function') throw unavailableCatalog()
      const record = await runPromotionPhase(
        () =>
          registry.readMaterial(
            {
              materialId: request.materialId,
              materialVersion: request.materialVersion,
              buildIntegrity: request.buildIntegrity,
            },
            { signal },
          ),
        signal,
      )
      throwIfPromotionAborted(signal)
      if (!record || record.projectId !== request.projectId) {
        throw promotionError('material-not-found', 404, 'Material was not found')
      }
      return createMaterialCatalogItem(record)
    },
  })
}

export const createMaterialGcCoordinator = ({ authorizePrincipal, registry } = {}) => {
  if (typeof authorizePrincipal !== 'function') throw new TypeError('authorizePrincipal must be a function')
  requireMethod(registry, 'planGarbageCollection', 'registry')
  requireMethod(registry, 'sweepGarbageCollection', 'registry')
  requireMethod(registry, 'releaseGarbageCollectionRoot', 'registry')

  const authorize = async (headers, projectId, signal) => {
    const principal = await runPromotionPhase(() => authorizePrincipal({ headers, projectId, signal }), signal)
    if (!principal || typeof principal.tenantId !== 'string' || typeof principal.userId !== 'string') {
      throw new TypeError('authorizePrincipal must return tenantId and userId')
    }
    return Object.freeze({ tenantId: principal.tenantId, userId: principal.userId })
  }

  return Object.freeze({
    async planGc({ headers, request: requestValue, signal } = {}) {
      throwIfPromotionAborted(signal)
      const request = validateMaterialGcPlanRequest(requestValue)
      const principal = await authorize(headers, request.projectId, signal)
      throwIfPromotionAborted(signal)
      return registry.planGarbageCollection({ principal, request }, { signal })
    },
    async sweepGc({ headers, request: requestValue, signal } = {}) {
      throwIfPromotionAborted(signal)
      const request = validateMaterialGcSweepRequest(requestValue)
      const principal = await authorize(headers, request.plan.projectId, signal)
      throwIfPromotionAborted(signal)
      return registry.sweepGarbageCollection({ principal, request }, { signal })
    },
    async releaseGc({ headers, request: requestValue, signal } = {}) {
      throwIfPromotionAborted(signal)
      const request = validateMaterialGcReleaseRequest(requestValue)
      const principal = await authorize(headers, request.projectId, signal)
      throwIfPromotionAborted(signal)
      return registry.releaseGarbageCollectionRoot({ principal, request }, { signal })
    },
  })
}
