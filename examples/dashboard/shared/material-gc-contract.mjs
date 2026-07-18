import { validateMaterialIdentity } from './material-promotion-contract.mjs'

export const MATERIAL_GC_SCHEMA_VERSION = 1

const digestPattern = /^sha256:[\da-f]{64}$/u
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u

export class MaterialGcContractError extends TypeError {
  constructor(reason) {
    super(reason)
    this.name = 'MaterialGcContractError'
    this.code = 'invalid-request'
    this.status = 400
    this.retryable = false
  }
}

const fail = reason => {
  throw new MaterialGcContractError(reason)
}

const isPlainObject = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertExactFields = (value, fields, label) => {
  if (!isPlainObject(value)) fail(`${label}-must-be-a-json-object`)
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail(`${label}-fields-must-match-contract`)
  }
}

const requireIdentifier = (value, label) => {
  if (typeof value !== 'string' || !identifierPattern.test(value)) fail(`${label}-is-invalid`)
  return value
}

const requireDigest = (value, label) => {
  if (typeof value !== 'string' || !digestPattern.test(value)) fail(`${label}-must-be-a-sha256-digest`)
  return value
}

const requireGeneration = (value, label, { positive = false } = {}) => {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    fail(`${label}-must-be-a-${positive ? 'positive' : 'non-negative'}-safe-integer`)
  }
  return value
}

const identityKey = identity => `${identity.materialId}\0${identity.materialVersion}\0${identity.buildIntegrity}`
const compareIdentity = (left, right) => identityKey(left).localeCompare(identityKey(right))

const normalizeMaterialRefs = (value, label) => {
  if (!Array.isArray(value) || value.length > 4096) fail(`${label}-must-be-a-bounded-array`)
  let refs
  try {
    refs = value.map(validateMaterialIdentity).sort(compareIdentity)
  } catch {
    fail(`${label}-contains-an-invalid-material-identity`)
  }
  const seen = new Set()
  for (const ref of refs) {
    const key = identityKey(ref)
    if (seen.has(key)) fail(`${label}-must-not-contain-duplicates`)
    seen.add(key)
  }
  return Object.freeze(refs)
}

const normalizePromotionIds = (value, label) => {
  if (!Array.isArray(value) || value.length > 4096) fail(`${label}-must-be-a-bounded-array`)
  const ids = value.map((entry, index) => requireDigest(entry, `${label}.${index}`)).sort()
  if (ids.some((entry, index) => index > 0 && entry === ids[index - 1])) {
    fail(`${label}-must-not-contain-duplicates`)
  }
  return Object.freeze(ids)
}

const deepFreeze = value => {
  if (!value || typeof value !== 'object') return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.isFrozen(value) ? value : Object.freeze(value)
}

const cloneFrozen = value => deepFreeze(structuredClone(value))

export const validateMaterialGcPlanRequest = value => {
  assertExactFields(
    value,
    [
      'expectedReplicaGeneration',
      'materialRefs',
      'projectId',
      'replicaId',
      'schemaVersion',
      'snapshotDigest',
      'unresolvedPromotionIds',
    ],
    'material-gc-plan-request',
  )
  if (value.schemaVersion !== MATERIAL_GC_SCHEMA_VERSION) fail('material-gc-plan-request-schema-is-unsupported')
  return cloneFrozen({
    schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
    projectId: requireIdentifier(value.projectId, 'material-gc-plan-request.projectId'),
    replicaId: requireIdentifier(value.replicaId, 'material-gc-plan-request.replicaId'),
    expectedReplicaGeneration: requireGeneration(
      value.expectedReplicaGeneration,
      'material-gc-plan-request.expectedReplicaGeneration',
    ),
    snapshotDigest: requireDigest(value.snapshotDigest, 'material-gc-plan-request.snapshotDigest'),
    materialRefs: normalizeMaterialRefs(value.materialRefs, 'material-gc-plan-request.materialRefs'),
    unresolvedPromotionIds: normalizePromotionIds(
      value.unresolvedPromotionIds,
      'material-gc-plan-request.unresolvedPromotionIds',
    ),
  })
}

export const createMaterialGcPlanRequestDigestInput = requestValue => {
  const request = validateMaterialGcPlanRequest(requestValue)
  return cloneFrozen({ kind: 'material-gc-root-update', ...request })
}

export const validateMaterialGcPlan = value => {
  assertExactFields(
    value,
    [
      'deletionCandidates',
      'globalRetainedMaterialRefs',
      'kind',
      'planHash',
      'projectId',
      'registryGeneration',
      'registryId',
      'replicaGeneration',
      'replicaId',
      'requestDigest',
      'rootKeyDigest',
      'schemaVersion',
      'snapshotDigest',
    ],
    'material-gc-plan',
  )
  if (value.schemaVersion !== MATERIAL_GC_SCHEMA_VERSION || value.kind !== 'material-gc-plan') {
    fail('material-gc-plan-schema-is-unsupported')
  }
  return cloneFrozen({
    schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
    kind: 'material-gc-plan',
    registryId: requireDigest(value.registryId, 'material-gc-plan.registryId'),
    registryGeneration: requireGeneration(value.registryGeneration, 'material-gc-plan.registryGeneration', {
      positive: true,
    }),
    rootKeyDigest: requireDigest(value.rootKeyDigest, 'material-gc-plan.rootKeyDigest'),
    projectId: requireIdentifier(value.projectId, 'material-gc-plan.projectId'),
    replicaId: requireIdentifier(value.replicaId, 'material-gc-plan.replicaId'),
    replicaGeneration: requireGeneration(value.replicaGeneration, 'material-gc-plan.replicaGeneration', {
      positive: true,
    }),
    requestDigest: requireDigest(value.requestDigest, 'material-gc-plan.requestDigest'),
    snapshotDigest: requireDigest(value.snapshotDigest, 'material-gc-plan.snapshotDigest'),
    globalRetainedMaterialRefs: normalizeMaterialRefs(
      value.globalRetainedMaterialRefs,
      'material-gc-plan.globalRetainedMaterialRefs',
    ),
    deletionCandidates: normalizeMaterialRefs(value.deletionCandidates, 'material-gc-plan.deletionCandidates'),
    planHash: requireDigest(value.planHash, 'material-gc-plan.planHash'),
  })
}

export const createMaterialGcPlanHashInput = planValue => {
  const plan = validateMaterialGcPlan(planValue)
  const { planHash: _planHash, ...input } = plan
  return cloneFrozen(input)
}

export const validateMaterialGcSweepRequest = value => {
  assertExactFields(value, ['plan', 'schemaVersion'], 'material-gc-sweep-request')
  if (value.schemaVersion !== MATERIAL_GC_SCHEMA_VERSION) fail('material-gc-sweep-request-schema-is-unsupported')
  return cloneFrozen({ schemaVersion: MATERIAL_GC_SCHEMA_VERSION, plan: validateMaterialGcPlan(value.plan) })
}

export const validateMaterialGcReleaseRequest = value => {
  assertExactFields(
    value,
    ['expectedReplicaGeneration', 'projectId', 'replicaId', 'schemaVersion', 'snapshotDigest'],
    'material-gc-release-request',
  )
  if (value.schemaVersion !== MATERIAL_GC_SCHEMA_VERSION) fail('material-gc-release-request-schema-is-unsupported')
  return cloneFrozen({
    schemaVersion: MATERIAL_GC_SCHEMA_VERSION,
    projectId: requireIdentifier(value.projectId, 'material-gc-release-request.projectId'),
    replicaId: requireIdentifier(value.replicaId, 'material-gc-release-request.replicaId'),
    expectedReplicaGeneration: requireGeneration(
      value.expectedReplicaGeneration,
      'material-gc-release-request.expectedReplicaGeneration',
      { positive: true },
    ),
    snapshotDigest: requireDigest(value.snapshotDigest, 'material-gc-release-request.snapshotDigest'),
  })
}

export const createMaterialGcReleaseRequestDigestInput = requestValue => {
  const request = validateMaterialGcReleaseRequest(requestValue)
  return cloneFrozen({ kind: 'material-gc-root-release', ...request })
}
