const digestPattern = /^sha256:[\da-f]{64}$/u
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u

export const MATERIAL_PROMOTION_SCHEMA_VERSION = 1
export const MATERIAL_PROMOTION_STATES = Object.freeze([
  'allocated',
  'workspace-ready',
  'built',
  'validated',
  'manifest-staged',
  'manifest-published',
  'active',
])

export class MaterialPromotionContractError extends TypeError {
  constructor(reason) {
    super(reason)
    this.name = 'MaterialPromotionContractError'
    this.code = 'invalid-request'
    this.status = 400
    this.retryable = false
  }
}

const fail = reason => {
  throw new MaterialPromotionContractError(reason)
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

const requireString = (value, label, { identifier = false } = {}) => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    fail(`${label}-must-be-a-bounded-non-empty-string`)
  }
  if (identifier && !identifierPattern.test(value)) fail(`${label}-is-invalid`)
  return value
}

const requireDigest = (value, label) => {
  if (typeof value !== 'string' || !digestPattern.test(value)) fail(`${label}-must-be-a-sha256-digest`)
  return value
}

const requireTimestamp = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label}-must-be-a-non-negative-safe-integer`)
  return value
}

const requireByteLength = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label}-must-be-a-non-negative-safe-integer`)
  return value
}

const requireRelativeFilePath = (value, label) => {
  const path = requireString(value, label)
  if (
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/u.test(path) ||
    path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    const error = new MaterialPromotionContractError(`${label}-must-be-a-confined-relative-path`)
    error.code = 'path-escape'
    throw error
  }
  return path
}

const cloneJson = value => JSON.parse(JSON.stringify(value))

export const validateMaterialIdentity = value => {
  assertExactFields(value, ['buildIntegrity', 'materialId', 'materialVersion'], 'material-identity')
  return Object.freeze({
    materialId: requireString(value.materialId, 'material-identity.materialId', { identifier: true }),
    materialVersion: requireString(value.materialVersion, 'material-identity.materialVersion', { identifier: true }),
    buildIntegrity: requireDigest(value.buildIntegrity, 'material-identity.buildIntegrity'),
  })
}

export const validateMaterialPromotionFile = value => {
  assertExactFields(value, ['byteLength', 'integrity', 'path'], 'material-promotion-file')
  return Object.freeze({
    path: requireRelativeFilePath(value.path, 'material-promotion-file.path'),
    byteLength: requireByteLength(value.byteLength, 'material-promotion-file.byteLength'),
    integrity: requireDigest(value.integrity, 'material-promotion-file.integrity'),
  })
}

export const validateMaterialPromotionRequest = value => {
  assertExactFields(
    value,
    [
      'buildDirectory',
      'buildIntegrity',
      'createdAt',
      'dependencyLockDigest',
      'entryFile',
      'files',
      'logicalComponentId',
      'materialId',
      'materialVersion',
      'projectId',
      'promotionId',
      'schemaVersion',
      'sourceRevision',
    ],
    'material-promotion-request',
  )
  if (value.schemaVersion !== MATERIAL_PROMOTION_SCHEMA_VERSION) {
    fail('material-promotion-request-schema-version-is-unsupported')
  }
  assertExactFields(
    value.sourceRevision,
    ['artifactId', 'logicalComponentId', 'sourceIntegrity', 'sourceRevision'],
    'material-promotion-request.sourceRevision',
  )
  if (!Array.isArray(value.files) || value.files.length === 0 || value.files.length > 512) {
    fail('material-promotion-request.files-must-be-a-bounded-non-empty-array')
  }
  const files = value.files.map(validateMaterialPromotionFile)
  const paths = new Set()
  for (const file of files) {
    if (paths.has(file.path)) fail('material-promotion-request.files-must-not-contain-duplicate-paths')
    paths.add(file.path)
  }
  const entryFile = requireRelativeFilePath(value.entryFile, 'material-promotion-request.entryFile')
  if (!paths.has(entryFile)) fail('material-promotion-request.entryFile-must-be-declared')
  const logicalComponentId = requireString(value.logicalComponentId, 'material-promotion-request.logicalComponentId', {
    identifier: true,
  })
  const sourceLogicalComponentId = requireString(
    value.sourceRevision.logicalComponentId,
    'material-promotion-request.sourceRevision.logicalComponentId',
    { identifier: true },
  )
  if (logicalComponentId !== sourceLogicalComponentId) {
    fail('material-promotion-request.logicalComponentId-must-match-sourceRevision')
  }
  return Object.freeze({
    schemaVersion: MATERIAL_PROMOTION_SCHEMA_VERSION,
    promotionId: requireString(value.promotionId, 'material-promotion-request.promotionId', { identifier: true }),
    projectId: requireString(value.projectId, 'material-promotion-request.projectId', { identifier: true }),
    materialId: requireString(value.materialId, 'material-promotion-request.materialId', { identifier: true }),
    materialVersion: requireString(value.materialVersion, 'material-promotion-request.materialVersion', {
      identifier: true,
    }),
    logicalComponentId,
    buildIntegrity: requireDigest(value.buildIntegrity, 'material-promotion-request.buildIntegrity'),
    sourceRevision: Object.freeze({
      artifactId: requireString(
        value.sourceRevision.artifactId,
        'material-promotion-request.sourceRevision.artifactId',
        {
          identifier: true,
        },
      ),
      sourceRevision: requireString(
        value.sourceRevision.sourceRevision,
        'material-promotion-request.sourceRevision.sourceRevision',
        { identifier: true },
      ),
      logicalComponentId: sourceLogicalComponentId,
      sourceIntegrity: requireDigest(
        value.sourceRevision.sourceIntegrity,
        'material-promotion-request.sourceRevision.sourceIntegrity',
      ),
    }),
    dependencyLockDigest: requireDigest(value.dependencyLockDigest, 'material-promotion-request.dependencyLockDigest'),
    entryFile,
    buildDirectory: requireString(value.buildDirectory, 'material-promotion-request.buildDirectory'),
    files: Object.freeze(files),
    createdAt: requireTimestamp(value.createdAt, 'material-promotion-request.createdAt'),
  })
}

export const createMaterialIdentity = request =>
  validateMaterialIdentity({
    materialId: request.materialId,
    materialVersion: request.materialVersion,
    buildIntegrity: request.buildIntegrity,
  })

export const createMaterialPromotionBinding = request => {
  const normalized = validateMaterialPromotionRequest(request)
  const { buildDirectory: _buildDirectory, ...frozen } = cloneJson(normalized)
  return Object.freeze(frozen)
}
