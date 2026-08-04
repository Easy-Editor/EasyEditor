import {
  normalizeLocalMaterialPromotionJournalRecord,
  normalizeLocalMaterialPromotionPlannedPostImages,
  normalizeLocalMaterialPromotionPreImages,
} from '../../editor/agent/capabilities/promotion/contract.mjs'
import { createFieldSlotAliases } from '../../editor/agent/persistence/provenance.mjs'
import {
  createToolReceiptWitness,
  parseApplyWitness,
  parseFailureWitness,
  parseToolReceipt,
} from '../../editor/agent/persistence/receipt-ledger.mjs'
import {
  cloneFrozenJson,
  normalizeArtifactMaterialRefs,
  readCanonicalNodeArtifactRef,
  validateArtifactReadRequest,
  validateArtifactRecord,
  validateArtifactRootReadRequest,
  validateArtifactRootRecord,
  validateArtifactSweepRequest,
} from './artifact-contracts.mjs'
import { canonicalJsonStringify, hashCanonicalJson } from './canonical-json.mjs'
import {
  assertStorageCompatibilityWritable,
  createStorageCompatibilityMarker,
  readStorageCompatibilityMarker,
} from './compatibility-marker.mjs'
import {
  createAgentPersistenceCheckpointId,
  validateAgentPersistenceBatch,
  validateAgentPersistenceReadRequest,
  validateCompensationRunListRequest,
  validateCompensationRunReadRequest,
  validateCompensationRunStateCommit,
  validateCompensationTargetClaimReadRequest,
  validateDurableProjectBatch,
  validateMigrationStateRecord,
  validateMutationProvenanceReadRequest,
  validateReceiptIntentRecord,
  validateReceiptLineageReadRequest,
} from './contracts.mjs'
import { materializeLegacyFromCanonical, selectForwardReentryDraft } from './downgrade.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'
import {
  requestLegacyIdentityLock,
  requestLegacySnapshotLock,
  requestProjectMaterialLock,
} from './legacy-snapshot-lock.mjs'
import {
  DASHBOARD_LOCAL_GRANT_SCOPES,
  normalizeArtifactIdentities,
  normalizeArtifactRootRecord,
  normalizeStoredAgentSessionRecord,
  normalizeStoredArtifactIdentity,
  validateAgentSessionRecord,
  validateLocalGrantRecord,
  validateProjectVersionRecord,
} from './lifecycle.mjs'
import { DASHBOARD_MATERIAL_GC_STORE_NAMES, validateMaterialGcStoreSnapshot } from './material-gc.mjs'

const commitRequestFields = Object.freeze([
  'activeDocument',
  'batchId',
  'branchId',
  'commitKind',
  'expectedDraftGeneration',
  'operations',
  'projectId',
  'projectSchema',
  'schemaVersion',
  'updatedAt',
])
const commitRequestOptionalFields = Object.freeze(['forceProvenanceInvalidation'])
const migrationRequestFields = Object.freeze([
  'activeDocument',
  'branchId',
  'diagnostics',
  'expectedDraftGeneration',
  'projectHash',
  'projectId',
  'projectSchema',
  'source',
  'sourceDraftGeneration',
  'updatedAt',
])
const migrationFailureFields = Object.freeze([
  'branchId',
  'diagnostics',
  'projectId',
  'source',
  'sourceDraftGeneration',
  'updatedAt',
])
const downgradeRequiredFields = Object.freeze(['branchId', 'legacy', 'projectId'])
const downgradeOptionalFields = Object.freeze(['crashInjector', 'now'])
const legacyIdentityFields = Object.freeze(['legacy', 'marker'])
const legacyMigrationTransitionFields = Object.freeze([
  'branchId',
  'expectedMarker',
  'legacy',
  'migration',
  'projectId',
  'updatedAt',
])
const indexedDbBootstrapFields = Object.freeze(['branchId', 'legacy', 'migration', 'projectId', 'updatedAt'])
const projectVersionCreateFields = Object.freeze([
  'artifactRefs',
  'batchId',
  'branchId',
  'createdAt',
  'expectedDraftGeneration',
  'name',
  'projectId',
  'schemaVersion',
  'sourceCheckpointId',
  'sourceSessionId',
  'sourceTaskId',
  'versionId',
])
const projectVersionReadFields = Object.freeze(['branchId', 'projectId', 'schemaVersion', 'versionId'])
const projectListFields = Object.freeze(['projectId', 'schemaVersion'])
const agentSessionSaveFields = Object.freeze([
  'batchId',
  'branchId',
  'createdAt',
  'expectedDraftGeneration',
  'forkedFrom',
  'projectId',
  'schemaVersion',
  'sessionId',
  'status',
  'updatedAt',
])
const agentSessionScopeFields = Object.freeze(['branchId', 'projectId', 'schemaVersion'])
const projectVersionRestoreFields = Object.freeze([
  'batchId',
  'forkedFromSessionId',
  'forkedFromTaskId',
  'projectId',
  'restoredAt',
  'schemaVersion',
  'sourceBranchId',
  'targetBranchId',
  'targetSessionId',
  'versionId',
])
const localGrantAuthorizeFields = Object.freeze([
  'batchId',
  'branchId',
  'expectedDraftGeneration',
  'policyVersion',
  'projectId',
  'providerFingerprint',
  'providerId',
  'schemaVersion',
  'scope',
  'updatedAt',
  'userId',
])
const localGrantCheckFields = Object.freeze([
  'policyVersion',
  'projectId',
  'providerFingerprint',
  'providerId',
  'schemaVersion',
  'scope',
  'userId',
])
const localGrantRevokeFields = Object.freeze([
  'batchId',
  'branchId',
  'expectedDraftGeneration',
  'policyVersion',
  'projectId',
  'revokedAt',
  'schemaVersion',
  'scope',
  'userId',
])
const localGrantListFields = Object.freeze(['projectId', 'schemaVersion', 'userId'])
const compensationJournalRecordFields = Object.freeze([
  'branchId',
  'callId',
  'draftGeneration',
  'kind',
  'projectId',
  'recordId',
  'schemaVersion',
  'sessionId',
  'updatedAt',
  'value',
])
const compensationJournalRecordOptionalFields = Object.freeze(['writerCheckpointId'])
const durableAgentCheckpointFields = Object.freeze([
  'branchId',
  'callId',
  'checkpointId',
  'draftGeneration',
  'journalRecordId',
  'outcome',
  'projectId',
  'schemaVersion',
  'sessionId',
  'value',
])
const compensationCursorCheckpointValueFields = Object.freeze([
  'compensationRunId',
  'cursor',
  'inverseCallId',
  'originalCallId',
  'schemaVersion',
])
const compensationClaimValueFields = Object.freeze([
  'branchId',
  'outerCallId',
  'projectId',
  'schemaVersion',
  'sessionId',
  'status',
  'targetTaskId',
])
const mutationProvenanceRecordFields = Object.freeze([
  'branchId',
  'draftGeneration',
  'projectId',
  'schemaVersion',
  'slotKey',
  'token',
])
const legacyDowngradeMethods = Object.freeze([
  'ensureIdentity',
  'inspectCompatibilityMarker',
  'readValue',
  'writeCompatibilityMarker',
  'writeValue',
])
const legacyMigrationMethods = Object.freeze([
  'ensureIdentity',
  'inspectCompatibilityMarker',
  'readProjectCandidate',
  'writeCompatibilityMarker',
])
const lockAlreadyHeldManager = Object.freeze({
  request(_name, _options, operation) {
    return operation()
  },
})

const validationFailure = reason => new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.validationFailed, reason)

const assertRecord = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw validationFailure(`${label}-must-be-an-object`)
  }
}

const assertExactFields = (value, fields, label) => {
  assertRecord(value, label)
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw validationFailure(`${label}-fields-must-match-contract`)
  }
}

const assertExactFieldsWithOptional = (value, requiredFields, optionalFields, label) => {
  assertRecord(value, label)
  const actual = Object.keys(value)
  const allowed = new Set([...requiredFields, ...optionalFields])
  if (requiredFields.some(field => !Object.hasOwn(value, field)) || actual.some(field => !allowed.has(field))) {
    throw validationFailure(`${label}-fields-must-match-contract`)
  }
}

const requireAuthority = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) throw validationFailure(`${label}-must-be-a-non-empty-string`)
  return value
}

const requireGeneration = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw validationFailure(`${label}-must-be-a-non-negative-safe-integer`)
  }
  return value
}

const requireSha256 = (value, label) => {
  if (typeof value !== 'string' || !/^sha256:[\da-f]{64}$/u.test(value)) {
    throw validationFailure(`${label}-must-be-a-sha256-digest`)
  }
  return value
}

const requireNullableAuthority = (value, label) => (value === null ? null : requireAuthority(value, label))

const requirePolicyVersion = value => {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (Number.isSafeInteger(value) && value >= 0) return value
  throw validationFailure('local-grant.policyVersion-must-be-a-non-empty-string-or-non-negative-safe-integer')
}

const normalizeCommitRequest = value => {
  canonicalJsonStringify(value)
  assertExactFieldsWithOptional(value, commitRequestFields, commitRequestOptionalFields, 'project-persistence-commit')
  if (value.schemaVersion !== 1) throw validationFailure('project-persistence-commit-schema-version-is-unsupported')
  if (!Array.isArray(value.operations)) {
    throw validationFailure('project-persistence-commit.operations-must-be-an-array')
  }
  if (value.operations.some(operation => operation?.type === 'invalidate-agent-provenance')) {
    throw validationFailure('project-persistence-provenance-invalidation-is-coordinator-controlled')
  }
  if (value.forceProvenanceInvalidation !== undefined && value.forceProvenanceInvalidation !== true) {
    throw validationFailure('project-persistence-commit.forceProvenanceInvalidation-must-equal-true')
  }
  return structuredClone(value)
}

const normalizeMigrationRequest = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, migrationRequestFields, 'project-persistence-migration')
  return structuredClone(value)
}

const normalizeMigrationFailure = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, migrationFailureFields, 'project-persistence-migration-failure')
  return structuredClone(value)
}

const normalizeExpectedMarker = value => {
  if (value === null) return null
  assertRecord(value, 'project-persistence-expected-compatibility-marker')
  const marker = createStorageCompatibilityMarker(value)
  if (canonicalJsonStringify(marker) !== canonicalJsonStringify(value)) {
    throw validationFailure('project-persistence-expected-compatibility-marker-fields-must-match-contract')
  }
  return marker
}

const assertLegacyMethods = (legacy, methods, label) => {
  assertRecord(legacy, label)
  for (const method of methods) {
    if (typeof legacy[method] !== 'function') throw validationFailure(`${label}.${method}-must-be-a-function`)
  }
}

const normalizeLegacyIdentityRequest = value => {
  assertExactFields(value, legacyIdentityFields, 'project-persistence-legacy-identity')
  assertLegacyMethods(value.legacy, ['ensureIdentity'], 'project-persistence-legacy-identity.legacy')
  return Object.freeze({ legacy: value.legacy, marker: normalizeExpectedMarker(value.marker) })
}

const normalizeLegacyMigrationTransition = value => {
  assertExactFields(value, legacyMigrationTransitionFields, 'project-persistence-legacy-migration-transition')
  const scope = normalizeScope({ projectId: value.projectId, branchId: value.branchId })
  assertLegacyMethods(value.legacy, legacyMigrationMethods, 'project-persistence-legacy-migration-transition.legacy')
  const migration = value.migration === null ? null : normalizeMigrationRequest(value.migration)
  if (migration && (migration.projectId !== scope.projectId || migration.branchId !== scope.branchId)) {
    throw validationFailure('legacy-migration-transition-scope-does-not-match-migration')
  }
  if (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) {
    throw validationFailure('legacy-migration-transition.updatedAt-must-be-a-non-negative-safe-integer')
  }
  return Object.freeze({
    ...scope,
    legacy: value.legacy,
    expectedMarker: normalizeExpectedMarker(value.expectedMarker),
    migration,
    updatedAt: value.updatedAt,
  })
}

const normalizeIndexedDbBootstrap = value => {
  assertExactFields(value, indexedDbBootstrapFields, 'project-persistence-indexeddb-bootstrap')
  const scope = normalizeScope({ projectId: value.projectId, branchId: value.branchId })
  assertLegacyMethods(value.legacy, legacyMigrationMethods, 'project-persistence-indexeddb-bootstrap.legacy')
  const migration = value.migration === null ? null : normalizeMigrationRequest(value.migration)
  if (migration && (migration.projectId !== scope.projectId || migration.branchId !== scope.branchId)) {
    throw validationFailure('indexeddb-bootstrap-scope-does-not-match-migration')
  }
  if (migration && migration.source !== 'unknown') {
    throw validationFailure('indexeddb-bootstrap-migration-source-must-be-unknown')
  }
  if (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) {
    throw validationFailure('indexeddb-bootstrap.updatedAt-must-be-a-non-negative-safe-integer')
  }
  return Object.freeze({ ...scope, legacy: value.legacy, migration, updatedAt: value.updatedAt })
}

const normalizeDowngradeRequest = value => {
  assertRecord(value, 'project-persistence-downgrade')
  const optionalFields = downgradeOptionalFields.filter(field => Object.hasOwn(value, field))
  assertExactFields(value, [...downgradeRequiredFields, ...optionalFields], 'project-persistence-downgrade')
  const scope = normalizeScope({ projectId: value.projectId, branchId: value.branchId })
  assertLegacyMethods(value.legacy, legacyDowngradeMethods, 'project-persistence-downgrade.legacy')
  if (value.now !== undefined && typeof value.now !== 'function') {
    throw validationFailure('project-persistence-downgrade.now-must-be-a-function')
  }
  if (value.crashInjector !== undefined && typeof value.crashInjector !== 'function') {
    throw validationFailure('project-persistence-downgrade.crashInjector-must-be-a-function')
  }
  return Object.freeze({
    ...scope,
    legacy: value.legacy,
    now: value.now,
    crashInjector: value.crashInjector,
  })
}

const normalizeProjectVersionCreate = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, projectVersionCreateFields, 'project-version-create')
  if (value.schemaVersion !== 1) throw validationFailure('project-version-create-schema-version-is-unsupported')
  return {
    schemaVersion: 1,
    batchId: requireAuthority(value.batchId, 'project-version-create.batchId'),
    projectId: requireAuthority(value.projectId, 'project-version-create.projectId'),
    branchId: requireAuthority(value.branchId, 'project-version-create.branchId'),
    expectedDraftGeneration: requireGeneration(
      value.expectedDraftGeneration,
      'project-version-create.expectedDraftGeneration',
    ),
    versionId: requireAuthority(value.versionId, 'project-version-create.versionId'),
    name: requireAuthority(value.name, 'project-version-create.name'),
    createdAt: requireGeneration(value.createdAt, 'project-version-create.createdAt'),
    artifactRefs: normalizeArtifactIdentities(value.artifactRefs, 'project-version-create.artifactRefs'),
    sourceSessionId: requireNullableAuthority(value.sourceSessionId, 'project-version-create.sourceSessionId'),
    sourceTaskId: requireNullableAuthority(value.sourceTaskId, 'project-version-create.sourceTaskId'),
    sourceCheckpointId: requireNullableAuthority(value.sourceCheckpointId, 'project-version-create.sourceCheckpointId'),
  }
}

const normalizeProjectVersionRead = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, projectVersionReadFields, 'project-version-read')
  if (value.schemaVersion !== 1) throw validationFailure('project-version-read-schema-version-is-unsupported')
  return {
    schemaVersion: 1,
    projectId: requireAuthority(value.projectId, 'project-version-read.projectId'),
    branchId: requireAuthority(value.branchId, 'project-version-read.branchId'),
    versionId: requireAuthority(value.versionId, 'project-version-read.versionId'),
  }
}

const normalizeProjectList = (value, label = 'project-list') => {
  canonicalJsonStringify(value)
  assertExactFields(value, projectListFields, label)
  if (value.schemaVersion !== 1) throw validationFailure(`${label}-schema-version-is-unsupported`)
  return { schemaVersion: 1, projectId: requireAuthority(value.projectId, `${label}.projectId`) }
}

const normalizeAgentSessionSave = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, agentSessionSaveFields, 'agent-session-save')
  if (value.schemaVersion !== 1) throw validationFailure('agent-session-save-schema-version-is-unsupported')
  const projectId = requireAuthority(value.projectId, 'agent-session-save.projectId')
  const branchId = requireAuthority(value.branchId, 'agent-session-save.branchId')
  const sessionId = requireAuthority(value.sessionId, 'agent-session-save.sessionId')
  const createdAt = requireGeneration(value.createdAt, 'agent-session-save.createdAt')
  const updatedAt = requireGeneration(value.updatedAt, 'agent-session-save.updatedAt')
  const session = validateAgentSessionRecord({
    schemaVersion: 1,
    projectId,
    branchId,
    sessionId,
    status: value.status,
    persistenceGeneration: 0,
    createdAt,
    updatedAt,
    closedAt: value.status === 'closed' ? updatedAt : null,
    forkedFrom: value.forkedFrom,
  })
  return {
    schemaVersion: 1,
    batchId: requireAuthority(value.batchId, 'agent-session-save.batchId'),
    expectedDraftGeneration: requireGeneration(
      value.expectedDraftGeneration,
      'agent-session-save.expectedDraftGeneration',
    ),
    ...session,
  }
}

const normalizeAgentSessionScope = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, agentSessionScopeFields, 'agent-session-scope')
  if (value.schemaVersion !== 1) throw validationFailure('agent-session-scope-schema-version-is-unsupported')
  return {
    schemaVersion: 1,
    projectId: requireAuthority(value.projectId, 'agent-session-scope.projectId'),
    branchId: requireAuthority(value.branchId, 'agent-session-scope.branchId'),
  }
}

const normalizeProjectVersionRestore = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, projectVersionRestoreFields, 'project-version-restore')
  if (value.schemaVersion !== 1) throw validationFailure('project-version-restore-schema-version-is-unsupported')
  const projectId = requireAuthority(value.projectId, 'project-version-restore.projectId')
  const sourceBranchId = requireAuthority(value.sourceBranchId, 'project-version-restore.sourceBranchId')
  const targetBranchId = requireAuthority(value.targetBranchId, 'project-version-restore.targetBranchId')
  if (sourceBranchId === targetBranchId) {
    throw validationFailure('project-version-restore-must-fork-a-new-branch')
  }
  return {
    schemaVersion: 1,
    batchId: requireAuthority(value.batchId, 'project-version-restore.batchId'),
    projectId,
    sourceBranchId,
    versionId: requireAuthority(value.versionId, 'project-version-restore.versionId'),
    targetBranchId,
    targetSessionId: requireAuthority(value.targetSessionId, 'project-version-restore.targetSessionId'),
    forkedFromSessionId: requireNullableAuthority(
      value.forkedFromSessionId,
      'project-version-restore.forkedFromSessionId',
    ),
    forkedFromTaskId: requireNullableAuthority(value.forkedFromTaskId, 'project-version-restore.forkedFromTaskId'),
    restoredAt: requireGeneration(value.restoredAt, 'project-version-restore.restoredAt'),
  }
}

const normalizeLocalGrantAuthorize = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, localGrantAuthorizeFields, 'local-grant-authorize')
  if (value.schemaVersion !== 1) throw validationFailure('local-grant-authorize-schema-version-is-unsupported')
  const projectId = requireAuthority(value.projectId, 'local-grant-authorize.projectId')
  const updatedAt = requireGeneration(value.updatedAt, 'local-grant-authorize.updatedAt')
  const grant = validateLocalGrantRecord({
    schemaVersion: 1,
    userId: value.userId,
    projectId,
    scope: value.scope,
    policyVersion: value.policyVersion,
    providerId: value.providerId,
    providerFingerprint: value.providerFingerprint,
    status: 'granted',
    grantedAt: updatedAt,
    updatedAt,
    revokedAt: null,
  })
  return {
    schemaVersion: 1,
    batchId: requireAuthority(value.batchId, 'local-grant-authorize.batchId'),
    branchId: requireAuthority(value.branchId, 'local-grant-authorize.branchId'),
    expectedDraftGeneration: requireGeneration(
      value.expectedDraftGeneration,
      'local-grant-authorize.expectedDraftGeneration',
    ),
    ...grant,
  }
}

const normalizeLocalGrantCheck = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, localGrantCheckFields, 'local-grant-check')
  if (value.schemaVersion !== 1) throw validationFailure('local-grant-check-schema-version-is-unsupported')
  if (!DASHBOARD_LOCAL_GRANT_SCOPES.includes(value.scope)) {
    throw validationFailure('local-grant.scope-is-unsupported')
  }
  return {
    schemaVersion: 1,
    userId: requireAuthority(value.userId, 'local-grant-check.userId'),
    projectId: requireAuthority(value.projectId, 'local-grant-check.projectId'),
    scope: value.scope,
    policyVersion: requirePolicyVersion(value.policyVersion),
    providerId: requireAuthority(value.providerId, 'local-grant-check.providerId'),
    providerFingerprint: requireAuthority(value.providerFingerprint, 'local-grant-check.providerFingerprint'),
  }
}

const normalizeLocalGrantRevoke = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, localGrantRevokeFields, 'local-grant-revoke')
  if (value.schemaVersion !== 1) throw validationFailure('local-grant-revoke-schema-version-is-unsupported')
  if (!DASHBOARD_LOCAL_GRANT_SCOPES.includes(value.scope)) {
    throw validationFailure('local-grant.scope-is-unsupported')
  }
  return {
    schemaVersion: 1,
    batchId: requireAuthority(value.batchId, 'local-grant-revoke.batchId'),
    projectId: requireAuthority(value.projectId, 'local-grant-revoke.projectId'),
    branchId: requireAuthority(value.branchId, 'local-grant-revoke.branchId'),
    expectedDraftGeneration: requireGeneration(
      value.expectedDraftGeneration,
      'local-grant-revoke.expectedDraftGeneration',
    ),
    userId: requireAuthority(value.userId, 'local-grant-revoke.userId'),
    scope: value.scope,
    policyVersion: requirePolicyVersion(value.policyVersion),
    revokedAt: requireGeneration(value.revokedAt, 'local-grant-revoke.revokedAt'),
  }
}

const normalizeLocalGrantList = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, localGrantListFields, 'local-grant-list')
  if (value.schemaVersion !== 1) throw validationFailure('local-grant-list-schema-version-is-unsupported')
  return {
    schemaVersion: 1,
    userId: requireAuthority(value.userId, 'local-grant-list.userId'),
    projectId: requireAuthority(value.projectId, 'local-grant-list.projectId'),
  }
}

const normalizeScope = value => {
  canonicalJsonStringify(value)
  assertExactFields(value, ['branchId', 'projectId'], 'project-persistence-scope')
  return {
    projectId: requireAuthority(value.projectId, 'project-persistence-scope.projectId'),
    branchId: requireAuthority(value.branchId, 'project-persistence-scope.branchId'),
  }
}

const scopeKey = scope => canonicalJsonStringify([scope.projectId, scope.branchId])
const agentPersistenceScopeKey = scope =>
  canonicalJsonStringify(['agent-persistence', scope.projectId, scope.branchId, scope.sessionId])
const artifactProjectScopeKey = projectId => canonicalJsonStringify(['artifact-project', projectId])

const compensationRunRecordId = outerCallId => `compensation-run:${outerCallId}`
const compensationTargetRecordId = targetTaskId => `compensation-target:${targetTaskId}`

const assertWriterAuthority = (value, request, callId, label) => {
  assertRecord(value, label)
  if (
    value.schemaVersion !== 1 ||
    value.projectId !== request.projectId ||
    value.branchId !== request.branchId ||
    value.callId !== callId
  ) {
    throw validationFailure(`${label}-authority-mismatch`)
  }
}

const validateCompensationRunWriter = async (backend, request, stored) => {
  const outerCallId = stored.value.outerCallId
  if (stored.callId === outerCallId) {
    if (stored.writerCheckpointId !== null && stored.writerCheckpointId !== undefined) {
      throw validationFailure('compensation-state-writer-checkpoint-must-be-null')
    }
    return
  }

  const derivedCheckpointId = `compensation-cursor-v1:${encodeURIComponent(
    stored.value.compensationRunId,
  )}:${stored.value.cursor}:${encodeURIComponent(stored.callId)}`
  const checkpointId =
    stored.writerCheckpointId === undefined
      ? derivedCheckpointId
      : requireAuthority(stored.writerCheckpointId, 'compensation-run.writerCheckpointId')
  if (checkpointId !== derivedCheckpointId) {
    throw validationFailure('compensation-run-writer-checkpoint-id-mismatch')
  }
  const checkpoint = await backend.get('agentCheckpoints', [request.projectId, request.branchId, checkpointId])
  canonicalJsonStringify(checkpoint)
  assertExactFields(checkpoint, durableAgentCheckpointFields, 'compensation-run-writer-checkpoint')
  if (
    checkpoint.schemaVersion !== 1 ||
    checkpoint.projectId !== request.projectId ||
    checkpoint.branchId !== request.branchId ||
    checkpoint.checkpointId !== checkpointId ||
    checkpoint.sessionId !== request.sessionId ||
    checkpoint.callId !== stored.callId ||
    checkpoint.draftGeneration !== stored.draftGeneration ||
    checkpoint.journalRecordId !== stored.recordId ||
    (checkpoint.outcome !== 'committed' && checkpoint.outcome !== 'failed')
  ) {
    throw validationFailure('compensation-run-writer-checkpoint-authority-mismatch')
  }
  assertExactFields(
    checkpoint.value,
    compensationCursorCheckpointValueFields,
    'compensation-run-writer-checkpoint.value',
  )
  if (
    checkpoint.value.schemaVersion !== 1 ||
    checkpoint.value.compensationRunId !== stored.value.compensationRunId ||
    checkpoint.value.cursor !== stored.value.cursor ||
    checkpoint.value.inverseCallId !== stored.callId ||
    !Array.isArray(stored.value.originalCallIds) ||
    !Number.isSafeInteger(stored.value.cursor) ||
    stored.value.cursor < 0 ||
    stored.value.cursor > stored.value.originalCallIds.length ||
    checkpoint.value.originalCallId !==
      (stored.value.originalCallIds.length === 0
        ? '$empty'
        : stored.value.cursor > 0
          ? stored.value.originalCallIds[stored.value.cursor - 1]
          : null)
  ) {
    throw validationFailure('compensation-run-writer-checkpoint-value-mismatch')
  }

  const authorityKey = [request.projectId, request.branchId, stored.callId]
  const [intent, receipt, applyWitness, failureWitness] = await Promise.all([
    backend.get('receiptIntents', authorityKey),
    backend.get('toolReceipts', authorityKey),
    backend.get('applyWitnesses', authorityKey),
    backend.get('failureWitnesses', authorityKey),
  ])
  const parsedIntent = validateReceiptIntentRecord(intent)
  if (
    parsedIntent.projectId !== request.projectId ||
    parsedIntent.branchId !== request.branchId ||
    parsedIntent.callId !== stored.callId
  ) {
    throw validationFailure('compensation-run-writer-intent-authority-mismatch')
  }
  canonicalJsonStringify(receipt)
  assertWriterAuthority(receipt, request, stored.callId, 'compensation-run-writer-receipt')
  const committed = checkpoint.outcome === 'committed'
  const witness = committed ? applyWitness : failureWitness
  const forbiddenWitness = committed ? failureWitness : applyWitness
  if (
    (committed && receipt.status !== 'applied') ||
    (!committed && receipt.status !== 'not-applied' && receipt.status !== 'rejected') ||
    forbiddenWitness !== undefined
  ) {
    throw validationFailure('compensation-run-writer-terminal-lineage-mismatch')
  }
  if (committed && (typeof receipt.revision !== 'string' || receipt.revision.length === 0)) {
    throw validationFailure('compensation-run-writer-receipt-revision-is-invalid')
  }
  canonicalJsonStringify(witness)
  assertWriterAuthority(witness, request, stored.callId, 'compensation-run-writer-witness')
  if (witness.draftGeneration !== stored.draftGeneration) {
    throw validationFailure('compensation-run-writer-witness-generation-mismatch')
  }
}

const compensationClaimValue = request => ({
  schemaVersion: 1,
  projectId: request.projectId,
  branchId: request.branchId,
  sessionId: request.sessionId,
  targetTaskId: request.targetTaskId,
  outerCallId: request.outerCallId,
  status: 'active',
})

const validateCompensationClaimValue = (value, request) => {
  canonicalJsonStringify(value)
  assertExactFields(value, compensationClaimValueFields, 'compensation-target-claim')
  const expected = compensationClaimValue(request)
  if (canonicalJsonStringify(value) !== canonicalJsonStringify(expected)) {
    throw validationFailure('compensation-target-claim-authority-mismatch')
  }
  return structuredClone(value)
}

export const createMigrationBatchId = value => {
  const projectId = requireAuthority(value.projectId, 'project-persistence-migration.projectId')
  const branchId = requireAuthority(value.branchId, 'project-persistence-migration.branchId')
  if (!Number.isSafeInteger(value.expectedDraftGeneration) || value.expectedDraftGeneration < 0) {
    throw validationFailure('project-persistence-migration.expectedDraftGeneration-must-be-a-non-negative-safe-integer')
  }
  if (!Number.isSafeInteger(value.sourceDraftGeneration) || value.sourceDraftGeneration < 0) {
    throw validationFailure('project-persistence-migration.sourceDraftGeneration-must-be-a-non-negative-safe-integer')
  }
  if (typeof value.projectHash !== 'string' || !/^sha256:[\da-f]{64}$/u.test(value.projectHash)) {
    throw validationFailure('project-persistence-migration.projectHash-is-invalid')
  }
  return `migration-v1:${encodeURIComponent(projectId)}:${encodeURIComponent(branchId)}:${value.sourceDraftGeneration}:${value.projectHash}`
}

const asIntegrityMismatch = (scope, reason, cause) =>
  new DashboardStorageError(
    DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
    reason,
    { projectId: scope.projectId, branchId: scope.branchId },
    { cause },
  )

const hasExactMutationAttribution = operations =>
  operations.some(operation => operation.type === 'put' && operation.store === 'mutationProvenance')

const jsonEqual = (left, right) => canonicalJsonStringify(left) === canonicalJsonStringify(right)

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const escapeProvenanceSegment = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1')

const canonicalProjectNodeIds = projectSchema => {
  const ids = new Set()
  const visit = node => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    if (typeof node.id === 'string' && node.id.length > 0) ids.add(escapeProvenanceSegment(node.id))
    if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  if (Array.isArray(projectSchema?.componentsTree)) projectSchema.componentsTree.forEach(visit)
  return ids
}

const isOrphanedFieldProvenance = (record, request, currentNodeIds) => {
  if (
    record?.projectId !== request.projectId ||
    record?.branchId !== request.branchId ||
    typeof record.slotKey !== 'string'
  ) {
    return false
  }
  const scopePrefix = `${escapeProvenanceSegment(request.projectId)}/${escapeProvenanceSegment(request.branchId)}/`
  if (!record.slotKey.startsWith(scopePrefix)) return false
  const remainder = record.slotKey.slice(scopePrefix.length)
  const separator = remainder.indexOf('/')
  if (separator <= 0) return false
  const nodeId = remainder.slice(0, separator)
  const root = remainder.slice(separator + 1).split('/', 1)[0]
  return (root === 'props' || root === 'extras') && !currentNodeIds.has(nodeId)
}

const compareArtifactIdentity = (left, right) =>
  compareText(`${left.artifactId}\u0000${left.sourceRevision}`, `${right.artifactId}\u0000${right.sourceRevision}`)

const compareCanonical = (left, right) => compareText(canonicalJsonStringify(left), canonicalJsonStringify(right))

const promotionAffectedSlotKeys = ({ projectId, branchId, nodeId }) =>
  [
    ...new Set([
      ...createFieldSlotAliases({ projectId, branchId, nodeId, root: 'extras', path: ['$agent'] }),
      ...createFieldSlotAliases({ projectId, branchId, nodeId, root: 'extras', path: ['artifactRef'] }),
      ...createFieldSlotAliases({ projectId, branchId, nodeId, root: 'extras', path: ['extra', 'artifactRef'] }),
    ]),
  ].sort(compareText)

const addMaterialRef = (refs, value, label) => {
  const materialRef = normalizeArtifactMaterialRefs([value], label)[0]
  refs.set(canonicalJsonStringify(materialRef), materialRef)
  return materialRef
}

const promotionLineageKey = value => `${value.branchId}\u0000${value.callId}`

const promotionCheckpointKey = value => `${value.branchId}\u0000${value.sessionId}\u0000${value.callId}`

const sourceRevisionOf = value => ({
  artifactId: value.artifactId,
  sourceRevision: value.sourceRevision,
  logicalComponentId: value.logicalComponentId,
  sourceIntegrity: value.sourceIntegrity,
})

const promotionIdentityHashInput = journal => ({
  schemaVersion: 1,
  kind: 'local-material-promotion-identity',
  authority: {
    projectId: journal.projectId,
    branchId: journal.branchId,
    sessionId: journal.sessionId,
    taskId: journal.taskId,
  },
  callId: journal.callId,
  callDigest: journal.value.callDigest,
  artifact: journal.value.artifactIdentity,
})

const preparedHashInput = ({ journal, intent }) => ({
  schemaVersion: 1,
  kind: 'local-material-promotion-prepared-hash',
  projectId: journal.projectId,
  branchId: journal.branchId,
  callId: journal.callId,
  baseRevision: journal.value.prepare.baseRevision,
  preImages: intent.preImages,
  expectedPostImages: intent.expectedPostImages,
})

const promotionArtifactRef = journal => ({
  ...sourceRevisionOf(journal.value.artifactIdentity),
  target: {
    kind: 'local-material',
    materialId: journal.value.server.materialId,
    materialVersion: journal.value.server.materialVersion,
    buildIntegrity: journal.value.server.buildIntegrity,
  },
  rollbackTo: journal.value.server.rollbackTo,
})

const promotionTransactionFingerprintInput = journal => ({
  schemaVersion: 1,
  kind: 'local-material-promotion-transaction-fingerprint',
  projectId: journal.projectId,
  branchId: journal.branchId,
  callId: journal.callId,
  promotionId: journal.value.promotionId,
  documentId: journal.value.prepare.documentId,
  nodeId: journal.value.prepare.nodeId,
  baseMutationVersion: journal.value.prepare.baseMutationVersion,
  previousArtifactRef: journal.value.prepare.previousArtifactRef,
  artifactRef: promotionArtifactRef(journal),
})

const validateMaterialGcPromotionJournal = async (record, projectId, crypto) => {
  assertExactFieldsWithOptional(
    record,
    ['branchId', 'kind', 'projectId', 'recordId', 'schemaVersion', 'sessionId', 'value'],
    ['callId', 'draftGeneration', 'taskId', 'updatedAt', 'writerCheckpointId'],
    'material-gc-promotion-journal',
  )
  if (record.schemaVersion !== 1 || record.projectId !== projectId) {
    throw validationFailure('material-gc-promotion-journal-authority-mismatch')
  }
  const branchId = requireAuthority(record.branchId, 'material-gc-promotion-journal.branchId')
  const sessionId = requireAuthority(record.sessionId, 'material-gc-promotion-journal.sessionId')
  assertRecord(record.value, 'material-gc-promotion-journal.value')
  assertRecord(record.value.call, 'material-gc-promotion-journal.value.call')
  const callId = requireAuthority(record.value.call.callId, 'material-gc-promotion-journal.value.call.callId')
  const taskId = requireAuthority(record.value.call.taskId, 'material-gc-promotion-journal.value.call.taskId')
  const journal = normalizeLocalMaterialPromotionJournalRecord(
    Object.hasOwn(record, 'callId') ? record : { ...record, callId },
    { projectId, branchId, sessionId, taskId },
  )
  if (
    (journal.value.stage === 'committed' || journal.value.stage === 'failed') &&
    (record.callId !== journal.callId ||
      !Number.isSafeInteger(record.draftGeneration) ||
      record.draftGeneration < 1 ||
      !Number.isSafeInteger(record.updatedAt) ||
      record.updatedAt < 0)
  ) {
    throw validationFailure('material-gc-terminal-promotion-storage-projection-is-incomplete')
  }
  const expectedCallDigest = await hashCanonicalJson(journal.value.call, { crypto })
  if (journal.value.callDigest !== expectedCallDigest) {
    throw validationFailure('material-gc-promotion-journal-call-digest-does-not-match')
  }
  const expectedPromotionId = await hashCanonicalJson(promotionIdentityHashInput(journal), { crypto })
  if (journal.value.promotionId !== expectedPromotionId) {
    throw validationFailure('material-gc-promotion-journal-promotion-id-does-not-match')
  }
  return journal
}

const validateMaterialGcReceiptIntent = (record, projectId) => {
  const intent = validateReceiptIntentRecord(record)
  if (intent.projectId !== projectId) throw validationFailure('material-gc-receipt-intent-project-authority-mismatch')
  const promotionPre = intent.preImages?.kind === 'local-material-promotion-pre-images'
  const promotionPost = intent.expectedPostImages?.kind === 'local-material-promotion-post-images'
  if (!promotionPre && !promotionPost) return { intent, promotion: null }
  if (!promotionPre || !promotionPost) {
    throw validationFailure('material-gc-receipt-intent-promotion-authority-mismatch')
  }
  const preImages = normalizeLocalMaterialPromotionPreImages(intent.preImages)
  const expectedPostImages = normalizeLocalMaterialPromotionPlannedPostImages(intent.expectedPostImages)
  if (
    intent.baseRevision !== preImages.expectedRevision ||
    preImages.promotionId !== expectedPostImages.promotionId ||
    preImages.nodeId !== expectedPostImages.nodeId ||
    !jsonEqual(sourceRevisionOf(preImages.artifactIdentity), expectedPostImages.sourceRevision) ||
    !jsonEqual(sourceRevisionOf(preImages.previousArtifactRef), expectedPostImages.sourceRevision)
  ) {
    throw validationFailure('material-gc-receipt-intent-promotion-authority-mismatch')
  }
  return {
    intent: { ...intent, preImages, expectedPostImages },
    promotion: { promotionId: preImages.promotionId },
  }
}

const validateMaterialGcToolReceipt = (record, projectId) => {
  const receipt = parseToolReceipt(record)
  if (receipt.projectId !== projectId) {
    throw validationFailure('material-gc-tool-receipt-authority-mismatch')
  }
  return receipt
}

const validateMaterialGcReceiptWitness = receipt => {
  assertRecord(receipt.witness, 'material-gc-tool-receipt.witness')
  const { kind, ...reference } = receipt.witness
  let witness
  if (kind === 'apply') {
    witness = parseApplyWitness({
      projectId: receipt.projectId,
      branchId: receipt.branchId,
      callId: receipt.callId,
      ...reference,
    })
  } else if (kind === 'failure') {
    witness = parseFailureWitness({
      projectId: receipt.projectId,
      branchId: receipt.branchId,
      callId: receipt.callId,
      ...reference,
    })
  } else {
    throw validationFailure('material-gc-tool-receipt-witness-kind-is-invalid')
  }
  if (!jsonEqual(createToolReceiptWitness(witness), receipt.witness)) {
    throw validationFailure('material-gc-tool-receipt-witness-is-not-canonical')
  }
  return { kind, witness }
}

const validateMaterialGcAgentPersistenceResult = (value, batchId) => {
  assertRecord(value, 'material-gc-persistence-checkpoint.result')
  const rejected = value.status === 'rejected'
  assertExactFields(
    value,
    ['batchId', 'persistenceGeneration', 'schemaVersion', 'status', ...(rejected ? ['failure'] : [])],
    'material-gc-persistence-checkpoint.result',
  )
  if (
    value.schemaVersion !== 1 ||
    value.batchId !== batchId ||
    (value.status !== 'committed' && value.status !== 'generation-conflict' && value.status !== 'rejected')
  ) {
    throw validationFailure('material-gc-persistence-checkpoint-result-authority-is-invalid')
  }
  requireGeneration(value.persistenceGeneration, 'material-gc-persistence-checkpoint.result.persistenceGeneration')
  if (rejected) {
    assertExactFields(
      value.failure,
      ['code', 'details', 'message', 'retryable'],
      'material-gc-persistence-checkpoint.result.failure',
    )
    requireAuthority(value.failure.code, 'material-gc-persistence-checkpoint.result.failure.code')
    requireAuthority(value.failure.message, 'material-gc-persistence-checkpoint.result.failure.message')
    if (value.failure.retryable !== true && value.failure.retryable !== false) {
      throw validationFailure('material-gc-persistence-checkpoint.result.failure.retryable-must-be-a-boolean')
    }
    assertRecord(value.failure.details, 'material-gc-persistence-checkpoint.result.failure.details')
    canonicalJsonStringify(value.failure.details)
  }
  return value
}

const validateMaterialGcCheckpoint = (record, projectId) => {
  assertRecord(record, 'material-gc-checkpoint')
  if (record.schemaVersion !== 1 || record.projectId !== projectId) {
    throw validationFailure('material-gc-checkpoint-authority-mismatch')
  }
  requireAuthority(record.branchId, 'material-gc-checkpoint.branchId')
  const sessionId = requireAuthority(record.sessionId, 'material-gc-checkpoint.sessionId')
  const checkpointId = requireAuthority(record.checkpointId, 'material-gc-checkpoint.checkpointId')
  if (Object.hasOwn(record, 'requestHash')) {
    assertExactFields(
      record,
      ['batchId', 'branchId', 'checkpointId', 'projectId', 'requestHash', 'result', 'schemaVersion', 'sessionId'],
      'material-gc-persistence-checkpoint',
    )
    const batchId = requireAuthority(record.batchId, 'material-gc-persistence-checkpoint.batchId')
    if (checkpointId !== createAgentPersistenceCheckpointId({ sessionId, batchId })) {
      throw validationFailure('material-gc-persistence-checkpoint-id-does-not-match')
    }
    requireSha256(record.requestHash, 'material-gc-persistence-checkpoint.requestHash')
    const result = validateMaterialGcAgentPersistenceResult(record.result, batchId)
    return {
      checkpoint: { ...record, result },
      promotion: null,
      sessionRequired: result.status === 'committed' || result.persistenceGeneration > 0,
    }
  }
  assertExactFields(record, durableAgentCheckpointFields, 'material-gc-durable-checkpoint')
  requireAuthority(record.callId, 'material-gc-durable-checkpoint.callId')
  requireGeneration(record.draftGeneration, 'material-gc-durable-checkpoint.draftGeneration')
  assertRecord(record.value, 'material-gc-durable-checkpoint.value')
  if (record.value.capability !== 'artifact.promoteLocal') {
    return { checkpoint: record, promotion: null, sessionRequired: true }
  }
  const status = record.value.status
  const failed = status === 'not-applied'
  assertExactFields(
    record.value,
    ['capability', 'promotionId', 'schemaVersion', 'status', 'stepId', 'taskId', ...(failed ? ['failureCode'] : [])],
    'material-gc-promotion-checkpoint.value',
  )
  if (
    record.value.schemaVersion !== 1 ||
    (status !== 'applied' && status !== 'not-applied') ||
    record.outcome !== (failed ? 'failed' : 'committed') ||
    record.checkpointId !== `promotion:${record.callId}` ||
    record.journalRecordId !== `promotion:${record.callId}`
  ) {
    throw validationFailure('material-gc-promotion-checkpoint-outcome-is-invalid')
  }
  requireAuthority(record.value.taskId, 'material-gc-promotion-checkpoint.value.taskId')
  requireAuthority(record.value.stepId, 'material-gc-promotion-checkpoint.value.stepId')
  if (failed) requireAuthority(record.value.failureCode, 'material-gc-promotion-checkpoint.value.failureCode')
  return {
    checkpoint: record,
    sessionRequired: true,
    promotion: {
      promotionId: requireSha256(record.value.promotionId, 'material-gc-promotion-checkpoint.value.promotionId'),
    },
  }
}

const validateMaterialGcTerminalPromotion = async ({ journal, intent, receipt, checkpoint, crypto }) => {
  if (!intent || !receipt || !checkpoint) {
    throw validationFailure('material-gc-terminal-promotion-lineage-is-incomplete')
  }
  const { call, prepare, artifactIdentity, promotionId, stage } = journal.value
  const preImages = intent.preImages
  const expectedPostImages = intent.expectedPostImages
  if (
    intent.projectId !== journal.projectId ||
    intent.branchId !== journal.branchId ||
    intent.callId !== journal.callId ||
    intent.baseRevision !== prepare.baseRevision ||
    preImages.capability !== call.capability ||
    preImages.documentId !== prepare.documentId ||
    preImages.nodeId !== prepare.nodeId ||
    preImages.nodeId !== call.arguments.nodeId ||
    preImages.promotionId !== promotionId ||
    preImages.callDigest !== journal.value.callDigest ||
    preImages.expectedRevision !== call.expectedRevision ||
    !jsonEqual(preImages.previousArtifactRef, prepare.previousArtifactRef) ||
    !jsonEqual(preImages.artifactIdentity, artifactIdentity) ||
    expectedPostImages.nodeId !== call.arguments.nodeId ||
    expectedPostImages.promotionId !== promotionId ||
    !jsonEqual(expectedPostImages.sourceRevision, sourceRevisionOf(artifactIdentity))
  ) {
    throw validationFailure('material-gc-terminal-promotion-intent-does-not-match-journal')
  }
  const expectedPreparedHash = await hashCanonicalJson(preparedHashInput({ journal, intent }), { crypto })
  if (intent.preparedHash !== expectedPreparedHash) {
    throw validationFailure('material-gc-terminal-promotion-prepared-hash-does-not-match')
  }
  if (
    receipt.projectId !== journal.projectId ||
    receipt.branchId !== journal.branchId ||
    receipt.callId !== journal.callId ||
    receipt.revision === undefined ||
    checkpoint.projectId !== journal.projectId ||
    checkpoint.branchId !== journal.branchId ||
    checkpoint.sessionId !== journal.sessionId ||
    checkpoint.callId !== journal.callId ||
    checkpoint.checkpointId !== `promotion:${journal.callId}` ||
    checkpoint.journalRecordId !== journal.recordId ||
    checkpoint.draftGeneration !== journal.draftGeneration ||
    checkpoint.value.taskId !== call.taskId ||
    checkpoint.value.stepId !== call.stepId ||
    checkpoint.value.promotionId !== promotionId
  ) {
    throw validationFailure('material-gc-terminal-promotion-authority-does-not-match')
  }
  const { kind: witnessKind, witness } = validateMaterialGcReceiptWitness(receipt)
  const expectedTransactionFingerprint = await hashCanonicalJson(promotionTransactionFingerprintInput(journal), {
    crypto,
  })
  if (
    witness.draftGeneration !== journal.draftGeneration ||
    witness.draftGeneration !== checkpoint.draftGeneration ||
    witness.transactionFingerprint !== expectedTransactionFingerprint
  ) {
    throw validationFailure('material-gc-terminal-promotion-witness-authority-does-not-match')
  }
  if (stage === 'committed') {
    if (
      receipt.status !== 'applied' ||
      witnessKind !== 'apply' ||
      checkpoint.outcome !== 'committed' ||
      checkpoint.value.status !== 'applied'
    ) {
      throw validationFailure('material-gc-terminal-promotion-committed-outcome-does-not-match')
    }
    const expectedAffectedSlotKeys = promotionAffectedSlotKeys({
      projectId: journal.projectId,
      branchId: journal.branchId,
      nodeId: prepare.nodeId,
    })
    if (
      witness.coreMutationVersion <= prepare.baseMutationVersion ||
      !jsonEqual(
        witness.affectedSlotTokens.map(entry => entry.slotKey),
        expectedAffectedSlotKeys,
      )
    ) {
      throw validationFailure('material-gc-terminal-promotion-apply-witness-does-not-match-core-contract')
    }
  } else if (
    stage !== 'failed' ||
    (receipt.status !== 'not-applied' && receipt.status !== 'rejected') ||
    witnessKind !== 'failure' ||
    witness.receiptStatus !== receipt.status ||
    witness.failureCode !== receipt.failure?.code ||
    witness.failureCode !== journal.value.failureCode ||
    receipt.failure?.code !== journal.value.failureCode ||
    checkpoint.outcome !== 'failed' ||
    checkpoint.value.status !== 'not-applied' ||
    checkpoint.value.failureCode !== journal.value.failureCode
  ) {
    throw validationFailure('material-gc-terminal-promotion-failed-outcome-does-not-match')
  }
  return {
    materialRef: {
      materialId: journal.value.server.materialId,
      materialVersion: journal.value.server.materialVersion,
      buildIntegrity: journal.value.server.buildIntegrity,
    },
    promotionId,
  }
}

const compareSession = (left, right) => left.createdAt - right.createdAt || compareText(left.sessionId, right.sessionId)

const compareVersion = (left, right) =>
  left.createdAt - right.createdAt ||
  compareText(left.branchId, right.branchId) ||
  compareText(left.versionId, right.versionId)

const compareGrant = (left, right) =>
  compareText(left.scope, right.scope) ||
  compareText(String(left.policyVersion), String(right.policyVersion)) ||
  left.updatedAt - right.updatedAt

const compareRoot = (left, right) =>
  compareText(
    [left.branchId, left.ownerType, left.ownerId, left.artifactId, left.sourceRevision].join('\u0000'),
    [right.branchId, right.ownerType, right.ownerId, right.artifactId, right.sourceRevision].join('\u0000'),
  )

const artifactRootFenceFromRecords = roots =>
  roots.map(root => ({
    branchId: root.branchId,
    ownerType: root.ownerType,
    ownerId: root.ownerId,
    artifactId: root.artifactId,
    sourceRevision: root.sourceRevision,
    materialRefs: root.materialRefs,
  }))

const artifactIdentityKey = value => `${value.artifactId}\u0000${value.sourceRevision}`
const workingDraftRootKey = value => `${value.ownerId}\u0000${artifactIdentityKey(value)}`

const materialIdentityFromArtifactRef = artifactRef =>
  artifactRef.target.kind === 'local-material'
    ? {
        materialId: artifactRef.target.materialId,
        materialVersion: artifactRef.target.materialVersion,
        buildIntegrity: artifactRef.target.buildIntegrity,
      }
    : null

const collectCanonicalProjectArtifactClaims = projectSchema => {
  const claims = new Map()
  const visitNode = node => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return
    const artifactRef = readCanonicalNodeArtifactRef(node)
    if (artifactRef) {
      const identity = { artifactId: artifactRef.artifactId, sourceRevision: artifactRef.sourceRevision }
      const key = artifactIdentityKey(identity)
      const claim = claims.get(key) ?? { ...identity, materialRefs: new Map() }
      const materialRef = materialIdentityFromArtifactRef(artifactRef)
      if (materialRef) claim.materialRefs.set(canonicalJsonStringify(materialRef), materialRef)
      claims.set(key, claim)
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visitNode(child)
    }
  }
  if (Array.isArray(projectSchema.componentsTree)) {
    for (const node of projectSchema.componentsTree) visitNode(node)
  }
  return [...claims.values()]
    .map(claim => ({
      artifactId: claim.artifactId,
      sourceRevision: claim.sourceRevision,
      materialRefs: [...claim.materialRefs.values()].sort((left, right) =>
        compareText(canonicalJsonStringify(left), canonicalJsonStringify(right)),
      ),
    }))
    .sort(compareArtifactIdentity)
}

const collectCanonicalProjectArtifactIdentities = projectSchema =>
  collectCanonicalProjectArtifactClaims(projectSchema).map(({ artifactId, sourceRevision }) => ({
    artifactId,
    sourceRevision,
  }))

const isCallerSuppliedWorkingDraftRootOperation = operation => {
  if (operation?.store !== 'artifactRefs') return false
  if (operation.type === 'put') {
    return operation.value?.ownerType === 'working-draft'
  }
  return operation.type === 'delete' && Array.isArray(operation.key) && operation.key[2] === 'working-draft'
}

const validateArtifactCreateResult = (value, artifact) => {
  try {
    assertExactFields(value, ['artifact', 'schemaVersion', 'status'], 'artifact-create-result')
    if (value.schemaVersion !== 1 || (value.status !== 'created' && value.status !== 'reconciled')) {
      throw validationFailure('artifact-create-result-status-is-invalid')
    }
    const stored = validateArtifactRecord(value.artifact)
    if (!jsonEqual(stored, artifact)) throw validationFailure('artifact-create-result-authority-mismatch')
    return cloneFrozenJson({ schemaVersion: 1, status: value.status, artifact: stored })
  } catch (error) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'storage-backend-artifact-create-result-is-invalid',
      { projectId: artifact.projectId, artifactId: artifact.artifactId, sourceRevision: artifact.sourceRevision },
      { cause: error },
    )
  }
}

const validateArtifactRootMutationResult = (value, root, statuses, reason) => {
  try {
    assertExactFields(value, ['root', 'schemaVersion', 'status'], 'artifact-root-mutation-result')
    if (value.schemaVersion !== 1 || !statuses.includes(value.status)) {
      throw validationFailure('artifact-root-mutation-result-status-is-invalid')
    }
    const stored = validateArtifactRootRecord(value.root)
    if (!jsonEqual(stored, root)) throw validationFailure('artifact-root-mutation-result-authority-mismatch')
    return cloneFrozenJson({ schemaVersion: 1, status: value.status, root: stored })
  } catch (error) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      reason,
      { projectId: root.projectId, branchId: root.branchId },
      { cause: error },
    )
  }
}

const draftFenceFromRecords = (records, projectId) =>
  records
    .filter(record => record?.projectId === projectId)
    .map(record => ({
      branchId: requireAuthority(record.branchId, 'artifact-root-fence.branchId'),
      draftGeneration: requireGeneration(record.draftGeneration, 'artifact-root-fence.draftGeneration'),
    }))
    .sort((left, right) => compareText(left.branchId, right.branchId))

const defaultCompatibilityStorage = () => {
  if (typeof globalThis.window === 'undefined') return null
  try {
    const storage = globalThis.window.localStorage
    return storage && typeof storage.getItem === 'function' ? storage : null
  } catch {
    return null
  }
}

const markerFromDraft = (draft, updatedAt) =>
  createStorageCompatibilityMarker({
    canonicalBackend: 'indexeddb',
    projectId: draft.projectId,
    branchId: draft.branchId,
    draftGeneration: draft.draftGeneration,
    projectHash: draft.projectHash,
    updatedAt,
  })

const createTrackedMaterialGcSnapshotPromise = (task, markObserved) =>
  new Proxy(task, {
    get(target, property) {
      if (property === 'then' || property === 'catch' || property === 'finally') {
        return (...args) => {
          markObserved()
          return Reflect.apply(Promise.prototype[property], target, args)
        }
      }
      return Reflect.get(target, property, target)
    },
  })

export class ProjectPersistenceCoordinator {
  #backend
  #compatibilityStorage
  #crypto
  #lockManager
  #disposed = false
  #disposePromise = null
  #pendingByScope = new Map()
  #tails = new Map()

  constructor(options) {
    assertRecord(options, 'project-persistence-coordinator-options')
    if (!options.backend || typeof options.backend.commit !== 'function') {
      throw validationFailure('project-persistence-coordinator-backend-is-required')
    }
    if (options.compatibilityStorage !== undefined && typeof options.compatibilityStorage?.getItem !== 'function') {
      throw validationFailure('project-persistence-coordinator-compatibility-storage-must-be-a-reader')
    }
    if (options.lockManager !== undefined && typeof options.lockManager?.request !== 'function') {
      throw validationFailure('project-persistence-coordinator-lock-manager-must-support-request')
    }
    this.#backend = options.backend
    this.#compatibilityStorage = options.compatibilityStorage ?? defaultCompatibilityStorage()
    this.#crypto = options.crypto
    this.#lockManager = options.lockManager
  }

  #assertAccepting() {
    if (this.#disposed) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.disposed,
        'project-persistence-coordinator-is-disposed',
      )
    }
  }

  #track(key, task) {
    let pending = this.#pendingByScope.get(key)
    if (!pending) {
      pending = new Set()
      this.#pendingByScope.set(key, pending)
    }
    pending.add(task)
    const remove = () => {
      pending.delete(task)
      if (pending.size === 0) this.#pendingByScope.delete(key)
    }
    task.then(remove, remove)
  }

  #enqueue(key, operation) {
    const previous = this.#tails.get(key) ?? Promise.resolve()
    const task = previous.then(operation)
    const settled = task.then(
      () => undefined,
      () => undefined,
    )
    this.#tails.set(key, settled)
    settled.then(() => {
      if (this.#tails.get(key) === settled) this.#tails.delete(key)
    })
    this.#track(key, task)
    return task
  }

  #withSnapshotLock(scope, operation) {
    return requestLegacySnapshotLock({ scope, lockManager: this.#lockManager }, operation)
  }

  #withProjectMaterialLock(projectId, mode, operation) {
    return requestProjectMaterialLock({ projectId, lockManager: this.#lockManager, mode }, operation)
  }

  #assertLegacyMigrationAuthority(request) {
    const inspection = request.legacy.inspectCompatibilityMarker()
    if (inspection.diagnostic) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
        'malformed-compatibility-marker-requires-recovery',
        { diagnosticCode: inspection.diagnostic.code },
      )
    }
    const marker = inspection.marker
    assertStorageCompatibilityWritable(marker)
    if (canonicalJsonStringify(marker) !== canonicalJsonStringify(request.expectedMarker)) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
        'storage-compatibility-authority-changed-during-migration',
        {
          projectId: request.projectId,
          branchId: request.branchId,
          expectedCanonicalBackend: request.expectedMarker?.canonicalBackend ?? 'none',
          actualCanonicalBackend: marker?.canonicalBackend ?? 'none',
          expectedGeneration: request.expectedMarker?.draftGeneration ?? 0,
          actualGeneration: marker?.draftGeneration ?? 0,
        },
      )
    }
    if (marker && (marker.projectId !== request.projectId || marker.branchId !== request.branchId)) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'storage-compatibility-marker-authority-does-not-match-migration',
      )
    }
    return marker
  }

  #assertOrdinaryCommitAuthority(scope) {
    if (!this.#compatibilityStorage) return
    let inspection
    try {
      inspection = readStorageCompatibilityMarker(this.#compatibilityStorage)
    } catch (cause) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.storageUnavailable,
        'storage-compatibility-marker-cannot-be-read-before-commit',
        { projectId: scope.projectId, branchId: scope.branchId },
        { cause },
      )
    }
    if (inspection.diagnostic) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
        'malformed-compatibility-marker-requires-recovery',
      )
    }
    const marker = inspection.marker
    if (
      marker?.canonicalBackend === 'legacy-local-storage' &&
      marker.projectId === scope.projectId &&
      marker.branchId === scope.branchId
    ) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
        'legacy-local-storage-is-canonical-for-project',
        { projectId: scope.projectId, branchId: scope.branchId, draftGeneration: marker.draftGeneration },
      )
    }
  }

  async #commitNow(request, expectedProjectHash, nextDraftGeneration = request.expectedDraftGeneration + 1) {
    return this.#withProjectMaterialLock(request.projectId, 'shared', () =>
      this.#commitWithMaterialLock(request, expectedProjectHash, nextDraftGeneration),
    )
  }

  async #commitWithMaterialLock(request, expectedProjectHash, nextDraftGeneration) {
    const projectHash = await hashCanonicalJson(request.projectSchema, { crypto: this.#crypto })
    if (expectedProjectHash !== undefined && projectHash !== expectedProjectHash) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'migration-project-hash-does-not-match',
        { expected: expectedProjectHash, actual: projectHash },
      )
    }
    const draft = {
      schemaVersion: 1,
      projectId: request.projectId,
      branchId: request.branchId,
      draftGeneration: nextDraftGeneration,
      activeDocument: request.activeDocument,
      projectSchema: request.projectSchema,
      projectHash,
      commitKind: request.commitKind,
      updatedAt: request.updatedAt,
    }
    // Legacy coordinator-only adapters predate artifact storage. Production
    // backends expose getAll, while those adapters have no prior roots to
    // reconcile and can safely begin from an empty set.
    const [storedArtifactRoots, storedProvenance] =
      typeof this.#backend.getAll === 'function'
        ? await Promise.all([this.#backend.getAll('artifactRefs'), this.#backend.getAll('mutationProvenance')])
        : [[], []]
    const storedWorkingDraftRoots = storedArtifactRoots
      .filter(
        root =>
          root?.projectId === request.projectId &&
          root?.branchId === request.branchId &&
          root?.ownerType === 'working-draft',
      )
      .map(normalizeArtifactRootRecord)
      .sort(compareRoot)
    const desiredWorkingDraftRoots = collectCanonicalProjectArtifactClaims(request.projectSchema).map(identity => ({
      schemaVersion: 1,
      projectId: request.projectId,
      branchId: request.branchId,
      ownerType: 'working-draft',
      ownerId: request.branchId,
      ...identity,
    }))
    const desiredKeys = new Set(desiredWorkingDraftRoots.map(workingDraftRootKey))
    const currentByKey = new Map(storedWorkingDraftRoots.map(root => [workingDraftRootKey(root), root]))
    const workingDraftRootOperations = [
      ...storedWorkingDraftRoots
        .filter(root => !desiredKeys.has(workingDraftRootKey(root)))
        .map(root => ({
          type: 'delete',
          store: 'artifactRefs',
          key: [
            request.projectId,
            request.branchId,
            'working-draft',
            root.ownerId,
            root.artifactId,
            root.sourceRevision,
          ],
        })),
      ...desiredWorkingDraftRoots
        .filter(root => {
          const current = currentByKey.get(workingDraftRootKey(root))
          return !current || !jsonEqual(current.materialRefs, root.materialRefs)
        })
        .map(value => ({ type: 'put', store: 'artifactRefs', value })),
    ]
    const currentNodeIds = canonicalProjectNodeIds(request.projectSchema)
    const pruneOrphanedFieldProvenance =
      (request.commitKind === 'autosave' || request.commitKind === 'manual-save') &&
      hasExactMutationAttribution(request.operations)
    const requestedOperations = request.operations.filter(
      operation =>
        !isCallerSuppliedWorkingDraftRootOperation(operation) &&
        !(
          pruneOrphanedFieldProvenance &&
          operation.type === 'put' &&
          operation.store === 'mutationProvenance' &&
          isOrphanedFieldProvenance(operation.value, request, currentNodeIds)
        ),
    )
    const orphanedFieldProvenanceOperations = pruneOrphanedFieldProvenance
      ? storedProvenance
          .filter(record => isOrphanedFieldProvenance(record, request, currentNodeIds))
          .map(record => ({
            type: 'delete',
            store: 'mutationProvenance',
            key: [request.projectId, request.branchId, record.slotKey],
          }))
      : []
    const forceProvenanceInvalidation = request.forceProvenanceInvalidation === true
    const invalidateProvenance =
      forceProvenanceInvalidation ||
      request.commitKind === 'migration' ||
      (request.commitKind !== 'agent-batch' && !hasExactMutationAttribution(request.operations))
    const operations = invalidateProvenance
      ? [
          {
            type: 'invalidate-agent-provenance',
            store: 'mutationProvenance',
            ...(forceProvenanceInvalidation ? { force: true } : {}),
          },
          ...orphanedFieldProvenanceOperations,
          ...requestedOperations,
          ...workingDraftRootOperations,
        ]
      : [...orphanedFieldProvenanceOperations, ...requestedOperations, ...workingDraftRootOperations]
    const result = await this.#backend.commit({
      schemaVersion: 1,
      batchId: request.batchId,
      projectId: request.projectId,
      branchId: request.branchId,
      expectedDraftGeneration: request.expectedDraftGeneration,
      draft,
      operations,
    })
    return Object.freeze({ ...result, draft: structuredClone(draft) })
  }

  async commit(value) {
    this.#assertAccepting()
    const request = normalizeCommitRequest(value)
    const key = scopeKey(request)
    return this.#enqueue(key, () =>
      this.#withSnapshotLock(request, () => {
        this.#assertOrdinaryCommitAuthority(request)
        return this.#commitNow(request)
      }),
    )
  }

  async #commitMigrationNow(migration) {
    const batchId = createMigrationBatchId(migration)
    const request = normalizeCommitRequest({
      schemaVersion: 1,
      batchId,
      projectId: migration.projectId,
      branchId: migration.branchId,
      expectedDraftGeneration: migration.expectedDraftGeneration,
      activeDocument: migration.activeDocument,
      projectSchema: migration.projectSchema,
      commitKind: 'migration',
      updatedAt: migration.updatedAt,
      operations: [],
    })
    const projectHash = await hashCanonicalJson(migration.projectSchema, { crypto: this.#crypto })
    if (projectHash !== migration.projectHash) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'migration-project-hash-does-not-match',
        { expected: migration.projectHash, actual: projectHash },
      )
    }

    const current = await this.#readWorkingDraftNow({
      projectId: migration.projectId,
      branchId: migration.branchId,
    })
    const currentGeneration = current?.draftGeneration ?? 0
    const migrationState = targetGeneration =>
      validateMigrationStateRecord({
        schemaVersion: 1,
        projectId: migration.projectId,
        branchId: migration.branchId,
        status: 'draft-committed',
        source: migration.source,
        sourceDraftGeneration: migration.sourceDraftGeneration,
        targetGeneration,
        diagnostics: migration.diagnostics,
        updatedAt: migration.updatedAt,
      })
    if (current && migration.sourceDraftGeneration < currentGeneration) {
      if (
        current.commitKind === 'migration' &&
        currentGeneration === migration.sourceDraftGeneration + 1 &&
        current.projectHash === migration.projectHash
      ) {
        await this.#backend.putMigrationState(migrationState(currentGeneration))
        return current
      }
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
        'migration-source-generation-is-stale',
        {
          projectId: migration.projectId,
          branchId: migration.branchId,
          source: migration.sourceDraftGeneration,
          current: currentGeneration,
        },
      )
    }
    if (current && migration.sourceDraftGeneration === currentGeneration) {
      if (current.projectHash !== migration.projectHash) {
        throw new DashboardStorageError(
          DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
          'migration-source-diverges-at-the-same-generation',
          {
            projectId: migration.projectId,
            branchId: migration.branchId,
            draftGeneration: currentGeneration,
          },
        )
      }
      return current
    }

    const targetGeneration = migration.sourceDraftGeneration + 1
    const result = await this.#commitNow(
      {
        ...request,
        operations: [
          {
            type: 'put',
            store: 'migrationState',
            value: migrationState(targetGeneration),
          },
        ],
      },
      migration.projectHash,
      targetGeneration,
    )
    return result.draft
  }

  async commitMigration(value) {
    this.#assertAccepting()
    const migration = normalizeMigrationRequest(value)
    return this.#enqueue(scopeKey(migration), () =>
      this.#withSnapshotLock(migration, () => this.#commitMigrationNow(migration)),
    )
  }

  async ensureLegacyIdentity(value) {
    this.#assertAccepting()
    const request = normalizeLegacyIdentityRequest(value)
    return requestLegacyIdentityLock({ lockManager: this.#lockManager }, () =>
      request.legacy.ensureIdentity(request.marker),
    )
  }

  async transitionLegacyMigration(value) {
    this.#assertAccepting()
    const request = normalizeLegacyMigrationTransition(value)
    return this.#enqueue(scopeKey(request), () =>
      this.#withSnapshotLock(request, async () => {
        const marker = this.#assertLegacyMigrationAuthority(request)
        const indexedDbDraft = await this.#readWorkingDraftNow(request)
        let legacyDraft = null

        if (marker?.canonicalBackend !== 'indexeddb') {
          const candidate = request.legacy.readProjectCandidate()
          if (candidate.status !== 'ready') {
            throw new DashboardStorageError(
              DASHBOARD_STORAGE_ERROR_CODE.migrationFailed,
              'legacy-project-candidate-changed-during-authority-transition',
            )
          }
          const projectHash = await hashCanonicalJson(candidate.projectSchema, { crypto: this.#crypto })
          legacyDraft = {
            schemaVersion: 1,
            projectId: request.projectId,
            branchId: request.branchId,
            draftGeneration: marker?.draftGeneration ?? 0,
            activeDocument: candidate.activeDocument,
            projectSchema: candidate.projectSchema,
            projectHash,
            commitKind: 'migration',
            updatedAt: marker?.updatedAt ?? 0,
          }
          if (
            request.migration &&
            (candidate.source !== request.migration.source ||
              projectHash !== request.migration.projectHash ||
              canonicalJsonStringify(candidate.activeDocument) !==
                canonicalJsonStringify(request.migration.activeDocument))
          ) {
            throw new DashboardStorageError(
              DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
              'legacy-project-candidate-changed-during-authority-transition',
            )
          }
        }

        const selected = selectForwardReentryDraft({ indexedDbDraft, legacyDraft, marker })
        if (selected.source === 'indexeddb') {
          request.legacy.writeCompatibilityMarker(markerFromDraft(selected.draft, request.updatedAt))
          return Object.freeze({ status: 'reconciled', draft: selected.draft })
        }
        if (!request.migration || !legacyDraft) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
            'legacy-source-remains-canonical-during-migration-reconciliation',
          )
        }
        if (
          request.migration.sourceDraftGeneration !== legacyDraft.draftGeneration ||
          request.migration.expectedDraftGeneration !== (indexedDbDraft?.draftGeneration ?? 0)
        ) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
            'legacy-migration-generations-changed-before-commit',
          )
        }

        const committedDraft = await this.#commitMigrationNow(request.migration)
        const previousCanonicalGeneration = Math.max(indexedDbDraft?.draftGeneration ?? 0, legacyDraft.draftGeneration)
        if (
          committedDraft.projectId !== request.projectId ||
          committedDraft.branchId !== request.branchId ||
          committedDraft.projectHash !== request.migration.projectHash ||
          committedDraft.draftGeneration <= previousCanonicalGeneration
        ) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
            'legacy-migration-commit-returned-invalid-canonical-draft',
          )
        }
        request.legacy.writeCompatibilityMarker(markerFromDraft(committedDraft, request.updatedAt))
        return Object.freeze({ status: 'committed', draft: committedDraft })
      }),
    )
  }

  async bootstrapIndexedDbAuthority(value) {
    this.#assertAccepting()
    const request = normalizeIndexedDbBootstrap(value)
    return this.#enqueue(scopeKey(request), () =>
      this.#withSnapshotLock(request, async () => {
        const inspection = request.legacy.inspectCompatibilityMarker()
        if (inspection.diagnostic) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
            'malformed-compatibility-marker-requires-recovery',
            { diagnosticCode: inspection.diagnostic.code },
          )
        }
        const marker = inspection.marker
        assertStorageCompatibilityWritable(marker)
        const current = await this.#readWorkingDraftNow(request)

        if (marker) {
          if (
            marker.canonicalBackend !== 'indexeddb' ||
            marker.projectId !== request.projectId ||
            marker.branchId !== request.branchId
          ) {
            throw new DashboardStorageError(
              DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
              'storage-compatibility-authority-changed-during-bootstrap',
              {
                projectId: request.projectId,
                branchId: request.branchId,
                actualCanonicalBackend: marker.canonicalBackend,
                actualGeneration: marker.draftGeneration,
              },
            )
          }
          const selected = selectForwardReentryDraft({ indexedDbDraft: current, legacyDraft: null, marker })
          request.legacy.writeCompatibilityMarker(markerFromDraft(selected.draft, request.updatedAt))
          return Object.freeze({ status: 'reconciled', draft: selected.draft })
        }

        let draft = current
        let status = 'reconciled'
        if (request.migration) {
          const previousGeneration = current?.draftGeneration ?? 0
          draft = await this.#commitMigrationNow(request.migration)
          status = draft.draftGeneration > previousGeneration ? 'committed' : 'reconciled'
        }
        if (!draft) {
          throw validationFailure('indexeddb-bootstrap-requires-a-working-draft-or-migration')
        }
        if (draft.projectId !== request.projectId || draft.branchId !== request.branchId) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
            'indexeddb-bootstrap-draft-authority-does-not-match',
          )
        }
        request.legacy.writeCompatibilityMarker(markerFromDraft(draft, request.updatedAt))
        return Object.freeze({ status, draft })
      }),
    )
  }

  async recordMigrationState(value) {
    this.#assertAccepting()
    const record = validateMigrationStateRecord(value)
    if (typeof this.#backend.putMigrationState !== 'function') {
      throw validationFailure('storage-backend-migration-state-seam-is-required')
    }
    return this.#enqueue(scopeKey(record), () => this.#backend.putMigrationState(record))
  }

  async recordMigrationFailure(value) {
    const failure = normalizeMigrationFailure(value)
    return this.recordMigrationState({
      schemaVersion: 1,
      projectId: failure.projectId,
      branchId: failure.branchId,
      status: 'failed',
      source: failure.source,
      sourceDraftGeneration: failure.sourceDraftGeneration,
      targetGeneration: null,
      diagnostics: failure.diagnostics,
      updatedAt: failure.updatedAt,
    })
  }

  async readAgentPersistence(value) {
    this.#assertAccepting()
    const request = validateAgentPersistenceReadRequest(value)
    if (typeof this.#backend.readAgentPersistence !== 'function') {
      throw validationFailure('storage-backend-agent-persistence-read-seam-is-required')
    }
    return this.#enqueue(agentPersistenceScopeKey(request), () => this.#backend.readAgentPersistence(request))
  }

  async commitAgentPersistence(value) {
    this.#assertAccepting()
    const batch = validateAgentPersistenceBatch(value)
    if (typeof this.#backend.commitAgentPersistence !== 'function') {
      throw validationFailure('storage-backend-agent-persistence-commit-seam-is-required')
    }
    return this.#enqueue(agentPersistenceScopeKey(batch), () =>
      this.#withProjectMaterialLock(batch.projectId, 'shared', () => this.#backend.commitAgentPersistence(batch)),
    )
  }

  async #commitLifecycleNow({
    batchId,
    projectId,
    branchId,
    expectedDraftGeneration,
    updatedAt,
    commitKind,
    operations,
  }) {
    const scope = { projectId, branchId }
    this.#assertOrdinaryCommitAuthority(scope)
    const current = await this.#readWorkingDraftNow(scope)
    if (!current) throw validationFailure('lifecycle-write-requires-a-working-draft')
    if (current.draftGeneration !== expectedDraftGeneration) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
        'lifecycle-write-generation-does-not-match',
        { projectId, branchId, expected: expectedDraftGeneration, actual: current.draftGeneration },
      )
    }
    return this.#commitNow(
      normalizeCommitRequest({
        schemaVersion: 1,
        batchId,
        projectId,
        branchId,
        expectedDraftGeneration,
        activeDocument: current.activeDocument,
        projectSchema: current.projectSchema,
        commitKind,
        updatedAt,
        operations,
      }),
    )
  }

  async #normalizeStoredProjectVersion(stored, authority) {
    try {
      const version = validateProjectVersionRecord(stored)
      if (
        version.projectId !== authority.projectId ||
        (authority.branchId !== undefined && version.branchId !== authority.branchId) ||
        (authority.versionId !== undefined && version.versionId !== authority.versionId)
      ) {
        throw validationFailure('project-version-authority-mismatch')
      }
      const hash = await hashCanonicalJson(version.projectSchema, { crypto: this.#crypto })
      if (hash !== version.projectHash) throw validationFailure('project-version-project-hash-does-not-match')
      if (!jsonEqual(version.artifactRefs, collectCanonicalProjectArtifactIdentities(version.projectSchema))) {
        throw validationFailure('project-version-artifact-refs-do-not-match-project-schema')
      }
      return version
    } catch (error) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'stored-project-version-contract-is-invalid',
        { projectId: authority.projectId, branchId: authority.branchId ?? '' },
        { cause: error },
      )
    }
  }

  async #readProjectVersionNow(request) {
    const stored = await this.#backend.get('projectVersions', [request.projectId, request.branchId, request.versionId])
    return stored === undefined ? null : this.#normalizeStoredProjectVersion(stored, request)
  }

  async createProjectVersion(value) {
    this.#assertAccepting()
    const request = normalizeProjectVersionCreate(value)
    return this.#enqueue(scopeKey(request), () =>
      this.#withSnapshotLock(request, async () => {
        const existing = await this.#readProjectVersionNow(request)
        const current = await this.#readWorkingDraftNow(request)
        if (!current) throw validationFailure('project-version-create-requires-a-working-draft')
        if (existing) {
          const sameRequest =
            existing.creationBatchId === request.batchId &&
            existing.name === request.name &&
            existing.createdAt === request.createdAt &&
            jsonEqual(existing.artifactRefs, request.artifactRefs) &&
            existing.sourceSessionId === request.sourceSessionId &&
            existing.sourceTaskId === request.sourceTaskId &&
            existing.sourceCheckpointId === request.sourceCheckpointId
          if (sameRequest) {
            return Object.freeze({
              schemaVersion: 1,
              status: 'reconciled',
              version: structuredClone(existing),
              draft: structuredClone(current),
            })
          }
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
            'project-version-id-was-reused-with-different-bytes',
            { projectId: request.projectId, branchId: request.branchId, versionId: request.versionId },
          )
        }
        if (current.draftGeneration !== request.expectedDraftGeneration) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
            'project-version-create-generation-does-not-match',
            {
              projectId: request.projectId,
              branchId: request.branchId,
              expected: request.expectedDraftGeneration,
              actual: current.draftGeneration,
            },
          )
        }
        const artifactRefs = collectCanonicalProjectArtifactIdentities(current.projectSchema)
        if (!jsonEqual(request.artifactRefs, artifactRefs)) {
          throw validationFailure('project-version-create.artifactRefs-must-match-current-project-schema')
        }
        const version = validateProjectVersionRecord({
          schemaVersion: 1,
          projectId: request.projectId,
          branchId: request.branchId,
          versionId: request.versionId,
          name: request.name,
          createdAt: request.createdAt,
          creationBatchId: request.batchId,
          activeDocument: current.activeDocument,
          projectSchema: current.projectSchema,
          projectHash: current.projectHash,
          artifactRefs,
          sourceSessionId: request.sourceSessionId,
          sourceTaskId: request.sourceTaskId,
          sourceCheckpointId: request.sourceCheckpointId,
        })
        const result = await this.#commitLifecycleNow({
          ...request,
          updatedAt: request.createdAt,
          commitKind: 'named-version',
          operations: [
            { type: 'put', store: 'projectVersions', mode: 'add', value: version },
            ...collectCanonicalProjectArtifactClaims(version.projectSchema).map(ref => ({
              type: 'put',
              store: 'artifactRefs',
              mode: 'add',
              value: {
                schemaVersion: 1,
                projectId: request.projectId,
                branchId: request.branchId,
                ownerType: 'project-version',
                ownerId: request.versionId,
                ...ref,
              },
            })),
          ],
        })
        return Object.freeze({
          schemaVersion: 1,
          status: 'committed',
          version: structuredClone(version),
          draft: structuredClone(result.draft),
        })
      }),
    )
  }

  async getProjectVersion(value) {
    this.#assertAccepting()
    const request = normalizeProjectVersionRead(value)
    return this.#enqueue(scopeKey(request), () => this.#readProjectVersionNow(request))
  }

  async listProjectVersions(value) {
    this.#assertAccepting()
    const request = normalizeProjectList(value, 'project-version-list')
    const records = (await this.#backend.getAll('projectVersions')).filter(
      record => record?.projectId === request.projectId,
    )
    return Promise.all(records.map(record => this.#normalizeStoredProjectVersion(record, request))).then(versions =>
      versions.sort(compareVersion),
    )
  }

  async #listAgentSessionsNow(request) {
    const records = (await this.#backend.getAll('agentSessions')).filter(
      record => record?.projectId === request.projectId && record?.branchId === request.branchId,
    )
    try {
      return records
        .map(record =>
          normalizeStoredAgentSessionRecord(record, {
            projectId: request.projectId,
            branchId: request.branchId,
          }),
        )
        .sort(compareSession)
    } catch (error) {
      throw asIntegrityMismatch(request, 'stored-agent-session-contract-is-invalid', error)
    }
  }

  async saveAgentSession(value) {
    this.#assertAccepting()
    const request = normalizeAgentSessionSave(value)
    return this.#enqueue(scopeKey(request), () =>
      this.#withSnapshotLock(request, async () => {
        const currentDraft = await this.#readWorkingDraftNow(request)
        if (!currentDraft) throw validationFailure('agent-session-save-requires-a-working-draft')
        const sessions = await this.#listAgentSessionsNow(request)
        const existing = sessions.find(session => session.sessionId === request.sessionId) ?? null
        const isPlaceholder = existing?.createdAt === 0 && existing.updatedAt === 0 && existing.forkedFrom === null
        if (existing) {
          if (
            (!isPlaceholder && existing.createdAt !== request.createdAt) ||
            (!isPlaceholder && !jsonEqual(existing.forkedFrom, request.forkedFrom))
          ) {
            throw new DashboardStorageError(
              DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
              'agent-session-id-was-reused-with-different-origin',
              { projectId: request.projectId, branchId: request.branchId, sessionId: request.sessionId },
            )
          }
          if (existing.status === 'closed' && request.status !== 'closed') {
            throw validationFailure('closed-agent-session-cannot-be-reopened')
          }
          if (request.updatedAt < existing.updatedAt) {
            throw new DashboardStorageError(
              DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
              'agent-session-update-is-stale',
              { projectId: request.projectId, branchId: request.branchId, sessionId: request.sessionId },
            )
          }
        }
        const target = validateAgentSessionRecord({
          schemaVersion: 1,
          projectId: request.projectId,
          branchId: request.branchId,
          sessionId: request.sessionId,
          status: request.status,
          persistenceGeneration: existing?.persistenceGeneration ?? 0,
          createdAt: isPlaceholder ? request.createdAt : (existing?.createdAt ?? request.createdAt),
          updatedAt: request.updatedAt,
          closedAt: request.status === 'closed' ? request.updatedAt : null,
          forkedFrom: isPlaceholder ? request.forkedFrom : (existing?.forkedFrom ?? request.forkedFrom),
        })
        const demotions =
          target.status === 'active'
            ? sessions
                .filter(session => session.sessionId !== target.sessionId && session.status === 'active')
                .map(session =>
                  validateAgentSessionRecord({
                    ...session,
                    status: 'idle',
                    updatedAt: Math.max(session.updatedAt, request.updatedAt),
                    closedAt: null,
                  }),
                )
            : []
        if (existing && jsonEqual(existing, target) && demotions.length === 0) {
          return Object.freeze({
            schemaVersion: 1,
            status: 'reconciled',
            session: structuredClone(existing),
            draft: structuredClone(currentDraft),
          })
        }
        const result = await this.#commitLifecycleNow({
          ...request,
          commitKind: 'session-lifecycle',
          operations: [...demotions, target].map(session => ({
            type: 'put',
            store: 'agentSessions',
            value: session,
          })),
        })
        return Object.freeze({
          schemaVersion: 1,
          status: 'committed',
          session: structuredClone(target),
          draft: structuredClone(result.draft),
        })
      }),
    )
  }

  async listAgentSessions(value) {
    this.#assertAccepting()
    const request = normalizeAgentSessionScope(value)
    return this.#enqueue(scopeKey(request), () => this.#listAgentSessionsNow(request))
  }

  async resolveAgentSession(value) {
    this.#assertAccepting()
    const request = normalizeAgentSessionScope(value)
    return this.#enqueue(scopeKey(request), async () => {
      const sessions = await this.#listAgentSessionsNow(request)
      const candidates = sessions
        .filter(session => session.status !== 'closed')
        .sort(
          (left, right) =>
            Number(right.status === 'active') - Number(left.status === 'active') ||
            right.updatedAt - left.updatedAt ||
            compareText(right.sessionId, left.sessionId),
        )
      return candidates.length === 0 ? null : structuredClone(candidates[0])
    })
  }

  async restoreProjectVersion(value) {
    this.#assertAccepting()
    const request = normalizeProjectVersionRestore(value)
    const targetScope = { projectId: request.projectId, branchId: request.targetBranchId }
    return this.#enqueue(scopeKey(targetScope), () =>
      this.#withSnapshotLock(targetScope, async () => {
        const version = await this.#readProjectVersionNow({
          projectId: request.projectId,
          branchId: request.sourceBranchId,
          versionId: request.versionId,
        })
        if (!version) throw validationFailure('project-version-restore-source-does-not-exist')
        if (
          version.sourceSessionId !== request.forkedFromSessionId ||
          version.sourceTaskId !== request.forkedFromTaskId
        ) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
            'project-version-restore-source-lineage-mismatch',
            { projectId: request.projectId, branchId: request.sourceBranchId },
          )
        }
        const forkedFrom = {
          sessionId: request.forkedFromSessionId,
          taskId: request.forkedFromTaskId,
          versionId: request.versionId,
        }
        const expectedSession = validateAgentSessionRecord({
          schemaVersion: 1,
          projectId: request.projectId,
          branchId: request.targetBranchId,
          sessionId: request.targetSessionId,
          status: 'active',
          persistenceGeneration: 0,
          createdAt: request.restoredAt,
          updatedAt: request.restoredAt,
          closedAt: null,
          forkedFrom,
        })
        const current = await this.#readWorkingDraftNow(targetScope)
        if (current) {
          const storedSession = await this.#backend.get('agentSessions', [
            request.projectId,
            request.targetBranchId,
            request.targetSessionId,
          ])
          let session
          try {
            session = normalizeStoredAgentSessionRecord(storedSession, expectedSession)
          } catch (error) {
            throw asIntegrityMismatch(targetScope, 'restored-agent-session-contract-is-invalid', error)
          }
          if (
            current.commitKind !== 'version-restore' ||
            current.draftGeneration !== 1 ||
            current.projectHash !== version.projectHash ||
            !jsonEqual(current.projectSchema, version.projectSchema) ||
            !jsonEqual(current.activeDocument, version.activeDocument) ||
            !jsonEqual(session, expectedSession)
          ) {
            throw new DashboardStorageError(
              DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
              'project-version-restore-target-branch-already-diverged',
              { projectId: request.projectId, branchId: request.targetBranchId },
            )
          }
          return Object.freeze({
            schemaVersion: 1,
            status: 'reconciled',
            version: structuredClone(version),
            session: structuredClone(session),
            draft: structuredClone(current),
          })
        }
        if (
          (await this.#backend.get('agentSessions', [
            request.projectId,
            request.targetBranchId,
            request.targetSessionId,
          ])) !== undefined
        ) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
            'project-version-restore-target-session-exists-without-a-draft',
            { projectId: request.projectId, branchId: request.targetBranchId },
          )
        }
        this.#assertOrdinaryCommitAuthority(targetScope)
        const result = await this.#commitNow(
          normalizeCommitRequest({
            schemaVersion: 1,
            batchId: request.batchId,
            projectId: request.projectId,
            branchId: request.targetBranchId,
            expectedDraftGeneration: 0,
            activeDocument: version.activeDocument,
            projectSchema: version.projectSchema,
            commitKind: 'version-restore',
            updatedAt: request.restoredAt,
            operations: [{ type: 'put', store: 'agentSessions', mode: 'add', value: expectedSession }],
          }),
          version.projectHash,
        )
        return Object.freeze({
          schemaVersion: 1,
          status: 'committed',
          version: structuredClone(version),
          session: structuredClone(expectedSession),
          draft: structuredClone(result.draft),
        })
      }),
    )
  }

  async #readLocalGrantNow(request) {
    const stored = await this.#backend.get('grants', [
      request.userId,
      request.projectId,
      request.scope,
      request.policyVersion,
    ])
    if (stored === undefined) return null
    try {
      const grant = validateLocalGrantRecord(stored)
      if (
        grant.userId !== request.userId ||
        grant.projectId !== request.projectId ||
        grant.scope !== request.scope ||
        grant.policyVersion !== request.policyVersion
      ) {
        throw validationFailure('local-grant-authority-mismatch')
      }
      return grant
    } catch (error) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'stored-local-grant-contract-is-invalid',
        { projectId: request.projectId },
        { cause: error },
      )
    }
  }

  async authorizeLocalGrant(value) {
    this.#assertAccepting()
    const request = normalizeLocalGrantAuthorize(value)
    return this.#enqueue(scopeKey(request), () =>
      this.#withSnapshotLock(request, async () => {
        const existing = await this.#readLocalGrantNow(request)
        const current = await this.#readWorkingDraftNow(request)
        if (!current) throw validationFailure('local-grant-authorize-requires-a-working-draft')
        const grant = validateLocalGrantRecord({
          schemaVersion: 1,
          userId: request.userId,
          projectId: request.projectId,
          scope: request.scope,
          policyVersion: request.policyVersion,
          providerId: request.providerId,
          providerFingerprint: request.providerFingerprint,
          status: 'granted',
          grantedAt: request.grantedAt,
          updatedAt: request.updatedAt,
          revokedAt: null,
        })
        if (existing && jsonEqual(existing, grant)) {
          return Object.freeze({
            schemaVersion: 1,
            status: 'reconciled',
            grant: structuredClone(existing),
            draft: structuredClone(current),
          })
        }
        if (existing && request.updatedAt < existing.updatedAt) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
            'local-grant-authorization-is-stale',
            { projectId: request.projectId },
          )
        }
        const result = await this.#commitLifecycleNow({
          ...request,
          commitKind: 'local-grant',
          operations: [{ type: 'put', store: 'grants', value: grant }],
        })
        return Object.freeze({
          schemaVersion: 1,
          status: 'committed',
          grant: structuredClone(grant),
          draft: structuredClone(result.draft),
        })
      }),
    )
  }

  async checkLocalGrant(value) {
    this.#assertAccepting()
    const request = normalizeLocalGrantCheck(value)
    const grant = await this.#readLocalGrantNow(request)
    if (!grant) {
      const policyChanged = (await this.#backend.getAll('grants')).some(
        candidate =>
          candidate?.userId === request.userId &&
          candidate?.projectId === request.projectId &&
          candidate?.scope === request.scope &&
          candidate?.policyVersion !== request.policyVersion,
      )
      return Object.freeze({
        schemaVersion: 1,
        granted: false,
        reason: policyChanged ? 'policy-version-changed' : 'missing',
        grant: null,
      })
    }
    let reason = 'granted'
    if (grant.status === 'revoked') reason = 'revoked'
    else if (grant.providerId !== request.providerId) reason = 'provider-changed'
    else if (grant.providerFingerprint !== request.providerFingerprint) reason = 'provider-fingerprint-changed'
    return Object.freeze({
      schemaVersion: 1,
      granted: reason === 'granted',
      reason,
      grant: structuredClone(grant),
    })
  }

  async revokeLocalGrant(value) {
    this.#assertAccepting()
    const request = normalizeLocalGrantRevoke(value)
    return this.#enqueue(scopeKey(request), () =>
      this.#withSnapshotLock(request, async () => {
        const existing = await this.#readLocalGrantNow(request)
        const current = await this.#readWorkingDraftNow(request)
        if (!current) throw validationFailure('local-grant-revoke-requires-a-working-draft')
        if (!existing) {
          return Object.freeze({
            schemaVersion: 1,
            status: 'reconciled',
            grant: null,
            draft: structuredClone(current),
          })
        }
        if (existing.status === 'revoked' && existing.revokedAt === request.revokedAt) {
          return Object.freeze({
            schemaVersion: 1,
            status: 'reconciled',
            grant: structuredClone(existing),
            draft: structuredClone(current),
          })
        }
        if (request.revokedAt < existing.updatedAt) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
            'local-grant-revocation-is-stale',
            { projectId: request.projectId },
          )
        }
        const grant = validateLocalGrantRecord({
          ...existing,
          status: 'revoked',
          updatedAt: request.revokedAt,
          revokedAt: request.revokedAt,
        })
        const result = await this.#commitLifecycleNow({
          ...request,
          updatedAt: request.revokedAt,
          commitKind: 'local-grant',
          operations: [{ type: 'put', store: 'grants', value: grant }],
        })
        return Object.freeze({
          schemaVersion: 1,
          status: 'committed',
          grant: structuredClone(grant),
          draft: structuredClone(result.draft),
        })
      }),
    )
  }

  async listLocalGrants(value) {
    this.#assertAccepting()
    const request = normalizeLocalGrantList(value)
    const records = (await this.#backend.getAll('grants')).filter(
      record => record?.userId === request.userId && record?.projectId === request.projectId,
    )
    try {
      return records.map(validateLocalGrantRecord).sort(compareGrant)
    } catch (error) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'stored-local-grant-contract-is-invalid',
        { projectId: request.projectId },
        { cause: error },
      )
    }
  }

  async createArtifact(value) {
    this.#assertAccepting()
    const artifact = validateArtifactRecord(value)
    if (typeof this.#backend.createArtifact !== 'function') {
      throw validationFailure('storage-backend-artifact-create-seam-is-required')
    }
    return this.#enqueue(artifactProjectScopeKey(artifact.projectId), async () =>
      validateArtifactCreateResult(await this.#backend.createArtifact(artifact), artifact),
    )
  }

  async readArtifact(value) {
    this.#assertAccepting()
    const request = validateArtifactReadRequest(value)
    if (typeof this.#backend.readArtifact !== 'function') {
      throw validationFailure('storage-backend-artifact-read-seam-is-required')
    }
    return this.#enqueue(artifactProjectScopeKey(request.projectId), async () => {
      const stored = await this.#backend.readArtifact(request)
      if (stored === null) return null
      try {
        const artifact = validateArtifactRecord(stored)
        if (
          artifact.projectId !== request.projectId ||
          artifact.artifactId !== request.artifactId ||
          artifact.sourceRevision !== request.sourceRevision
        ) {
          throw validationFailure('stored-artifact-authority-mismatch')
        }
        return cloneFrozenJson(artifact)
      } catch (error) {
        throw new DashboardStorageError(
          DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
          'stored-artifact-contract-is-invalid',
          { projectId: request.projectId, artifactId: request.artifactId, sourceRevision: request.sourceRevision },
          { cause: error },
        )
      }
    })
  }

  async createArtifactRoot(value) {
    this.#assertAccepting()
    const root = validateArtifactRootRecord(value)
    if (root.ownerType === 'working-draft') {
      throw validationFailure('working-draft-artifact-roots-are-coordinator-controlled')
    }
    if (typeof this.#backend.createArtifactRoot !== 'function') {
      throw validationFailure('storage-backend-artifact-root-create-seam-is-required')
    }
    return this.#enqueue(scopeKey(root), () =>
      this.#withProjectMaterialLock(root.projectId, 'shared', async () =>
        validateArtifactRootMutationResult(
          await this.#backend.createArtifactRoot(root),
          root,
          ['created', 'reconciled'],
          'storage-backend-artifact-root-create-result-is-invalid',
        ),
      ),
    )
  }

  async readArtifactRoot(value) {
    this.#assertAccepting()
    const request = validateArtifactRootReadRequest(value)
    if (typeof this.#backend.readArtifactRoot !== 'function') {
      throw validationFailure('storage-backend-artifact-root-read-seam-is-required')
    }
    return this.#enqueue(scopeKey(request), async () => {
      const stored = await this.#backend.readArtifactRoot(request)
      if (stored === null) return null
      try {
        const root = validateArtifactRootRecord(stored)
        if (!jsonEqual(root, request)) throw validationFailure('stored-artifact-root-authority-mismatch')
        return cloneFrozenJson(root)
      } catch (error) {
        throw new DashboardStorageError(
          DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
          'stored-artifact-root-contract-is-invalid',
          { projectId: request.projectId, branchId: request.branchId },
          { cause: error },
        )
      }
    })
  }

  async deleteArtifactRoot(value) {
    this.#assertAccepting()
    const root = validateArtifactRootReadRequest(value)
    if (root.ownerType === 'working-draft') {
      throw validationFailure('working-draft-artifact-roots-are-coordinator-controlled')
    }
    if (typeof this.#backend.deleteArtifactRoot !== 'function') {
      throw validationFailure('storage-backend-artifact-root-delete-seam-is-required')
    }
    return this.#enqueue(scopeKey(root), () =>
      this.#withProjectMaterialLock(root.projectId, 'shared', async () =>
        validateArtifactRootMutationResult(
          await this.#backend.deleteArtifactRoot(root),
          root,
          ['deleted', 'absent'],
          'storage-backend-artifact-root-delete-result-is-invalid',
        ),
      ),
    )
  }

  async #readArtifactRootSnapshotNow(projectId) {
    const draftsBefore = await this.#backend.getAll('workingDrafts')
    const generationFence = draftFenceFromRecords(draftsBefore, projectId)
    for (const entry of generationFence) {
      await this.#readWorkingDraftNow({ projectId, branchId: entry.branchId })
    }
    const [storedRoots, storedArtifacts, draftsAfter] = await Promise.all([
      this.#backend.getAll('artifactRefs'),
      this.#backend.getAll('artifacts'),
      this.#backend.getAll('workingDrafts'),
    ])
    const finalFence = draftFenceFromRecords(draftsAfter, projectId)
    if (!jsonEqual(generationFence, finalFence)) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
        'artifact-root-generation-changed-during-enumeration',
        { projectId },
      )
    }
    let roots
    let artifacts
    try {
      roots = storedRoots
        .filter(record => record?.projectId === projectId)
        .map(normalizeArtifactRootRecord)
        .sort(compareRoot)
      artifacts = storedArtifacts
        .filter(record => record?.projectId === projectId)
        .map(normalizeStoredArtifactIdentity)
        .sort(compareArtifactIdentity)
    } catch (error) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'stored-artifact-root-contract-is-invalid',
        { projectId },
        { cause: error },
      )
    }
    return { generationFence, roots, artifacts }
  }

  async #readMaterialGcSnapshotNow(projectId) {
    if (typeof this.#backend.readMaterialGcStoreSnapshot !== 'function') {
      throw validationFailure('storage-backend-material-gc-snapshot-seam-is-required')
    }
    let rawSnapshot
    try {
      rawSnapshot = validateMaterialGcStoreSnapshot(
        await this.#backend.readMaterialGcStoreSnapshot(projectId),
        projectId,
      )
    } catch (error) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'stored-material-gc-snapshot-contract-is-invalid',
        { projectId },
        { cause: error },
      )
    }

    try {
      const drafts = await Promise.all(
        rawSnapshot.stores.workingDrafts.map(record =>
          this.#normalizeStoredWorkingDraft(record, {
            projectId,
            branchId: requireAuthority(record.branchId, 'material-gc-working-draft.branchId'),
          }),
        ),
      )
      const versions = await Promise.all(
        rawSnapshot.stores.projectVersions.map(record => this.#normalizeStoredProjectVersion(record, { projectId })),
      )
      const sessions = rawSnapshot.stores.agentSessions.map(record =>
        normalizeStoredAgentSessionRecord(record, { projectId }),
      )
      const sessionsByKey = new Map(sessions.map(session => [`${session.branchId}\u0000${session.sessionId}`, session]))
      const sessionKeys = new Set(sessionsByKey.keys())
      const materialRefs = new Map()
      for (const projectSchema of [
        ...drafts.map(draft => draft.projectSchema),
        ...versions.map(version => version.projectSchema),
      ]) {
        for (const claim of collectCanonicalProjectArtifactClaims(projectSchema)) {
          for (const materialRef of claim.materialRefs) {
            addMaterialRef(materialRefs, materialRef, 'material-gc-project-schema.materialRefs')
          }
        }
      }

      const unresolvedPromotionIds = new Set()
      const resolvedPromotionIds = new Set()
      const promotionJournals = []
      const promotionIntents = new Map()
      const toolReceipts = new Map()
      const promotionCheckpoints = new Map()
      for (const record of rawSnapshot.stores.taskJournals) {
        assertExactFieldsWithOptional(
          record,
          ['branchId', 'kind', 'projectId', 'recordId', 'schemaVersion', 'sessionId', 'value'],
          ['callId', 'draftGeneration', 'taskId', 'updatedAt', 'writerCheckpointId'],
          'material-gc-task-journal',
        )
        if (record.schemaVersion !== 1 || record.projectId !== projectId) {
          throw validationFailure('material-gc-task-journal-authority-mismatch')
        }
        const branchId = requireAuthority(record.branchId, 'material-gc-task-journal.branchId')
        const sessionId = requireAuthority(record.sessionId, 'material-gc-task-journal.sessionId')
        requireAuthority(record.recordId, 'material-gc-task-journal.recordId')
        requireAuthority(record.kind, 'material-gc-task-journal.kind')
        if (!sessionKeys.has(`${branchId}\u0000${sessionId}`)) {
          throw validationFailure('material-gc-task-journal-session-authority-is-missing')
        }
        if (record.kind === 'local-material-promotion') {
          const journal = await validateMaterialGcPromotionJournal(record, projectId, this.#crypto)
          promotionJournals.push(journal)
          unresolvedPromotionIds.add(journal.value.promotionId)
        }
      }
      for (const record of rawSnapshot.stores.receiptIntents) {
        const { intent, promotion } = validateMaterialGcReceiptIntent(record, projectId)
        if (!promotion) continue
        const key = promotionLineageKey(intent)
        if (promotionIntents.has(key)) throw validationFailure('material-gc-promotion-intent-authority-is-duplicated')
        promotionIntents.set(key, intent)
        unresolvedPromotionIds.add(promotion.promotionId)
      }
      for (const record of rawSnapshot.stores.toolReceipts) {
        const receipt = validateMaterialGcToolReceipt(record, projectId)
        const key = promotionLineageKey(receipt)
        if (toolReceipts.has(key)) throw validationFailure('material-gc-tool-receipt-authority-is-duplicated')
        toolReceipts.set(key, receipt)
      }
      for (const record of rawSnapshot.stores.agentCheckpoints) {
        const { checkpoint, promotion, sessionRequired } = validateMaterialGcCheckpoint(record, projectId)
        const session = sessionsByKey.get(`${record.branchId}\u0000${record.sessionId}`)
        if (sessionRequired && !session) {
          throw validationFailure('material-gc-checkpoint-session-authority-is-missing')
        }
        if (
          Object.hasOwn(checkpoint, 'requestHash') &&
          session &&
          checkpoint.result.persistenceGeneration > session.persistenceGeneration
        ) {
          throw validationFailure('material-gc-persistence-checkpoint-generation-is-ahead-of-session')
        }
        if (!promotion) continue
        const key = promotionCheckpointKey(checkpoint)
        if (promotionCheckpoints.has(key)) {
          throw validationFailure('material-gc-promotion-checkpoint-authority-is-duplicated')
        }
        promotionCheckpoints.set(key, checkpoint)
        unresolvedPromotionIds.add(promotion.promotionId)
      }
      for (const journal of promotionJournals) {
        if (journal.value.stage !== 'committed' && journal.value.stage !== 'failed') continue
        const terminal = await validateMaterialGcTerminalPromotion({
          journal,
          intent: promotionIntents.get(promotionLineageKey(journal)),
          receipt: toolReceipts.get(promotionLineageKey(journal)),
          checkpoint: promotionCheckpoints.get(promotionCheckpointKey(journal)),
          crypto: this.#crypto,
        })
        addMaterialRef(materialRefs, terminal.materialRef, 'material-gc-promotion-journal.materialRefs')
        resolvedPromotionIds.add(terminal.promotionId)
      }

      const roots = rawSnapshot.stores.artifactRefs
        .map(record => {
          const stored = validateArtifactRootRecord(record)
          if (stored.projectId !== projectId) throw validationFailure('material-gc-artifact-root-authority-mismatch')
          const root = normalizeArtifactRootRecord(stored)
          for (const materialRef of root.materialRefs) {
            addMaterialRef(materialRefs, materialRef, 'material-gc-artifact-root.materialRefs')
          }
          return root
        })
        .sort(compareRoot)

      for (const promotionId of resolvedPromotionIds) unresolvedPromotionIds.delete(promotionId)
      const generationFence = drafts
        .map(draft => ({ branchId: draft.branchId, draftGeneration: draft.draftGeneration }))
        .sort((left, right) => compareText(left.branchId, right.branchId))
      const sessionGenerationFence = sessions
        .map(session => ({
          branchId: session.branchId,
          sessionId: session.sessionId,
          persistenceGeneration: session.persistenceGeneration,
        }))
        .sort((left, right) =>
          compareText(`${left.branchId}\u0000${left.sessionId}`, `${right.branchId}\u0000${right.sessionId}`),
        )
      const rootFence = artifactRootFenceFromRecords(roots)
      const storeFence = await Promise.all(
        DASHBOARD_MATERIAL_GC_STORE_NAMES.map(async store => {
          const records = [...rawSnapshot.stores[store]].sort(compareCanonical)
          return {
            store,
            recordCount: records.length,
            digest: await hashCanonicalJson(records, { crypto: this.#crypto }),
          }
        }),
      )
      const snapshot = {
        schemaVersion: 1,
        projectId,
        generationFence,
        sessionGenerationFence,
        rootFence,
        storeFence,
        materialRefs: [...materialRefs.values()].sort(compareCanonical),
        unresolvedPromotionIds: [...unresolvedPromotionIds].sort(compareText),
      }
      return cloneFrozenJson({
        ...snapshot,
        snapshotDigest: await hashCanonicalJson(snapshot, { crypto: this.#crypto }),
      })
    } catch (error) {
      if (error instanceof DashboardStorageError && error.code === DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch) {
        throw error
      }
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'stored-material-gc-authority-is-invalid',
        { projectId },
        { cause: error },
      )
    }
  }

  async readMaterialGcSnapshot(value) {
    this.#assertAccepting()
    const request = normalizeProjectList(value, 'material-gc-snapshot')
    await this.flush()
    return this.#enqueue(artifactProjectScopeKey(request.projectId), () =>
      this.#withProjectMaterialLock(request.projectId, 'shared', () =>
        this.#readMaterialGcSnapshotNow(request.projectId),
      ),
    )
  }

  async withMaterialGcFence(value, operation) {
    this.#assertAccepting()
    const request = normalizeProjectList(value, 'material-gc-fence')
    if (typeof operation !== 'function') {
      throw validationFailure('material-gc-fence-operation-must-be-a-function')
    }
    await this.flush()
    return this.#enqueue(artifactProjectScopeKey(request.projectId), () =>
      this.#withProjectMaterialLock(request.projectId, 'exclusive', async () => {
        let active = true
        const startedSnapshots = []
        const context = Object.freeze({
          projectId: request.projectId,
          readSnapshot: () => {
            if (!active) return Promise.reject(validationFailure('material-gc-fence-context-is-no-longer-active'))
            const task = Promise.resolve().then(() => this.#readMaterialGcSnapshotNow(request.projectId))
            const tracked = { task, observed: false }
            startedSnapshots.push(tracked)
            const exposed = createTrackedMaterialGcSnapshotPromise(task, () => {
              tracked.observed = true
            })
            // The fence owns every started read even when the callback drops the returned Promise.
            task.catch(() => undefined)
            return exposed
          },
        })
        let result
        let operationError
        let operationFailed = false
        try {
          result = await operation(context)
        } catch (error) {
          operationFailed = true
          operationError = error
        } finally {
          active = false
        }
        const snapshotResults = await Promise.allSettled(startedSnapshots.map(entry => entry.task))
        const snapshotFailures = snapshotResults.flatMap((entry, index) =>
          entry.status === 'rejected' ? [{ error: entry.reason, observed: startedSnapshots[index].observed }] : [],
        )
        const observedOperationFailureIndex = operationFailed
          ? snapshotFailures.findIndex(entry => entry.observed && entry.error === operationError)
          : -1
        const independentSnapshotErrors = snapshotFailures
          .filter((_entry, index) => index !== observedOperationFailureIndex)
          .map(entry => entry.error)
        if (operationFailed && independentSnapshotErrors.length > 0) {
          throw new AggregateError(
            [operationError, ...independentSnapshotErrors],
            'material-gc-fence-operation-and-snapshot-validation-failed',
          )
        }
        if (operationFailed) throw operationError
        const snapshotErrors = snapshotFailures.map(entry => entry.error)
        if (snapshotErrors.length === 1) throw snapshotErrors[0]
        if (snapshotErrors.length > 1) {
          throw new AggregateError(snapshotErrors, 'material-gc-fence-snapshot-validation-failed')
        }
        return result
      }),
    )
  }

  async enumerateArtifactRoots(value) {
    this.#assertAccepting()
    const request = normalizeProjectList(value, 'artifact-root-enumeration')
    await this.flush()
    const snapshot = await this.#readArtifactRootSnapshotNow(request.projectId)
    return Object.freeze({
      schemaVersion: 1,
      projectId: request.projectId,
      generationFence: structuredClone(snapshot.generationFence),
      roots: structuredClone(snapshot.roots),
    })
  }

  async planArtifactGcDryRun(value) {
    this.#assertAccepting()
    const request = normalizeProjectList(value, 'artifact-gc-dry-run')
    await this.flush()
    const snapshot = await this.#readArtifactRootSnapshotNow(request.projectId)
    const retainedByKey = new Map()
    for (const root of snapshot.roots) {
      const key = canonicalJsonStringify([root.artifactId, root.sourceRevision])
      const current = retainedByKey.get(key)
      retainedByKey.set(key, {
        artifactId: root.artifactId,
        sourceRevision: root.sourceRevision,
        referenceCount: (current?.referenceCount ?? 0) + 1,
      })
    }
    const retainedArtifacts = [...retainedByKey.values()].sort(compareArtifactIdentity)
    const storedKeys = new Set(
      snapshot.artifacts.map(artifact => canonicalJsonStringify([artifact.artifactId, artifact.sourceRevision])),
    )
    const retainedKeys = new Set(retainedByKey.keys())
    const missingArtifacts = retainedArtifacts.filter(
      artifact => !storedKeys.has(canonicalJsonStringify([artifact.artifactId, artifact.sourceRevision])),
    )
    const deletionCandidates = snapshot.artifacts.filter(
      artifact => !retainedKeys.has(canonicalJsonStringify([artifact.artifactId, artifact.sourceRevision])),
    )
    const artifactIdentityFence = structuredClone(snapshot.artifacts)
    const rootFence = artifactRootFenceFromRecords(snapshot.roots)
    return cloneFrozenJson({
      schemaVersion: 1,
      projectId: request.projectId,
      dryRun: true,
      generationFence: snapshot.generationFence,
      artifactIdentityFence,
      rootFence,
      roots: snapshot.roots,
      retainedArtifacts,
      missingArtifacts,
      deletionCandidates,
    })
  }

  async sweepArtifactGc(value) {
    this.#assertAccepting()
    assertExactFields(
      value,
      [
        'artifactIdentityFence',
        'deletionCandidates',
        'dryRun',
        'generationFence',
        'missingArtifacts',
        'projectId',
        'retainedArtifacts',
        'rootFence',
        'roots',
        'schemaVersion',
      ],
      'artifact-gc-plan',
    )
    if (value.dryRun !== true) throw validationFailure('artifact-gc-sweep-requires-a-dry-run-plan')
    for (const field of ['roots', 'retainedArtifacts', 'missingArtifacts']) {
      if (!Array.isArray(value[field])) throw validationFailure(`artifact-gc-plan.${field}-must-be-an-array`)
    }
    const request = validateArtifactSweepRequest({
      schemaVersion: value.schemaVersion,
      projectId: value.projectId,
      generationFence: value.generationFence,
      artifactIdentityFence: value.artifactIdentityFence,
      rootFence: value.rootFence,
      deletionCandidates: value.deletionCandidates,
    })
    if (typeof this.#backend.sweepArtifacts !== 'function') {
      throw validationFailure('storage-backend-artifact-gc-sweep-seam-is-required')
    }
    await this.flush()
    const result = await this.#backend.sweepArtifacts(request)
    try {
      assertExactFields(result, ['deletedArtifacts', 'projectId', 'schemaVersion', 'status'], 'artifact-gc-result')
      if (
        result.schemaVersion !== 1 ||
        result.status !== 'committed' ||
        result.projectId !== request.projectId ||
        !jsonEqual(result.deletedArtifacts, request.deletionCandidates)
      ) {
        throw validationFailure('artifact-gc-result-authority-mismatch')
      }
    } catch (error) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'storage-backend-artifact-gc-result-is-invalid',
        { projectId: request.projectId },
        { cause: error },
      )
    }
    return cloneFrozenJson({
      schemaVersion: 1,
      projectId: request.projectId,
      dryRun: false,
      generationFence: request.generationFence,
      artifactIdentityFence: request.artifactIdentityFence,
      rootFence: request.rootFence,
      roots: value.roots,
      retainedArtifacts: value.retainedArtifacts,
      missingArtifacts: value.missingArtifacts,
      deletionCandidates: request.deletionCandidates,
      deletedArtifacts: result.deletedArtifacts,
    })
  }

  async recordReceiptIntent(value) {
    this.#assertAccepting()
    const intent = validateReceiptIntentRecord(value)
    if (typeof this.#backend.putReceiptIntent !== 'function') {
      throw validationFailure('storage-backend-receipt-intent-seam-is-required')
    }
    return this.#enqueue(scopeKey(intent), () =>
      this.#withProjectMaterialLock(intent.projectId, 'shared', () => this.#backend.putReceiptIntent(intent)),
    )
  }

  async readReceiptLineage(value) {
    this.#assertAccepting()
    const request = validateReceiptLineageReadRequest(value)
    if (typeof this.#backend.readReceiptLineage !== 'function') {
      throw validationFailure('storage-backend-receipt-lineage-seam-is-required')
    }
    return this.#enqueue(scopeKey(request), () => this.#backend.readReceiptLineage(request))
  }

  async #readCompensationJournalRecordNow(request, recordId, kind) {
    const stored = await this.#backend.get('taskJournals', [
      request.projectId,
      request.branchId,
      request.sessionId,
      recordId,
    ])
    if (stored === undefined) return null
    try {
      canonicalJsonStringify(stored)
      assertExactFieldsWithOptional(
        stored,
        compensationJournalRecordFields,
        compensationJournalRecordOptionalFields,
        'compensation-journal-record',
      )
      if (
        stored.schemaVersion !== 1 ||
        stored.projectId !== request.projectId ||
        stored.branchId !== request.branchId ||
        stored.sessionId !== request.sessionId ||
        stored.recordId !== recordId ||
        stored.kind !== kind ||
        typeof stored.callId !== 'string' ||
        stored.callId.length === 0 ||
        !Number.isSafeInteger(stored.draftGeneration) ||
        stored.draftGeneration < 1 ||
        !Number.isSafeInteger(stored.updatedAt) ||
        stored.updatedAt < 0 ||
        (stored.writerCheckpointId !== null &&
          stored.writerCheckpointId !== undefined &&
          (typeof stored.writerCheckpointId !== 'string' || stored.writerCheckpointId.length === 0))
      ) {
        throw validationFailure('compensation-journal-record-authority-mismatch')
      }
      assertRecord(stored.value, 'compensation-journal-record.value')
      return structuredClone(stored)
    } catch (error) {
      throw asIntegrityMismatch(request, 'stored-compensation-journal-contract-is-invalid', error)
    }
  }

  async #readCompensationJournalNow(request, recordId, kind) {
    const stored = await this.#readCompensationJournalRecordNow(request, recordId, kind)
    if (stored === null) return null
    try {
      if (kind === 'compensation-run') {
        if (
          stored.value.outerCallId !== request.outerCallId ||
          stored.value.sessionId !== request.sessionId ||
          (request.targetTaskId !== undefined && stored.value.taskId !== request.targetTaskId)
        ) {
          throw validationFailure('compensation-run-authority-mismatch')
        }
        await validateCompensationRunWriter(this.#backend, request, stored)
      } else if (stored.callId !== request.outerCallId) {
        throw validationFailure('compensation-journal-record-authority-mismatch')
      } else if (stored.writerCheckpointId !== null && stored.writerCheckpointId !== undefined) {
        throw validationFailure('compensation-claim-writer-checkpoint-must-be-null')
      }
      return structuredClone(stored.value)
    } catch (error) {
      throw asIntegrityMismatch(request, 'stored-compensation-journal-contract-is-invalid', error)
    }
  }

  async readCompensationRun(value) {
    this.#assertAccepting()
    const request = validateCompensationRunReadRequest(value)
    return this.#enqueue(scopeKey(request), () =>
      this.#readCompensationJournalNow(request, compensationRunRecordId(request.outerCallId), 'compensation-run'),
    )
  }

  async listCompensationRuns(value) {
    this.#assertAccepting()
    const request = validateCompensationRunListRequest(value)
    return this.#enqueue(scopeKey(request), async () => {
      const storedRecords = await this.#backend.getAll('taskJournals')
      const runs = []
      for (const stored of storedRecords) {
        try {
          canonicalJsonStringify(stored)
          if (
            typeof stored !== 'object' ||
            stored === null ||
            Array.isArray(stored) ||
            stored.projectId !== request.projectId ||
            stored.branchId !== request.branchId ||
            stored.sessionId !== request.sessionId
          ) {
            continue
          }
          const recordId = stored.recordId
          const compensationNamespace =
            stored.kind === 'compensation-run' ||
            (typeof recordId === 'string' && recordId.startsWith('compensation-run:'))
          if (!compensationNamespace) continue
          assertExactFieldsWithOptional(
            stored,
            compensationJournalRecordFields,
            compensationJournalRecordOptionalFields,
            'compensation-journal-record',
          )
          if (
            stored.schemaVersion !== 1 ||
            stored.kind !== 'compensation-run' ||
            typeof recordId !== 'string' ||
            !recordId.startsWith('compensation-run:') ||
            recordId.length === 'compensation-run:'.length ||
            typeof stored.callId !== 'string' ||
            stored.callId.length === 0 ||
            !Number.isSafeInteger(stored.draftGeneration) ||
            stored.draftGeneration < 1 ||
            !Number.isSafeInteger(stored.updatedAt) ||
            stored.updatedAt < 0 ||
            (stored.writerCheckpointId !== null &&
              stored.writerCheckpointId !== undefined &&
              (typeof stored.writerCheckpointId !== 'string' || stored.writerCheckpointId.length === 0))
          ) {
            throw validationFailure('compensation-journal-record-authority-mismatch')
          }
          const outerCallId = recordId.slice('compensation-run:'.length)
          assertRecord(stored.value, 'compensation-journal-record.value')
          if (stored.value.outerCallId !== outerCallId || stored.value.sessionId !== request.sessionId) {
            throw validationFailure('compensation-run-authority-mismatch')
          }
          await validateCompensationRunWriter(this.#backend, request, stored)
          runs.push({
            schemaVersion: 1,
            projectId: request.projectId,
            branchId: request.branchId,
            sessionId: request.sessionId,
            outerCallId,
            writerCallId: stored.callId,
            draftGeneration: stored.draftGeneration,
            updatedAt: stored.updatedAt,
            run: structuredClone(stored.value),
          })
        } catch (error) {
          throw asIntegrityMismatch(request, 'stored-compensation-journal-contract-is-invalid', error)
        }
      }
      return Object.freeze(
        runs
          .sort(
            (left, right) =>
              left.draftGeneration - right.draftGeneration ||
              (left.outerCallId < right.outerCallId ? -1 : left.outerCallId > right.outerCallId ? 1 : 0),
          )
          .map(run => Object.freeze(run)),
      )
    })
  }

  async readCompensationTargetClaim(value) {
    this.#assertAccepting()
    const request = validateCompensationTargetClaimReadRequest(value)
    const withOuterCall = outerCallId => ({ ...request, outerCallId })
    return this.#enqueue(scopeKey(request), async () => {
      const recordId = compensationTargetRecordId(request.targetTaskId)
      const stored = await this.#readCompensationJournalRecordNow(request, recordId, 'compensation-target-claim')
      if (stored === null) return null
      const outerCallId = requireAuthority(stored.callId, 'compensation-target-claim.callId')
      return validateCompensationClaimValue(stored.value, withOuterCall(outerCallId))
    })
  }

  async readMutationProvenance(value) {
    this.#assertAccepting()
    const request = validateMutationProvenanceReadRequest(value)
    return this.#enqueue(scopeKey(request), async () => {
      const records = []
      for (const slotKey of request.slotKeys) {
        const record = await this.#backend.get('mutationProvenance', [request.projectId, request.branchId, slotKey])
        if (record === undefined) {
          records.push(null)
          continue
        }
        try {
          canonicalJsonStringify(record)
          assertExactFields(record, mutationProvenanceRecordFields, 'mutation-provenance-record')
          if (
            record.schemaVersion !== 1 ||
            record.projectId !== request.projectId ||
            record.branchId !== request.branchId ||
            record.slotKey !== slotKey ||
            !Number.isSafeInteger(record.draftGeneration) ||
            record.draftGeneration < 0 ||
            typeof record.token !== 'string' ||
            record.token.length === 0
          ) {
            throw validationFailure('mutation-provenance-record-authority-mismatch')
          }
          records.push(structuredClone(record))
        } catch (error) {
          throw asIntegrityMismatch(request, 'stored-mutation-provenance-contract-is-invalid', error)
        }
      }
      return Object.freeze({ ...request, records: Object.freeze(records) })
    })
  }

  async commitCompensationRunState(value) {
    this.#assertAccepting()
    const request = validateCompensationRunStateCommit(value)
    return this.#enqueue(scopeKey(request), () =>
      this.#withSnapshotLock(request, async () => {
        this.#assertOrdinaryCommitAuthority(request)
        const currentDraft = await this.#readWorkingDraftNow(request)
        if (!currentDraft) throw validationFailure('compensation-run-state-requires-working-draft')
        if (currentDraft.draftGeneration !== request.expectedDraftGeneration) {
          throw new DashboardStorageError(
            DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
            'compensation-run-state-generation-does-not-match',
            {
              projectId: request.projectId,
              branchId: request.branchId,
              expected: request.expectedDraftGeneration,
              actual: currentDraft.draftGeneration,
            },
          )
        }

        const runRecordId = compensationRunRecordId(request.outerCallId)
        const claimRecordId = compensationTargetRecordId(request.targetTaskId)
        const existingRun = await this.#readCompensationJournalNow(request, runRecordId, 'compensation-run')
        const rawClaim = await this.#readCompensationJournalRecordNow(
          request,
          claimRecordId,
          'compensation-target-claim',
        )
        let existingClaim = null
        if (rawClaim !== null) {
          const claimOuterCallId = requireAuthority(rawClaim.callId, 'compensation-target-claim.callId')
          existingClaim = validateCompensationClaimValue(rawClaim.value, {
            ...request,
            outerCallId: claimOuterCallId,
          })
        }

        if (request.action === 'acquire') {
          if (existingClaim && existingClaim.outerCallId !== request.outerCallId) {
            throw validationFailure('compensation-target-is-already-claimed-by-another-call')
          }
          if (existingRun || existingClaim) {
            if (!existingRun || !existingClaim) {
              throw asIntegrityMismatch(request, 'compensation-run-and-claim-must-exist-together')
            }
            return Object.freeze({
              schemaVersion: 1,
              status: 'resumed',
              run: structuredClone(existingRun),
              draft: structuredClone(currentDraft),
            })
          }
        } else if (request.action === 'release') {
          if (!existingRun || !existingClaim || existingClaim.outerCallId !== request.outerCallId) {
            throw validationFailure('compensation-run-state-does-not-own-target-claim')
          }
        } else if (!existingRun) {
          throw validationFailure('compensation-run-state-does-not-have-a-run-to-retain')
        }

        const nextDraftGeneration = request.expectedDraftGeneration + 1
        const journalRecord = (recordId, kind, storedValue) => ({
          schemaVersion: 1,
          projectId: request.projectId,
          branchId: request.branchId,
          sessionId: request.sessionId,
          recordId,
          kind,
          callId: request.outerCallId,
          draftGeneration: nextDraftGeneration,
          updatedAt: request.updatedAt,
          writerCheckpointId: null,
          value: storedValue,
        })
        const operations = [
          {
            type: 'put',
            store: 'taskJournals',
            value: journalRecord(runRecordId, 'compensation-run', request.run),
          },
        ]
        if (request.action === 'acquire') {
          operations.push({
            type: 'put',
            store: 'taskJournals',
            mode: 'add',
            value: journalRecord(claimRecordId, 'compensation-target-claim', compensationClaimValue(request)),
          })
        } else if (request.action === 'retain' && existingClaim === null) {
          operations.push({
            type: 'put',
            store: 'taskJournals',
            mode: 'add',
            value: journalRecord(claimRecordId, 'compensation-target-claim', compensationClaimValue(request)),
          })
        } else if (request.action === 'release') {
          operations.push({
            type: 'delete',
            store: 'taskJournals',
            key: [request.projectId, request.branchId, request.sessionId, claimRecordId],
          })
        }
        const result = await this.#commitNow({
          schemaVersion: 1,
          batchId: `compensation-state-v1:${encodeURIComponent(request.projectId)}:${encodeURIComponent(
            request.branchId,
          )}:${encodeURIComponent(request.outerCallId)}:${request.action}:${request.expectedDraftGeneration}`,
          projectId: request.projectId,
          branchId: request.branchId,
          expectedDraftGeneration: request.expectedDraftGeneration,
          activeDocument: request.activeDocument,
          projectSchema: request.projectSchema,
          commitKind: 'agent-batch',
          updatedAt: request.updatedAt,
          operations,
        })
        return Object.freeze({
          schemaVersion: 1,
          status: 'committed',
          run: structuredClone(request.run),
          draft: structuredClone(result.draft),
        })
      }),
    )
  }

  async #normalizeStoredWorkingDraft(stored, scope) {
    try {
      if (!Number.isSafeInteger(stored.draftGeneration) || stored.draftGeneration < 1) {
        throw validationFailure('stored-working-draft-generation-is-invalid')
      }
      validateDurableProjectBatch({
        schemaVersion: 1,
        batchId: 'integrity-check',
        projectId: scope.projectId,
        branchId: scope.branchId,
        expectedDraftGeneration: stored.draftGeneration - 1,
        draft: stored,
        operations: [],
      })
    } catch (error) {
      throw asIntegrityMismatch(scope, 'stored-working-draft-contract-is-invalid', error)
    }

    const projectHash = await hashCanonicalJson(stored.projectSchema, { crypto: this.#crypto })
    if (projectHash !== stored.projectHash) {
      throw asIntegrityMismatch(scope, 'stored-working-draft-hash-does-not-match')
    }
    return structuredClone(stored)
  }

  async #readWorkingDraftNow(scope) {
    const stored = await this.#backend.get('workingDrafts', [scope.projectId, scope.branchId])
    return stored === undefined ? null : this.#normalizeStoredWorkingDraft(stored, scope)
  }

  async readWorkingDraft(value) {
    this.#assertAccepting()
    const scope = normalizeScope(value)
    return this.#enqueue(scopeKey(scope), () => this.#readWorkingDraftNow(scope))
  }

  async downgradeToLegacy(value) {
    this.#assertAccepting()
    const request = normalizeDowngradeRequest(value)
    return this.#enqueue(scopeKey(request), () =>
      this.#withSnapshotLock(request, async () => {
        const draft = await this.#readWorkingDraftNow(request)
        if (!draft) {
          throw validationFailure('canonical-working-draft-is-required-for-downgrade')
        }
        return materializeLegacyFromCanonical({
          legacy: request.legacy,
          draft,
          now: request.now,
          crashInjector: request.crashInjector,
          lockManager: lockAlreadyHeldManager,
        })
      }),
    )
  }

  async flush(value) {
    const key = value === undefined ? null : scopeKey(normalizeScope(value))
    const pending =
      key === null
        ? [...this.#pendingByScope.values()].flatMap(tasks => [...tasks])
        : [...(this.#pendingByScope.get(key) ?? [])]
    await Promise.all(pending)
    await this.#backend.flush()
  }

  async dispose() {
    if (this.#disposePromise) return this.#disposePromise
    this.#disposed = true
    this.#disposePromise = (async () => {
      try {
        await this.flush()
      } finally {
        await this.#backend.dispose()
      }
    })()
    return this.#disposePromise
  }
}
