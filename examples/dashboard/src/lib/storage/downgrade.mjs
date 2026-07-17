import { assertStorageCompatibilityWritable, createStorageCompatibilityMarker } from './compatibility-marker.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'
import { requestLegacySnapshotLock } from './legacy-snapshot-lock.mjs'
import {
  assertCanonicalWorkingDraftForLegacySnapshot,
  writeVerifiedLegacySnapshotPayload,
} from './legacy-snapshot-writer.mjs'

export const DASHBOARD_STORAGE_DOWNGRADE_CRASH_POINTS = Object.freeze([
  'after-active-pointer',
  'after-project-schema',
  'after-page-schema',
  'after-page-info',
  'after-snapshot-metadata',
  'after-verification',
])

const inject = (crashInjector, point, details = {}) => {
  if (typeof crashInjector === 'function') crashInjector(Object.freeze({ point, ...details }))
}

const assertMarkerMatchesDraft = (marker, draft) => {
  if (!marker || marker.canonicalBackend !== 'indexeddb') {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
      'downgrade-requires-indexeddb-canonical-marker',
    )
  }
  if (marker.projectId !== draft.projectId || marker.branchId !== draft.branchId) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'downgrade-marker-authority-does-not-match-draft',
    )
  }
  if (
    marker.draftGeneration > draft.draftGeneration ||
    (marker.draftGeneration === draft.draftGeneration && marker.projectHash !== draft.projectHash)
  ) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'downgrade-draft-is-older-than-indexeddb-marker',
      { markerGeneration: marker.draftGeneration, draftGeneration: draft.draftGeneration },
    )
  }
}

const writeVerifiedLegacySnapshot = async ({ legacy, draft, now, crashInjector, canonicalBackend }) => {
  assertCanonicalWorkingDraftForLegacySnapshot(draft)
  const markerInspection = legacy.inspectCompatibilityMarker()
  if (markerInspection.diagnostic) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
      'malformed-compatibility-marker-requires-recovery',
    )
  }
  assertStorageCompatibilityWritable(markerInspection.marker)
  assertMarkerMatchesDraft(markerInspection.marker, draft)
  const identity = legacy.ensureIdentity(markerInspection.marker)
  if (identity.created) inject(crashInjector, 'after-active-pointer')
  const metadata = await writeVerifiedLegacySnapshotPayload({ legacy, draft, now, crashInjector })

  const nextMarker = legacy.writeCompatibilityMarker({
    canonicalBackend,
    projectId: draft.projectId,
    branchId: draft.branchId,
    draftGeneration: draft.draftGeneration,
    projectHash: draft.projectHash,
    updatedAt: metadata.updatedAt,
  })
  return Object.freeze({ marker: nextMarker, metadata })
}

export const materializeLegacyFromCanonical = async ({ legacy, draft, now = Date.now, crashInjector, lockManager }) => {
  assertCanonicalWorkingDraftForLegacySnapshot(draft)
  const result = await requestLegacySnapshotLock({ scope: draft, lockManager }, () =>
    writeVerifiedLegacySnapshot({
      legacy,
      draft,
      now,
      crashInjector,
      canonicalBackend: 'legacy-local-storage',
    }),
  )
  return Object.freeze({ status: 'materialized', ...result })
}

export const refreshIndexedDbCompatibilitySnapshot = async ({
  legacy,
  draft,
  now = Date.now,
  crashInjector,
  lockManager,
}) => {
  assertCanonicalWorkingDraftForLegacySnapshot(draft)
  const result = await requestLegacySnapshotLock({ scope: draft, lockManager }, () =>
    writeVerifiedLegacySnapshot({
      legacy,
      draft,
      now,
      crashInjector,
      canonicalBackend: 'indexeddb',
    }),
  )
  return Object.freeze({ status: 'refreshed', ...result })
}

const assertReentryAuthority = (left, right) => {
  if (!left || !right) return
  if (left.projectId !== right.projectId || left.branchId !== right.branchId) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'forward-reentry-draft-authorities-do-not-match',
    )
  }
}

export const selectForwardReentryDraft = ({ indexedDbDraft, legacyDraft, marker }) => {
  if (!indexedDbDraft && !legacyDraft) return Object.freeze({ source: null, draft: null })
  if (!marker && indexedDbDraft) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
      'pre-bridge-indexeddb-state-requires-export-recovery',
    )
  }
  if (
    marker?.canonicalBackend === 'legacy-local-storage' &&
    legacyDraft &&
    (legacyDraft.projectId !== marker.projectId ||
      legacyDraft.branchId !== marker.branchId ||
      legacyDraft.draftGeneration !== marker.draftGeneration ||
      legacyDraft.projectHash !== marker.projectHash)
  ) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'legacy-snapshot-does-not-match-canonical-marker',
      { markerGeneration: marker.draftGeneration, legacyGeneration: legacyDraft.draftGeneration },
    )
  }
  if (marker?.canonicalBackend === 'legacy-local-storage' && !legacyDraft) {
    throw new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, 'legacy-marker-has-no-legacy-draft')
  }
  if (marker?.canonicalBackend === 'indexeddb') {
    if (!indexedDbDraft) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'indexeddb-marker-has-no-indexeddb-draft',
      )
    }
    if (
      indexedDbDraft.projectId !== marker.projectId ||
      indexedDbDraft.branchId !== marker.branchId ||
      indexedDbDraft.draftGeneration < marker.draftGeneration ||
      (indexedDbDraft.draftGeneration === marker.draftGeneration && indexedDbDraft.projectHash !== marker.projectHash)
    ) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'indexeddb-draft-does-not-match-canonical-marker',
      )
    }
    if (legacyDraft && legacyDraft.draftGeneration > indexedDbDraft.draftGeneration) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'legacy-snapshot-is-newer-than-indexeddb-marker',
        { legacyGeneration: legacyDraft.draftGeneration, indexedDbGeneration: indexedDbDraft.draftGeneration },
      )
    }
    return Object.freeze({ source: 'indexeddb', draft: indexedDbDraft })
  }
  if (!indexedDbDraft) return Object.freeze({ source: 'legacy-local-storage', draft: legacyDraft })
  if (!legacyDraft) return Object.freeze({ source: 'indexeddb', draft: indexedDbDraft })
  assertReentryAuthority(indexedDbDraft, legacyDraft)

  if (indexedDbDraft.draftGeneration > legacyDraft.draftGeneration) {
    if (
      indexedDbDraft.commitKind === 'migration' &&
      indexedDbDraft.draftGeneration === legacyDraft.draftGeneration + 1 &&
      indexedDbDraft.projectHash === legacyDraft.projectHash
    ) {
      return Object.freeze({ source: 'indexeddb', draft: indexedDbDraft })
    }
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'forward-reentry-source-generation-is-stale',
      { legacyGeneration: legacyDraft.draftGeneration, indexedDbGeneration: indexedDbDraft.draftGeneration },
    )
  }
  if (legacyDraft.draftGeneration > indexedDbDraft.draftGeneration) {
    return Object.freeze({ source: 'legacy-local-storage', draft: legacyDraft })
  }
  if (indexedDbDraft.projectHash !== legacyDraft.projectHash) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'forward-reentry-generation-has-divergent-hashes',
      { draftGeneration: indexedDbDraft.draftGeneration },
    )
  }
  return Object.freeze({ source: 'indexeddb', draft: indexedDbDraft })
}
