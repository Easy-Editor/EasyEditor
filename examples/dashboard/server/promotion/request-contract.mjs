import { createHash } from 'node:crypto'

import { validateArtifactRecord } from '../../src/lib/storage/artifact-contracts.mjs'
import { canonicalJsonStringify } from '../../src/lib/storage/canonical-json.mjs'
import { invalidPromotionRequest, promotionError } from './promotion-error.mjs'

const requestFields = Object.freeze([
  'artifact',
  'branchId',
  'callDigest',
  'callId',
  'projectId',
  'promotionId',
  'schemaVersion',
  'sessionId',
  'stepId',
  'taskId',
])
const queryFields = Object.freeze(['projectId', 'promotionId', 'schemaVersion'])
const catalogListFields = Object.freeze(['projectId', 'schemaVersion'])
const catalogReadFields = Object.freeze([
  'buildIntegrity',
  'materialId',
  'materialVersion',
  'projectId',
  'schemaVersion',
])
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u
const digestPattern = /^sha256:[\da-f]{64}$/u

const isPlainObject = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertExactFields = (value, fields) => {
  if (!isPlainObject(value)) throw invalidPromotionRequest()
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw invalidPromotionRequest()
  }
}

const requireIdentifier = value => {
  if (typeof value !== 'string' || !identifierPattern.test(value)) throw invalidPromotionRequest()
  return value
}

const requireDigest = value => {
  if (typeof value !== 'string' || !digestPattern.test(value)) throw invalidPromotionRequest()
  return value
}

const promotionIdentity = request => ({
  schemaVersion: 1,
  kind: 'local-material-promotion-identity',
  authority: {
    projectId: request.projectId,
    branchId: request.branchId,
    sessionId: request.sessionId,
    taskId: request.taskId,
  },
  callId: request.callId,
  callDigest: request.callDigest,
  artifact: {
    artifactId: request.artifact.artifactId,
    sourceRevision: request.artifact.sourceRevision,
    logicalComponentId: request.artifact.logicalComponentId,
    sourceIntegrity: request.artifact.sourceIntegrity,
    dependencyLockDigest: request.artifact.dependencyLockDigest,
  },
})

export const createCanonicalPromotionId = request =>
  `sha256:${createHash('sha256')
    .update(canonicalJsonStringify(promotionIdentity(request)))
    .digest('hex')}`

export const normalizePromotionHeaders = headers => {
  const result = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') result[name.toLowerCase()] = value
    else if (Array.isArray(value)) result[name.toLowerCase()] = value.join(', ')
  }
  return result
}

export const validateMaterialPromotionCall = value => {
  assertExactFields(value, requestFields)
  if (value.schemaVersion !== 1) throw invalidPromotionRequest()

  let artifact
  try {
    artifact = validateArtifactRecord(value.artifact)
  } catch {
    throw invalidPromotionRequest()
  }

  const projectId = requireIdentifier(value.projectId)
  if (artifact.projectId !== projectId) throw invalidPromotionRequest()
  requireIdentifier(artifact.artifactId)
  requireIdentifier(artifact.sourceRevision)
  requireIdentifier(artifact.logicalComponentId)

  const normalized = Object.freeze({
    schemaVersion: 1,
    projectId,
    branchId: requireIdentifier(value.branchId),
    sessionId: requireIdentifier(value.sessionId),
    taskId: requireIdentifier(value.taskId),
    stepId: requireIdentifier(value.stepId),
    callId: requireIdentifier(value.callId),
    callDigest: requireDigest(value.callDigest),
    promotionId: requireDigest(value.promotionId),
    artifact,
  })
  if (createCanonicalPromotionId(normalized) !== normalized.promotionId) {
    throw promotionError(
      'promotion-conflict',
      409,
      'promotionId does not match the canonical call and artifact identity',
    )
  }
  return normalized
}

export const validateMaterialPromotionQuery = value => {
  assertExactFields(value, queryFields)
  if (value.schemaVersion !== 1) throw invalidPromotionRequest()
  return Object.freeze({
    schemaVersion: 1,
    projectId: requireIdentifier(value.projectId),
    promotionId: requireDigest(value.promotionId),
  })
}

export const validateMaterialCatalogList = value => {
  assertExactFields(value, catalogListFields)
  if (value.schemaVersion !== 1) throw invalidPromotionRequest()
  return Object.freeze({
    schemaVersion: 1,
    projectId: requireIdentifier(value.projectId),
  })
}

export const validateMaterialCatalogRead = value => {
  assertExactFields(value, catalogReadFields)
  if (value.schemaVersion !== 1) throw invalidPromotionRequest()
  return Object.freeze({
    schemaVersion: 1,
    projectId: requireIdentifier(value.projectId),
    materialId: requireIdentifier(value.materialId),
    materialVersion: requireIdentifier(value.materialVersion),
    buildIntegrity: requireDigest(value.buildIntegrity),
  })
}
