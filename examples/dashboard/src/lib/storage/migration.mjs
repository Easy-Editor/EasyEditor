import { hashCanonicalJson } from './canonical-json.mjs'
import { assertStorageCompatibilityWritable } from './compatibility-marker.mjs'
import { selectForwardReentryDraft } from './downgrade.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError, isDashboardStorageError } from './errors.mjs'

const migrationFailure = (reason, details, cause) =>
  new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.migrationFailed, reason, details, { cause })

const diagnosticCodes = diagnostics => diagnostics.map(item => item.code).join(',')

const assertDraftIdentity = (draft, identity) => {
  if (!draft || draft.projectId !== identity.projectId || draft.branchId !== identity.branchId) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'indexeddb-draft-authority-does-not-match-active-pointer',
      { projectId: identity.projectId, branchId: identity.branchId },
    )
  }
}

export const migrateLegacyStorage = async ({ legacy, coordinator, now = Date.now, readerVersion = 1 }) => {
  const markerInspection = legacy.inspectCompatibilityMarker()
  if (markerInspection.diagnostic) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
      'malformed-compatibility-marker-requires-recovery',
      { diagnosticCode: markerInspection.diagnostic.code },
    )
  }
  const marker = markerInspection.marker
  assertStorageCompatibilityWritable(marker, { readerVersion })

  if (
    typeof coordinator?.ensureLegacyIdentity !== 'function' ||
    typeof coordinator?.readWorkingDraft !== 'function' ||
    typeof coordinator?.transitionLegacyMigration !== 'function'
  ) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.validationFailed,
      'migration-coordinator-seam-is-invalid',
    )
  }
  const { identity, diagnostic: identityDiagnostic } = await coordinator.ensureLegacyIdentity({ legacy, marker })

  const scope = { projectId: identity.projectId, branchId: identity.branchId }
  const indexedDbDraft = await coordinator.readWorkingDraft(scope)
  if (marker?.canonicalBackend === 'indexeddb') {
    assertDraftIdentity(indexedDbDraft, identity)
    if (
      indexedDbDraft.draftGeneration < marker.draftGeneration ||
      (indexedDbDraft.draftGeneration === marker.draftGeneration && indexedDbDraft.projectHash !== marker.projectHash)
    ) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'indexeddb-draft-does-not-match-canonical-marker',
        { markerGeneration: marker.draftGeneration, indexedDbGeneration: indexedDbDraft.draftGeneration },
      )
    }
    if (indexedDbDraft.draftGeneration > marker.draftGeneration) {
      const transition = await coordinator.transitionLegacyMigration({
        projectId: identity.projectId,
        branchId: identity.branchId,
        legacy,
        expectedMarker: marker,
        migration: null,
        updatedAt: now(),
      })
      assertDraftIdentity(transition.draft, identity)
      return Object.freeze({
        status: 'already-migrated',
        source: 'indexeddb',
        draft: transition.draft,
        diagnostics: Object.freeze(identityDiagnostic ? [identityDiagnostic] : []),
      })
    }
    return Object.freeze({
      status: 'already-migrated',
      source: 'indexeddb',
      draft: indexedDbDraft,
      diagnostics: Object.freeze(identityDiagnostic ? [identityDiagnostic] : []),
    })
  }

  const candidate = legacy.readProjectCandidate()
  const diagnostics = identityDiagnostic
    ? Object.freeze([identityDiagnostic, ...candidate.diagnostics])
    : candidate.diagnostics
  if (candidate.status !== 'ready') {
    const failure = migrationFailure('legacy-project-candidate-is-not-complete', {
      diagnosticCodes: diagnosticCodes(diagnostics),
    })
    if (typeof coordinator.recordMigrationFailure !== 'function') {
      throw migrationFailure(
        'legacy-project-failure-diagnostics-persist-failed',
        { diagnosticCodes: diagnosticCodes(diagnostics) },
        new AggregateError([failure], 'migration coordinator has no failure diagnostics seam'),
      )
    }
    try {
      await coordinator.recordMigrationFailure({
        projectId: identity.projectId,
        branchId: identity.branchId,
        source: candidate.source ?? 'unknown',
        sourceDraftGeneration: marker?.canonicalBackend === 'legacy-local-storage' ? marker.draftGeneration : 0,
        diagnostics,
        updatedAt: now(),
      })
    } catch (recordError) {
      throw migrationFailure(
        'legacy-project-failure-diagnostics-persist-failed',
        { diagnosticCodes: diagnosticCodes(diagnostics) },
        new AggregateError([failure, recordError], 'migration failure and diagnostics persistence both failed'),
      )
    }
    throw failure
  }
  const projectHash = await hashCanonicalJson(candidate.projectSchema)

  if (!marker && indexedDbDraft) {
    selectForwardReentryDraft({
      indexedDbDraft,
      legacyDraft: {
        schemaVersion: 1,
        projectId: identity.projectId,
        branchId: identity.branchId,
        draftGeneration: 0,
        activeDocument: candidate.activeDocument,
        projectSchema: candidate.projectSchema,
        projectHash,
        commitKind: 'migration',
        updatedAt: 0,
      },
      marker: null,
    })
  }

  if (marker?.canonicalBackend === 'legacy-local-storage') {
    const legacyDraft = {
      schemaVersion: 1,
      projectId: identity.projectId,
      branchId: identity.branchId,
      draftGeneration: marker.draftGeneration,
      activeDocument: candidate.activeDocument,
      projectSchema: candidate.projectSchema,
      projectHash,
      commitKind: 'migration',
      updatedAt: marker.updatedAt,
    }
    const selected = selectForwardReentryDraft({ indexedDbDraft, legacyDraft, marker })
    if (selected.source === 'indexeddb') {
      const transition = await coordinator.transitionLegacyMigration({
        projectId: identity.projectId,
        branchId: identity.branchId,
        legacy,
        expectedMarker: marker,
        migration: null,
        updatedAt: now(),
      })
      assertDraftIdentity(transition.draft, identity)
      return Object.freeze({
        status: 'recovered',
        source: 'indexeddb',
        draft: transition.draft,
        diagnostics,
      })
    }
  }

  const transitionUpdatedAt = now()
  let transition
  try {
    const migration = {
      projectId: identity.projectId,
      branchId: identity.branchId,
      expectedDraftGeneration: indexedDbDraft?.draftGeneration ?? 0,
      sourceDraftGeneration: marker?.draftGeneration ?? 0,
      source: candidate.source,
      diagnostics,
      projectSchema: candidate.projectSchema,
      projectHash,
      activeDocument: candidate.activeDocument,
      updatedAt: transitionUpdatedAt,
    }
    transition = await coordinator.transitionLegacyMigration({
      projectId: identity.projectId,
      branchId: identity.branchId,
      legacy,
      expectedMarker: marker,
      migration,
      updatedAt: transitionUpdatedAt,
    })
  } catch (error) {
    if (isDashboardStorageError(error)) throw error
    throw migrationFailure('legacy-project-durable-commit-failed', {}, error)
  }
  const committedDraft = transition.draft
  assertDraftIdentity(committedDraft, identity)
  if (committedDraft.projectHash !== projectHash) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'migration-commit-returned-a-different-project-hash',
    )
  }
  if (transition.status === 'reconciled') {
    return Object.freeze({
      status: 'recovered',
      source: 'indexeddb',
      draft: committedDraft,
      diagnostics,
    })
  }
  return Object.freeze({
    status: 'migrated',
    source: candidate.source,
    draft: committedDraft,
    diagnostics,
  })
}
