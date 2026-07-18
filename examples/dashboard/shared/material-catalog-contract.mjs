const catalogItemFields = Object.freeze([
  'artifactRef',
  'componentName',
  'createdAt',
  'promotionId',
  'schemaVersion',
  'title',
])
const catalogListFields = Object.freeze(['materials', 'schemaVersion'])
const sourceRevisionFields = Object.freeze(['artifactId', 'logicalComponentId', 'sourceIntegrity', 'sourceRevision'])
const localArtifactRefFields = Object.freeze([...sourceRevisionFields, 'rollbackTo', 'target'])
const localTargetFields = Object.freeze(['buildIntegrity', 'kind', 'materialId', 'materialVersion'])
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u
const digestPattern = /^sha256:[\da-f]{64}$/u

export const MATERIAL_CATALOG_SCHEMA_VERSION = 1
export const MATERIAL_CATALOG_COMPONENT_NAME = 'GeneratedMaterialHost'

const isPlainObject = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertExactFields = (value, fields, label) => {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a JSON object`)
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new TypeError(`${label} fields must match the catalog contract`)
  }
}

const requireIdentifier = (value, label) => {
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new TypeError(`${label} must be a bounded identifier`)
  }
  return value
}

const requireDigest = (value, label) => {
  if (typeof value !== 'string' || !digestPattern.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`)
  }
  return value
}

const requireCreatedAt = value => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('catalog item createdAt must be a non-negative safe integer')
  }
  return value
}

const deepFreeze = value => {
  if (!value || typeof value !== 'object') return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.isFrozen(value) ? value : Object.freeze(value)
}

const cloneFrozenJson = value => deepFreeze(JSON.parse(JSON.stringify(value)))

const normalizeSourceRevision = (value, label) => {
  assertExactFields(value, sourceRevisionFields, label)
  return {
    artifactId: requireIdentifier(value.artifactId, `${label}.artifactId`),
    sourceRevision: requireIdentifier(value.sourceRevision, `${label}.sourceRevision`),
    logicalComponentId: requireIdentifier(value.logicalComponentId, `${label}.logicalComponentId`),
    sourceIntegrity: requireDigest(value.sourceIntegrity, `${label}.sourceIntegrity`),
  }
}

const titleFor = (materialId, materialVersion) => `${materialId} · ${materialVersion}`

const normalizeArtifactRef = value => {
  assertExactFields(value, localArtifactRefFields, 'catalog item artifactRef')
  assertExactFields(value.target, localTargetFields, 'catalog item artifactRef.target')
  if (value.target.kind !== 'local-material') {
    throw new TypeError('catalog item artifactRef target must be local-material')
  }
  const sourceRevision = normalizeSourceRevision(
    Object.fromEntries(sourceRevisionFields.map(field => [field, value[field]])),
    'catalog item artifactRef source revision',
  )
  const rollbackTo = normalizeSourceRevision(value.rollbackTo, 'catalog item artifactRef.rollbackTo')
  if (sourceRevisionFields.some(field => sourceRevision[field] !== rollbackTo[field])) {
    throw new TypeError('catalog item artifactRef rollbackTo must equal its source revision')
  }
  return {
    ...sourceRevision,
    target: {
      kind: 'local-material',
      materialId: requireIdentifier(value.target.materialId, 'catalog item artifactRef.target.materialId'),
      materialVersion: requireIdentifier(
        value.target.materialVersion,
        'catalog item artifactRef.target.materialVersion',
      ),
      buildIntegrity: requireDigest(value.target.buildIntegrity, 'catalog item artifactRef.target.buildIntegrity'),
    },
    rollbackTo,
  }
}

export const validateMaterialCatalogItem = value => {
  assertExactFields(value, catalogItemFields, 'catalog item')
  if (value.schemaVersion !== MATERIAL_CATALOG_SCHEMA_VERSION) {
    throw new TypeError('catalog item schemaVersion is unsupported')
  }
  if (value.componentName !== MATERIAL_CATALOG_COMPONENT_NAME) {
    throw new TypeError('catalog item componentName must be GeneratedMaterialHost')
  }
  const artifactRef = normalizeArtifactRef(value.artifactRef)
  const title = titleFor(artifactRef.target.materialId, artifactRef.target.materialVersion)
  if (value.title !== title) throw new TypeError('catalog item title does not match its stable material identity')
  return cloneFrozenJson({
    schemaVersion: MATERIAL_CATALOG_SCHEMA_VERSION,
    componentName: MATERIAL_CATALOG_COMPONENT_NAME,
    title,
    createdAt: requireCreatedAt(value.createdAt),
    promotionId: requireDigest(value.promotionId, 'catalog item promotionId'),
    artifactRef,
  })
}

export const createMaterialCatalogItem = record => {
  if (!isPlainObject(record)) throw new TypeError('material registry record must be a JSON object')
  const sourceRevision = normalizeSourceRevision(record.sourceRevision, 'material registry sourceRevision')
  const materialId = requireIdentifier(record.materialId, 'material registry materialId')
  const materialVersion = requireIdentifier(record.materialVersion, 'material registry materialVersion')
  const buildIntegrity = requireDigest(record.buildIntegrity, 'material registry buildIntegrity')
  return validateMaterialCatalogItem({
    schemaVersion: MATERIAL_CATALOG_SCHEMA_VERSION,
    componentName: MATERIAL_CATALOG_COMPONENT_NAME,
    title: titleFor(materialId, materialVersion),
    createdAt: record.createdAt,
    promotionId: record.promotionId,
    artifactRef: {
      ...sourceRevision,
      target: {
        kind: 'local-material',
        materialId,
        materialVersion,
        buildIntegrity,
      },
      rollbackTo: sourceRevision,
    },
  })
}

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0)
const compareCatalogItems = (left, right) => {
  const leftIdentity = [
    left.artifactRef.target.materialId,
    left.artifactRef.target.materialVersion,
    left.artifactRef.target.buildIntegrity,
    left.artifactRef.artifactId,
    left.artifactRef.sourceRevision,
    left.promotionId,
  ]
  const rightIdentity = [
    right.artifactRef.target.materialId,
    right.artifactRef.target.materialVersion,
    right.artifactRef.target.buildIntegrity,
    right.artifactRef.artifactId,
    right.artifactRef.sourceRevision,
    right.promotionId,
  ]
  for (let index = 0; index < leftIdentity.length; index += 1) {
    const order = compareText(leftIdentity[index], rightIdentity[index])
    if (order !== 0) return order
  }
  return 0
}

const durableIdentityKey = item =>
  [
    item.artifactRef.target.materialId,
    item.artifactRef.target.materialVersion,
    item.artifactRef.target.buildIntegrity,
  ].join('\0')

const assertUniqueDurableIdentities = materials => {
  const identities = new Map()
  for (const material of materials) {
    const key = durableIdentityKey(material)
    const existing = identities.get(key)
    if (!existing) {
      identities.set(key, material)
      continue
    }
    if (JSON.stringify(existing) === JSON.stringify(material)) {
      throw new TypeError('catalog contains a duplicate durable material identity')
    }
    throw new TypeError('catalog contains a conflicting durable material identity')
  }
}

export const createMaterialCatalogListResponse = records => {
  if (!Array.isArray(records)) throw new TypeError('material registry list must be an array')
  const materials = records.map(createMaterialCatalogItem)
  assertUniqueDurableIdentities(materials)
  return deepFreeze({
    schemaVersion: MATERIAL_CATALOG_SCHEMA_VERSION,
    materials: materials.sort(compareCatalogItems),
  })
}

export const validateMaterialCatalogListResponse = value => {
  assertExactFields(value, catalogListFields, 'catalog list response')
  if (value.schemaVersion !== MATERIAL_CATALOG_SCHEMA_VERSION || !Array.isArray(value.materials)) {
    throw new TypeError('catalog list response is invalid')
  }
  const materials = value.materials.map(validateMaterialCatalogItem)
  assertUniqueDurableIdentities(materials)
  const sorted = [...materials].sort(compareCatalogItems)
  if (materials.some((item, index) => item !== sorted[index])) {
    throw new TypeError('catalog list response must use stable identity ordering')
  }
  return deepFreeze({ schemaVersion: MATERIAL_CATALOG_SCHEMA_VERSION, materials })
}
