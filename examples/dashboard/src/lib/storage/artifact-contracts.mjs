import { canonicalJsonStringify } from './canonical-json.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'
import { DASHBOARD_ARTIFACT_ROOT_OWNER_TYPES } from './lifecycle.mjs'

const sourceRevisionFields = Object.freeze(['artifactId', 'logicalComponentId', 'sourceIntegrity', 'sourceRevision'])
const onlineRefFields = Object.freeze([...sourceRevisionFields, 'target'])
const localMaterialRefFields = Object.freeze([...sourceRevisionFields, 'rollbackTo', 'target'])
const onlineTargetFields = Object.freeze(['kind'])
const localMaterialTargetFields = Object.freeze(['buildIntegrity', 'kind', 'materialId', 'materialVersion'])
const artifactRecordFields = Object.freeze([
  'artifactId',
  'createdAt',
  'css',
  'dependencyLockDigest',
  'diagnostics',
  'lockedDependencies',
  'logicalComponentId',
  'projectId',
  'provenance',
  'safeManifest',
  'schemaVersion',
  'source',
  'sourceIntegrity',
  'sourceRevision',
  'supersedes',
])
const artifactReadFields = Object.freeze(['artifactId', 'projectId', 'schemaVersion', 'sourceRevision'])
const artifactRootFields = Object.freeze([
  'artifactId',
  'branchId',
  'ownerId',
  'ownerType',
  'projectId',
  'schemaVersion',
  'sourceRevision',
])
const agentExtraFields = Object.freeze(['artifactRef', 'schemaVersion'])
const artifactIdentityFields = Object.freeze(['artifactId', 'sourceRevision'])
const artifactGenerationFenceFields = Object.freeze(['branchId', 'draftGeneration'])
const artifactRootFenceFields = Object.freeze(['artifactId', 'branchId', 'ownerId', 'ownerType', 'sourceRevision'])
const artifactSweepFields = Object.freeze([
  'artifactIdentityFence',
  'deletionCandidates',
  'generationFence',
  'projectId',
  'rootFence',
  'schemaVersion',
])

export const ARTIFACT_SOURCE_MAX_BYTES = 256 * 1024
export const ARTIFACT_CSS_MAX_BYTES = 128 * 1024
export const ARTIFACT_LOCKED_DEPENDENCY_MAX_COUNT = 64
export const ARTIFACT_DIAGNOSTIC_MAX_COUNT = 128
export const ARTIFACT_SAFE_MANIFEST_MAX_BYTES = 64 * 1024
export const ARTIFACT_DIAGNOSTICS_MAX_BYTES = 128 * 1024
export const ARTIFACT_PROVENANCE_MAX_BYTES = 64 * 1024
export const ARTIFACT_RECORD_MAX_BYTES = 2 * 1024 * 1024

const textEncoder = new TextEncoder()

const validationFailure = reason => new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.validationFailed, reason)

const isPlainObject = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertPlainObject = (value, label) => {
  if (!isPlainObject(value)) throw validationFailure(`${label}-must-be-a-json-object`)
}

const assertExactFields = (value, fields, label) => {
  assertPlainObject(value, label)
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw validationFailure(`${label}-fields-must-match-contract`)
  }
}

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationFailure(`${label}-must-be-a-non-empty-string`)
  }
  return value
}

const requireDigest = (value, label) => {
  if (typeof value !== 'string' || !/^sha256:[\da-f]{64}$/u.test(value)) {
    throw validationFailure(`${label}-must-be-a-sha256-digest`)
  }
  return value
}

const requireTimestamp = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw validationFailure(`${label}-must-be-a-non-negative-safe-integer`)
  }
  return value
}

const byteLengthOfJson = value => textEncoder.encode(canonicalJsonStringify(value)).byteLength

const requireJsonByteBudget = (value, maximum, label) => {
  if (byteLengthOfJson(value) > maximum) throw validationFailure(`${label}-exceeds-byte-budget`)
  return value
}

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export const cloneFrozenJson = value => deepFreeze(JSON.parse(canonicalJsonStringify(value)))

const normalizeSourceRevision = (value, label) => {
  assertExactFields(value, sourceRevisionFields, label)
  return {
    artifactId: requireNonEmptyString(value.artifactId, `${label}.artifactId`),
    sourceRevision: requireNonEmptyString(value.sourceRevision, `${label}.sourceRevision`),
    logicalComponentId: requireNonEmptyString(value.logicalComponentId, `${label}.logicalComponentId`),
    sourceIntegrity: requireDigest(value.sourceIntegrity, `${label}.sourceIntegrity`),
  }
}

export const validateArtifactSourceRevision = value => {
  canonicalJsonStringify(value)
  return cloneFrozenJson(normalizeSourceRevision(value, 'artifact-source-revision'))
}

const normalizeTarget = value => {
  assertPlainObject(value, 'artifact-ref-target')
  if (value.kind === 'online') {
    assertExactFields(value, onlineTargetFields, 'artifact-ref-online-target')
    return { kind: 'online' }
  }
  if (value.kind === 'local-material') {
    assertExactFields(value, localMaterialTargetFields, 'artifact-ref-local-material-target')
    return {
      kind: 'local-material',
      materialId: requireNonEmptyString(value.materialId, 'artifact-ref-target.materialId'),
      materialVersion: requireNonEmptyString(value.materialVersion, 'artifact-ref-target.materialVersion'),
      buildIntegrity: requireDigest(value.buildIntegrity, 'artifact-ref-target.buildIntegrity'),
    }
  }
  throw validationFailure('artifact-ref-target-kind-is-unsupported')
}

export const validateArtifactRef = value => {
  canonicalJsonStringify(value)
  assertPlainObject(value, 'artifact-ref')
  const target = normalizeTarget(value.target)
  const fields = target.kind === 'online' ? onlineRefFields : localMaterialRefFields
  assertExactFields(value, fields, 'artifact-ref')
  const normalized = {
    ...normalizeSourceRevision(
      Object.fromEntries(sourceRevisionFields.map(field => [field, value[field]])),
      'artifact-ref-source-revision',
    ),
    target,
  }
  if (target.kind === 'local-material') {
    normalized.rollbackTo = normalizeSourceRevision(value.rollbackTo, 'artifact-ref.rollbackTo')
  }
  return cloneFrozenJson(normalized)
}

export const createArtifactRevisionKey = value => {
  const revision = validateArtifactSourceRevision(value)
  return [revision.artifactId, revision.sourceRevision, revision.sourceIntegrity].map(encodeURIComponent).join('@')
}

export const validateArtifactRecord = value => {
  const canonical = canonicalJsonStringify(value)
  if (textEncoder.encode(canonical).byteLength > ARTIFACT_RECORD_MAX_BYTES) {
    throw validationFailure('artifact-record-exceeds-byte-budget')
  }
  assertExactFields(value, artifactRecordFields, 'artifact-record')
  if (value.schemaVersion !== 1) throw validationFailure('artifact-record-schema-version-is-unsupported')
  assertPlainObject(value.safeManifest, 'artifact-record.safeManifest')
  if (value.safeManifest.schemaVersion !== 1) {
    throw validationFailure('artifact-record.safeManifest-schema-version-is-unsupported')
  }
  requireJsonByteBudget(value.safeManifest, ARTIFACT_SAFE_MANIFEST_MAX_BYTES, 'artifact-record.safeManifest')
  if (!Array.isArray(value.lockedDependencies)) {
    throw validationFailure('artifact-record.lockedDependencies-must-be-an-array')
  }
  if (value.lockedDependencies.length > ARTIFACT_LOCKED_DEPENDENCY_MAX_COUNT) {
    throw validationFailure('artifact-record.lockedDependencies-exceeds-count-budget')
  }
  for (const [index, dependency] of value.lockedDependencies.entries()) {
    assertPlainObject(dependency, `artifact-record.lockedDependencies[${index}]`)
  }
  if (!Array.isArray(value.diagnostics)) throw validationFailure('artifact-record.diagnostics-must-be-an-array')
  if (value.diagnostics.length > ARTIFACT_DIAGNOSTIC_MAX_COUNT) {
    throw validationFailure('artifact-record.diagnostics-exceeds-count-budget')
  }
  requireJsonByteBudget(value.diagnostics, ARTIFACT_DIAGNOSTICS_MAX_BYTES, 'artifact-record.diagnostics')
  assertPlainObject(value.provenance, 'artifact-record.provenance')
  requireJsonByteBudget(value.provenance, ARTIFACT_PROVENANCE_MAX_BYTES, 'artifact-record.provenance')
  const source = requireNonEmptyString(value.source, 'artifact-record.source')
  if (textEncoder.encode(source).byteLength > ARTIFACT_SOURCE_MAX_BYTES) {
    throw validationFailure('artifact-record.source-exceeds-byte-budget')
  }
  if (typeof value.css !== 'string') throw validationFailure('artifact-record.css-must-be-a-string')
  if (textEncoder.encode(value.css).byteLength > ARTIFACT_CSS_MAX_BYTES) {
    throw validationFailure('artifact-record.css-exceeds-byte-budget')
  }
  const supersedes =
    value.supersedes === null ? null : normalizeSourceRevision(value.supersedes, 'artifact-record.supersedes')
  return cloneFrozenJson({
    schemaVersion: 1,
    projectId: requireNonEmptyString(value.projectId, 'artifact-record.projectId'),
    ...normalizeSourceRevision(
      Object.fromEntries(sourceRevisionFields.map(field => [field, value[field]])),
      'artifact-record-source-revision',
    ),
    source,
    css: value.css,
    safeManifest: value.safeManifest,
    lockedDependencies: value.lockedDependencies,
    dependencyLockDigest: requireDigest(value.dependencyLockDigest, 'artifact-record.dependencyLockDigest'),
    diagnostics: value.diagnostics,
    provenance: value.provenance,
    createdAt: requireTimestamp(value.createdAt, 'artifact-record.createdAt'),
    supersedes,
  })
}

export const validateArtifactReadRequest = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, artifactReadFields, 'artifact-read')
  if (value.schemaVersion !== 1) throw validationFailure('artifact-read-schema-version-is-unsupported')
  return cloneFrozenJson({
    schemaVersion: 1,
    projectId: requireNonEmptyString(value.projectId, 'artifact-read.projectId'),
    artifactId: requireNonEmptyString(value.artifactId, 'artifact-read.artifactId'),
    sourceRevision: requireNonEmptyString(value.sourceRevision, 'artifact-read.sourceRevision'),
  })
}

export const validateArtifactRootRecord = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, artifactRootFields, 'artifact-root-record')
  if (value.schemaVersion !== 1) throw validationFailure('artifact-root-record-schema-version-is-unsupported')
  const ownerType = requireNonEmptyString(value.ownerType, 'artifact-root-record.ownerType')
  if (!DASHBOARD_ARTIFACT_ROOT_OWNER_TYPES.includes(ownerType)) {
    throw validationFailure('artifact-root-record.ownerType-is-unsupported')
  }
  return cloneFrozenJson({
    schemaVersion: 1,
    projectId: requireNonEmptyString(value.projectId, 'artifact-root-record.projectId'),
    branchId: requireNonEmptyString(value.branchId, 'artifact-root-record.branchId'),
    ownerType,
    ownerId: requireNonEmptyString(value.ownerId, 'artifact-root-record.ownerId'),
    artifactId: requireNonEmptyString(value.artifactId, 'artifact-root-record.artifactId'),
    sourceRevision: requireNonEmptyString(value.sourceRevision, 'artifact-root-record.sourceRevision'),
  })
}

export const validateArtifactRootReadRequest = validateArtifactRootRecord

const compareCanonical = (left, right) => {
  const leftKey = canonicalJsonStringify(left)
  const rightKey = canonicalJsonStringify(right)
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

const normalizeUniqueList = (value, normalize, label) => {
  if (!Array.isArray(value)) throw validationFailure(`${label}-must-be-an-array`)
  const normalized = value.map((entry, index) => normalize(entry, `${label}[${index}]`)).sort(compareCanonical)
  for (let index = 1; index < normalized.length; index += 1) {
    if (canonicalJsonStringify(normalized[index - 1]) === canonicalJsonStringify(normalized[index])) {
      throw validationFailure(`${label}-must-not-contain-duplicates`)
    }
  }
  return normalized
}

export const normalizeArtifactIdentityFence = (value, label = 'artifact-identity-fence') =>
  cloneFrozenJson(
    normalizeUniqueList(
      value,
      (entry, entryLabel) => {
        assertExactFields(entry, artifactIdentityFields, entryLabel)
        return {
          artifactId: requireNonEmptyString(entry.artifactId, `${entryLabel}.artifactId`),
          sourceRevision: requireNonEmptyString(entry.sourceRevision, `${entryLabel}.sourceRevision`),
        }
      },
      label,
    ),
  )

export const normalizeArtifactGenerationFence = (value, label = 'artifact-generation-fence') =>
  cloneFrozenJson(
    normalizeUniqueList(
      value,
      (entry, entryLabel) => {
        assertExactFields(entry, artifactGenerationFenceFields, entryLabel)
        return {
          branchId: requireNonEmptyString(entry.branchId, `${entryLabel}.branchId`),
          draftGeneration: requireTimestamp(entry.draftGeneration, `${entryLabel}.draftGeneration`),
        }
      },
      label,
    ),
  )

export const normalizeArtifactRootFence = (value, label = 'artifact-root-fence') =>
  cloneFrozenJson(
    normalizeUniqueList(
      value,
      (entry, entryLabel) => {
        assertExactFields(entry, artifactRootFenceFields, entryLabel)
        return {
          branchId: requireNonEmptyString(entry.branchId, `${entryLabel}.branchId`),
          ownerType: requireNonEmptyString(entry.ownerType, `${entryLabel}.ownerType`),
          ownerId: requireNonEmptyString(entry.ownerId, `${entryLabel}.ownerId`),
          artifactId: requireNonEmptyString(entry.artifactId, `${entryLabel}.artifactId`),
          sourceRevision: requireNonEmptyString(entry.sourceRevision, `${entryLabel}.sourceRevision`),
        }
      },
      label,
    ),
  )

export const validateArtifactSweepRequest = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, artifactSweepFields, 'artifact-gc-sweep')
  if (value.schemaVersion !== 1) throw validationFailure('artifact-gc-sweep-schema-version-is-unsupported')
  const artifactIdentityFence = normalizeArtifactIdentityFence(value.artifactIdentityFence)
  const deletionCandidates = normalizeArtifactIdentityFence(value.deletionCandidates, 'artifact-deletion-candidates')
  const generationFence = normalizeArtifactGenerationFence(value.generationFence)
  const rootFence = normalizeArtifactRootFence(value.rootFence)
  const artifactKeys = new Set(artifactIdentityFence.map(canonicalJsonStringify))
  const rootKeys = new Set(
    rootFence.map(root => canonicalJsonStringify({ artifactId: root.artifactId, sourceRevision: root.sourceRevision })),
  )
  for (const candidate of deletionCandidates) {
    const key = canonicalJsonStringify(candidate)
    if (!artifactKeys.has(key)) throw validationFailure('artifact-deletion-candidate-is-outside-artifact-fence')
    if (rootKeys.has(key)) throw validationFailure('artifact-deletion-candidate-is-still-rooted')
  }
  return cloneFrozenJson({
    schemaVersion: 1,
    projectId: requireNonEmptyString(value.projectId, 'artifact-gc-sweep.projectId'),
    generationFence,
    artifactIdentityFence,
    rootFence,
    deletionCandidates,
  })
}

const normalizeCanonicalAgentExtra = value => {
  assertExactFields(value, agentExtraFields, 'node-extra.$agent')
  if (value.schemaVersion !== 1) throw validationFailure('node-extra.$agent-schema-version-is-unsupported')
  return { schemaVersion: 1, artifactRef: validateArtifactRef(value.artifactRef) }
}

const normalizeArtifactNode = node => {
  canonicalJsonStringify(node)
  assertPlainObject(node, 'artifact-node')
  if (Object.hasOwn(node, 'extra')) assertPlainObject(node.extra, 'artifact-node.extra')
  return node
}

const legacyNodeArtifactRefs = node => {
  const topLevel = Object.hasOwn(node, 'artifactRef') ? validateArtifactRef(node.artifactRef) : null
  const literalNested =
    Object.hasOwn(node, 'extra') && Object.hasOwn(node.extra, 'artifactRef')
      ? validateArtifactRef(node.extra.artifactRef)
      : null
  if (topLevel && literalNested && canonicalJsonStringify(topLevel) !== canonicalJsonStringify(literalNested)) {
    throw new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'legacy-artifact-refs-conflict')
  }
  return { topLevel, literalNested, selected: topLevel ?? literalNested }
}

export const readCanonicalNodeArtifactRef = node => {
  const normalizedNode = normalizeArtifactNode(node)
  if (Object.hasOwn(normalizedNode, '$agent')) {
    const canonical = validateArtifactRef(normalizeCanonicalAgentExtra(normalizedNode.$agent).artifactRef)
    const legacy = legacyNodeArtifactRefs(normalizedNode)
    for (const candidate of [legacy.topLevel, legacy.literalNested]) {
      if (candidate && canonicalJsonStringify(candidate) !== canonicalJsonStringify(canonical)) {
        throw new DashboardStorageError(
          DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
          'legacy-and-canonical-artifact-refs-conflict',
        )
      }
    }
    return canonical
  }
  return legacyNodeArtifactRefs(normalizedNode).selected
}

export const writeCanonicalNodeArtifactRef = (node, artifactRef) => {
  const normalizedNode = normalizeArtifactNode(node)
  const normalizedRef = validateArtifactRef(artifactRef)
  const nextExtra = Object.hasOwn(normalizedNode, 'extra')
    ? Object.fromEntries(Object.entries(normalizedNode.extra).filter(([key]) => key !== 'artifactRef'))
    : null
  const next = {
    ...Object.fromEntries(Object.entries(normalizedNode).filter(([key]) => key !== 'artifactRef' && key !== 'extra')),
    ...(nextExtra && Object.keys(nextExtra).length > 0 ? { extra: nextExtra } : {}),
    $agent: { schemaVersion: 1, artifactRef: normalizedRef },
  }
  return cloneFrozenJson(next)
}

export const migrateLegacyNodeArtifactRef = node => {
  const normalizedNode = normalizeArtifactNode(node)
  const selected = readCanonicalNodeArtifactRef(normalizedNode)
  return selected === null ? cloneFrozenJson(normalizedNode) : writeCanonicalNodeArtifactRef(normalizedNode, selected)
}
