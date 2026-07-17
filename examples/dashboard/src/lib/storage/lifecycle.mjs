import { canonicalJsonStringify } from './canonical-json.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'

export const DASHBOARD_AGENT_SESSION_STATUSES = Object.freeze(['active', 'idle', 'closed'])
export const DASHBOARD_LOCAL_GRANT_SCOPES = Object.freeze([
  'project.write',
  'data.read',
  'online-code.author',
  'dependency.resolve',
  'material.promote.local',
])
export const DASHBOARD_ARTIFACT_ROOT_OWNER_TYPES = Object.freeze([
  'working-draft',
  'project-version',
  'checkpoint',
  'task-journal',
  'tool-receipt',
  'receipt-intent',
  'compensation',
  'promotion-rollback',
  'durable-registry',
])

const activeDocumentFields = Object.freeze(['documentId', 'fileName', 'index'])
const artifactIdentityFields = Object.freeze(['artifactId', 'sourceRevision'])
const forkFields = Object.freeze(['sessionId', 'taskId', 'versionId'])
const sessionFields = Object.freeze([
  'branchId',
  'closedAt',
  'createdAt',
  'forkedFrom',
  'persistenceGeneration',
  'projectId',
  'schemaVersion',
  'sessionId',
  'status',
  'updatedAt',
])
const legacySessionFields = Object.freeze([
  'branchId',
  'persistenceGeneration',
  'projectId',
  'schemaVersion',
  'sessionId',
])
const projectVersionFields = Object.freeze([
  'activeDocument',
  'artifactRefs',
  'branchId',
  'createdAt',
  'creationBatchId',
  'name',
  'projectHash',
  'projectId',
  'projectSchema',
  'schemaVersion',
  'sourceCheckpointId',
  'sourceSessionId',
  'sourceTaskId',
  'versionId',
])
const localGrantFields = Object.freeze([
  'grantedAt',
  'policyVersion',
  'projectId',
  'providerFingerprint',
  'providerId',
  'revokedAt',
  'schemaVersion',
  'scope',
  'status',
  'updatedAt',
  'userId',
])

const failure = (reason, details = {}) =>
  new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.validationFailed, reason, details)

const isPlainObject = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertPlainObject = (value, label) => {
  if (!isPlainObject(value)) throw failure(`${label}-must-be-a-json-object`)
}

const assertExactFields = (value, fields, label) => {
  assertPlainObject(value, label)
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw failure(`${label}-fields-must-match-contract`)
  }
}

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw failure(`${label}-must-be-a-non-empty-string`)
  }
  return value
}

const requireNullableString = (value, label) => (value === null ? null : requireNonEmptyString(value, label))

const requireGeneration = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw failure(`${label}-must-be-a-non-negative-safe-integer`)
  }
  return value
}

const requirePolicyVersion = value => {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (Number.isSafeInteger(value) && value >= 0) return value
  throw failure('local-grant.policyVersion-must-be-a-non-empty-string-or-non-negative-safe-integer')
}

const normalizeActiveDocument = value => {
  if (value === null) return null
  assertExactFields(value, activeDocumentFields, 'project-version.activeDocument')
  return {
    documentId: requireNonEmptyString(value.documentId, 'project-version.activeDocument.documentId'),
    fileName: requireNonEmptyString(value.fileName, 'project-version.activeDocument.fileName'),
    index: requireGeneration(value.index, 'project-version.activeDocument.index'),
  }
}

const artifactIdentityKey = value => `${value.artifactId}\u0000${value.sourceRevision}`
const compareArtifactIdentity = (left, right) => {
  const leftKey = artifactIdentityKey(left)
  const rightKey = artifactIdentityKey(right)
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

export const normalizeArtifactIdentities = (value, label = 'artifact-identities') => {
  canonicalJsonStringify(value)
  if (!Array.isArray(value)) throw failure(`${label}-must-be-an-array`)
  const seen = new Set()
  const result = value.map((entry, index) => {
    assertExactFields(entry, artifactIdentityFields, `${label}[${index}]`)
    const normalized = {
      artifactId: requireNonEmptyString(entry.artifactId, `${label}[${index}].artifactId`),
      sourceRevision: requireNonEmptyString(entry.sourceRevision, `${label}[${index}].sourceRevision`),
    }
    const key = artifactIdentityKey(normalized)
    if (seen.has(key)) throw failure(`${label}-must-not-contain-duplicates`)
    seen.add(key)
    return normalized
  })
  return result.sort(compareArtifactIdentity)
}

const normalizeForkedFrom = value => {
  if (value === null) return null
  assertExactFields(value, forkFields, 'agent-session.forkedFrom')
  return {
    sessionId: requireNullableString(value.sessionId, 'agent-session.forkedFrom.sessionId'),
    taskId: requireNullableString(value.taskId, 'agent-session.forkedFrom.taskId'),
    versionId: requireNonEmptyString(value.versionId, 'agent-session.forkedFrom.versionId'),
  }
}

const assertSessionAuthority = (session, authority) => {
  if (!authority) return
  for (const field of ['projectId', 'branchId', 'sessionId']) {
    if (authority[field] !== undefined && session[field] !== authority[field]) {
      throw failure(`agent-session-${field}-authority-mismatch`)
    }
  }
}

export const validateAgentSessionRecord = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, sessionFields, 'agent-session')
  if (value.schemaVersion !== 1) throw failure('agent-session-schema-version-is-unsupported')
  if (!DASHBOARD_AGENT_SESSION_STATUSES.includes(value.status)) {
    throw failure('agent-session.status-is-unsupported')
  }
  const createdAt = requireGeneration(value.createdAt, 'agent-session.createdAt')
  const updatedAt = requireGeneration(value.updatedAt, 'agent-session.updatedAt')
  if (updatedAt < createdAt) throw failure('agent-session.updatedAt-must-not-precede-createdAt')
  const closedAt = value.closedAt === null ? null : requireGeneration(value.closedAt, 'agent-session.closedAt')
  if (value.status === 'closed') {
    if (closedAt === null || closedAt < createdAt || closedAt > updatedAt) {
      throw failure('closed-agent-session-requires-a-valid-closedAt')
    }
  } else if (closedAt !== null) {
    throw failure('non-closed-agent-session.closedAt-must-be-null')
  }
  return {
    schemaVersion: 1,
    projectId: requireNonEmptyString(value.projectId, 'agent-session.projectId'),
    branchId: requireNonEmptyString(value.branchId, 'agent-session.branchId'),
    sessionId: requireNonEmptyString(value.sessionId, 'agent-session.sessionId'),
    status: value.status,
    persistenceGeneration: requireGeneration(value.persistenceGeneration, 'agent-session.persistenceGeneration'),
    createdAt,
    updatedAt,
    closedAt,
    forkedFrom: normalizeForkedFrom(value.forkedFrom),
  }
}

export const normalizeStoredAgentSessionRecord = (value, authority) => {
  canonicalJsonStringify(value)
  const fields = Object.keys(value).sort()
  const expectedLegacy = [...legacySessionFields].sort()
  let session
  if (fields.length === expectedLegacy.length && fields.every((field, index) => field === expectedLegacy[index])) {
    if (value.schemaVersion !== 1) throw failure('agent-session-schema-version-is-unsupported')
    session = {
      schemaVersion: 1,
      projectId: requireNonEmptyString(value.projectId, 'agent-session.projectId'),
      branchId: requireNonEmptyString(value.branchId, 'agent-session.branchId'),
      sessionId: requireNonEmptyString(value.sessionId, 'agent-session.sessionId'),
      status: 'active',
      persistenceGeneration: requireGeneration(value.persistenceGeneration, 'agent-session.persistenceGeneration'),
      createdAt: 0,
      updatedAt: 0,
      closedAt: null,
      forkedFrom: null,
    }
  } else {
    session = validateAgentSessionRecord(value)
  }
  assertSessionAuthority(session, authority)
  return session
}

export const advanceAgentSessionPersistenceRecord = (current, authority, persistenceGeneration) => {
  const base =
    current === undefined
      ? {
          schemaVersion: 1,
          projectId: requireNonEmptyString(authority.projectId, 'agent-session.projectId'),
          branchId: requireNonEmptyString(authority.branchId, 'agent-session.branchId'),
          sessionId: requireNonEmptyString(authority.sessionId, 'agent-session.sessionId'),
          status: 'active',
          persistenceGeneration: 0,
          createdAt: 0,
          updatedAt: 0,
          closedAt: null,
          forkedFrom: null,
        }
      : normalizeStoredAgentSessionRecord(current, authority)
  return validateAgentSessionRecord({ ...base, persistenceGeneration })
}

export const validateProjectVersionRecord = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, projectVersionFields, 'project-version')
  if (value.schemaVersion !== 1) throw failure('project-version-schema-version-is-unsupported')
  assertPlainObject(value.projectSchema, 'project-version.projectSchema')
  if (typeof value.projectHash !== 'string' || !/^sha256:[\da-f]{64}$/u.test(value.projectHash)) {
    throw failure('project-version.projectHash-is-invalid')
  }
  return {
    schemaVersion: 1,
    projectId: requireNonEmptyString(value.projectId, 'project-version.projectId'),
    branchId: requireNonEmptyString(value.branchId, 'project-version.branchId'),
    versionId: requireNonEmptyString(value.versionId, 'project-version.versionId'),
    name: requireNonEmptyString(value.name, 'project-version.name'),
    createdAt: requireGeneration(value.createdAt, 'project-version.createdAt'),
    creationBatchId: requireNonEmptyString(value.creationBatchId, 'project-version.creationBatchId'),
    activeDocument: normalizeActiveDocument(value.activeDocument),
    projectSchema: structuredClone(value.projectSchema),
    projectHash: value.projectHash,
    artifactRefs: normalizeArtifactIdentities(value.artifactRefs, 'project-version.artifactRefs'),
    sourceSessionId: requireNullableString(value.sourceSessionId, 'project-version.sourceSessionId'),
    sourceTaskId: requireNullableString(value.sourceTaskId, 'project-version.sourceTaskId'),
    sourceCheckpointId: requireNullableString(value.sourceCheckpointId, 'project-version.sourceCheckpointId'),
  }
}

export const validateLocalGrantRecord = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, localGrantFields, 'local-grant')
  if (value.schemaVersion !== 1) throw failure('local-grant-schema-version-is-unsupported')
  if (!DASHBOARD_LOCAL_GRANT_SCOPES.includes(value.scope)) throw failure('local-grant.scope-is-unsupported')
  if (value.status !== 'granted' && value.status !== 'revoked') {
    throw failure('local-grant.status-is-unsupported')
  }
  const grantedAt = requireGeneration(value.grantedAt, 'local-grant.grantedAt')
  const updatedAt = requireGeneration(value.updatedAt, 'local-grant.updatedAt')
  if (updatedAt < grantedAt) throw failure('local-grant.updatedAt-must-not-precede-grantedAt')
  const revokedAt = value.revokedAt === null ? null : requireGeneration(value.revokedAt, 'local-grant.revokedAt')
  if (value.status === 'revoked') {
    if (revokedAt === null || revokedAt < grantedAt || revokedAt > updatedAt) {
      throw failure('revoked-local-grant-requires-a-valid-revokedAt')
    }
  } else if (revokedAt !== null) {
    throw failure('granted-local-grant.revokedAt-must-be-null')
  }
  return {
    schemaVersion: 1,
    userId: requireNonEmptyString(value.userId, 'local-grant.userId'),
    projectId: requireNonEmptyString(value.projectId, 'local-grant.projectId'),
    scope: value.scope,
    policyVersion: requirePolicyVersion(value.policyVersion),
    providerId: requireNonEmptyString(value.providerId, 'local-grant.providerId'),
    providerFingerprint: requireNonEmptyString(value.providerFingerprint, 'local-grant.providerFingerprint'),
    status: value.status,
    grantedAt,
    updatedAt,
    revokedAt,
  }
}

export const normalizeArtifactRootRecord = value => {
  canonicalJsonStringify(value)
  assertPlainObject(value, 'artifact-root')
  if (value.schemaVersion !== 1) throw failure('artifact-root-schema-version-is-unsupported')
  return {
    branchId: requireNonEmptyString(value.branchId, 'artifact-root.branchId'),
    ownerType: requireNonEmptyString(value.ownerType, 'artifact-root.ownerType'),
    ownerId: requireNonEmptyString(value.ownerId, 'artifact-root.ownerId'),
    artifactId: requireNonEmptyString(value.artifactId, 'artifact-root.artifactId'),
    sourceRevision: requireNonEmptyString(value.sourceRevision, 'artifact-root.sourceRevision'),
  }
}

export const normalizeStoredArtifactIdentity = value => {
  canonicalJsonStringify(value)
  assertPlainObject(value, 'artifact')
  return {
    artifactId: requireNonEmptyString(value.artifactId, 'artifact.artifactId'),
    sourceRevision: requireNonEmptyString(value.sourceRevision, 'artifact.sourceRevision'),
  }
}
