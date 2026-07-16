import { canonicalJsonStringify, hashCanonicalJson } from './canonical-json.mjs'
import {
  assertStorageCompatibilityWritable,
  createStorageCompatibilityMarker,
  readStorageCompatibilityMarker,
} from './compatibility-marker.mjs'
import {
  validateAgentPersistenceBatch,
  validateAgentPersistenceReadRequest,
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
import { requestLegacyIdentityLock, requestLegacySnapshotLock } from './legacy-snapshot-lock.mjs'

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
const compensationJournalRecordFields = Object.freeze([
  'branchId',
  'callId',
  'draftGeneration',
  'kind',
  'projectId',
  'recordId',
  'schemaVersion',
  'sessionId',
  'value',
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

const compensationRunRecordId = outerCallId => `compensation-run:${outerCallId}`
const compensationTargetRecordId = targetTaskId => `compensation-target:${targetTaskId}`

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
          ...request.operations,
        ]
      : request.operations
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
    return this.#enqueue(agentPersistenceScopeKey(batch), () => this.#backend.commitAgentPersistence(batch))
  }

  async recordReceiptIntent(value) {
    this.#assertAccepting()
    const intent = validateReceiptIntentRecord(value)
    if (typeof this.#backend.putReceiptIntent !== 'function') {
      throw validationFailure('storage-backend-receipt-intent-seam-is-required')
    }
    return this.#enqueue(scopeKey(intent), () => this.#backend.putReceiptIntent(intent))
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
      assertExactFields(stored, compensationJournalRecordFields, 'compensation-journal-record')
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
        stored.draftGeneration < 1
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
      } else if (stored.callId !== request.outerCallId) {
        throw validationFailure('compensation-journal-record-authority-mismatch')
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

  async #readWorkingDraftNow(scope) {
    const stored = await this.#backend.get('workingDrafts', [scope.projectId, scope.branchId])
    if (stored === undefined) return null

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
