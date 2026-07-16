import { canonicalJsonStringify, hashCanonicalJson } from './canonical-json.mjs'
import { assertStorageCompatibilityWritable, createStorageCompatibilityMarker } from './compatibility-marker.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'
import { requestLegacySnapshotLock } from './legacy-snapshot-lock.mjs'
import {
  LEGACY_PAGE_INFO_KEY,
  LEGACY_PAGE_SCHEMA_PREFIX,
  LEGACY_PROJECT_SCHEMA_KEY,
  legacySnapshotMetadataKey,
} from './legacy-storage.mjs'

export const DASHBOARD_STORAGE_DOWNGRADE_CRASH_POINTS = Object.freeze([
  'after-active-pointer',
  'after-project-schema',
  'after-page-schema',
  'after-page-info',
  'after-snapshot-metadata',
  'after-verification',
])

const hashPattern = /^sha256:[\da-f]{64}$/u
const legacySnapshotFencePrefix = 'easy-editor:storage:legacy-snapshot-fence:v1:'

const isDraft = draft =>
  draft &&
  draft.schemaVersion === 1 &&
  typeof draft.projectId === 'string' &&
  draft.projectId.length > 0 &&
  typeof draft.branchId === 'string' &&
  draft.branchId.length > 0 &&
  Number.isSafeInteger(draft.draftGeneration) &&
  draft.draftGeneration > 0 &&
  draft.projectSchema &&
  typeof draft.projectSchema === 'object' &&
  !Array.isArray(draft.projectSchema) &&
  hashPattern.test(draft.projectHash)

const assertDraft = draft => {
  if (!isDraft(draft)) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.validationFailed,
      'canonical-draft-is-invalid-for-downgrade',
    )
  }
  if (!Array.isArray(draft.projectSchema.componentsTree) || draft.projectSchema.componentsTree.length === 0) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.validationFailed,
      'canonical-draft-has-no-pages-for-downgrade',
    )
  }
  if (
    draft.projectSchema.componentsTree.some(
      root =>
        typeof root !== 'object' ||
        root === null ||
        Array.isArray(root) ||
        typeof root.componentName !== 'string' ||
        root.componentName.length === 0,
    )
  ) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.validationFailed,
      'canonical-draft-has-an-invalid-page-for-downgrade',
    )
  }
}

const snapshotAuthoritySuffix = draft => `${encodeURIComponent(draft.projectId)}:${encodeURIComponent(draft.branchId)}`

const snapshotFenceKey = draft => `${legacySnapshotFencePrefix}${snapshotAuthoritySuffix(draft)}`

const parseSnapshotFence = (raw, draft) => {
  if (raw === null) return null
  let value
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'legacy-snapshot-fence-is-malformed',
      { projectId: draft.projectId, branchId: draft.branchId },
      { cause: error },
    )
  }
  const fields = Object.keys(value ?? {}).sort()
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    fields.length !== 5 ||
    fields.some(
      (field, index) => field !== ['branchId', 'draftGeneration', 'projectHash', 'projectId', 'schemaVersion'][index],
    ) ||
    value.schemaVersion !== 1 ||
    value.projectId !== draft.projectId ||
    value.branchId !== draft.branchId ||
    !Number.isSafeInteger(value.draftGeneration) ||
    value.draftGeneration < 1 ||
    !hashPattern.test(value.projectHash)
  ) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'legacy-snapshot-fence-is-malformed',
      {
        projectId: draft.projectId,
        branchId: draft.branchId,
      },
    )
  }
  return value
}

const assertFenceAllowsDraft = (fence, draft) => {
  if (!fence) return
  if (fence.draftGeneration > draft.draftGeneration) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.generationConflict,
      'legacy-snapshot-fence-is-newer-than-draft',
      { fenceGeneration: fence.draftGeneration, draftGeneration: draft.draftGeneration },
    )
  }
  if (fence.draftGeneration === draft.draftGeneration && fence.projectHash !== draft.projectHash) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'legacy-snapshot-fence-diverges-at-the-same-generation',
      { draftGeneration: draft.draftGeneration },
    )
  }
}

const claimSnapshotFence = (legacy, draft) => {
  const key = snapshotFenceKey(draft)
  const current = parseSnapshotFence(legacy.readValue(key), draft)
  assertFenceAllowsDraft(current, draft)
  if (current?.draftGeneration === draft.draftGeneration) return current

  const next = Object.freeze({
    schemaVersion: 1,
    projectId: draft.projectId,
    branchId: draft.branchId,
    draftGeneration: draft.draftGeneration,
    projectHash: draft.projectHash,
  })
  legacy.writeValue(key, JSON.stringify(next))
  const stored = parseSnapshotFence(legacy.readValue(key), draft)
  assertFenceAllowsDraft(stored, draft)
  if (canonicalJsonStringify(stored) !== canonicalJsonStringify(next)) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'legacy-snapshot-fence-claim-was-not-retained',
      { draftGeneration: draft.draftGeneration },
    )
  }
  return stored
}

const snapshotPagePath = (root, index) => {
  for (const value of [root?.fileName, root?.docId, root?.id]) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return `page-${index + 1}`
}

const snapshotPageTitle = (root, path) => {
  for (const value of [root?.fileDesc, root?.title]) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return path
}

const buildLegacySnapshot = draft => {
  const pageInfo = []
  const pageSchemas = []
  const paths = new Set()
  for (const [index, root] of draft.projectSchema.componentsTree.entries()) {
    const path = snapshotPagePath(root, index)
    if (paths.has(path)) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.validationFailed,
        'canonical-draft-page-paths-must-be-unique',
        { path },
      )
    }
    paths.add(path)
    pageInfo.push({ path, title: snapshotPageTitle(root, path) })
    pageSchemas.push({
      key: `${LEGACY_PAGE_SCHEMA_PREFIX}${path}`,
      value: { ...draft.projectSchema, componentsTree: [root] },
    })
  }
  return { projectSchema: draft.projectSchema, pageInfo, pageSchemas }
}

const parseWrittenJson = (legacy, key, reason) => {
  const raw = legacy.readValue(key)
  if (typeof raw !== 'string') {
    throw new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, reason, { key })
  }
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, reason, { key }, { cause: error })
  }
}

const assertSameJson = (actual, expected, reason, details = {}) => {
  if (canonicalJsonStringify(actual) !== canonicalJsonStringify(expected)) {
    throw new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch, reason, details)
  }
}

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
  assertDraft(draft)
  const markerInspection = legacy.inspectCompatibilityMarker()
  if (markerInspection.diagnostic) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
      'malformed-compatibility-marker-requires-recovery',
    )
  }
  assertStorageCompatibilityWritable(markerInspection.marker)
  assertMarkerMatchesDraft(markerInspection.marker, draft)
  const computedHash = await hashCanonicalJson(draft.projectSchema)
  if (computedHash !== draft.projectHash) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'canonical-draft-project-hash-is-invalid',
    )
  }
  claimSnapshotFence(legacy, draft)
  const snapshot = buildLegacySnapshot(draft)
  const identity = legacy.ensureIdentity(markerInspection.marker)
  if (identity.created) inject(crashInjector, 'after-active-pointer')
  legacy.writeValue(LEGACY_PROJECT_SCHEMA_KEY, JSON.stringify(snapshot.projectSchema))
  inject(crashInjector, 'after-project-schema')
  for (const [index, entry] of snapshot.pageSchemas.entries()) {
    legacy.writeValue(entry.key, JSON.stringify(entry.value))
    inject(crashInjector, 'after-page-schema', { index, key: entry.key })
  }
  legacy.writeValue(LEGACY_PAGE_INFO_KEY, JSON.stringify(snapshot.pageInfo))
  inject(crashInjector, 'after-page-info')

  const updatedAt = now()
  const metadata = Object.freeze({
    schemaVersion: 1,
    projectId: draft.projectId,
    branchId: draft.branchId,
    draftGeneration: draft.draftGeneration,
    projectHash: draft.projectHash,
    updatedAt,
  })
  const metadataKey = legacySnapshotMetadataKey(draft)
  legacy.writeValue(metadataKey, JSON.stringify(metadata))
  inject(crashInjector, 'after-snapshot-metadata')

  const writtenProject = parseWrittenJson(legacy, LEGACY_PROJECT_SCHEMA_KEY, 'legacy-project-read-back-failed')
  const writtenHash = await hashCanonicalJson(writtenProject)
  if (writtenHash !== draft.projectHash) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'legacy-project-hash-verification-failed',
      { expectedHash: draft.projectHash, actualHash: writtenHash },
    )
  }
  assertSameJson(
    parseWrittenJson(legacy, LEGACY_PAGE_INFO_KEY, 'legacy-page-info-read-back-failed'),
    snapshot.pageInfo,
    'legacy-page-info-verification-failed',
  )
  for (const entry of snapshot.pageSchemas) {
    assertSameJson(
      parseWrittenJson(legacy, entry.key, 'legacy-page-schema-read-back-failed'),
      entry.value,
      'legacy-page-schema-verification-failed',
      { key: entry.key },
    )
  }
  assertSameJson(
    parseWrittenJson(legacy, metadataKey, 'legacy-snapshot-metadata-read-back-failed'),
    metadata,
    'legacy-snapshot-generation-verification-failed',
  )
  inject(crashInjector, 'after-verification')

  const nextMarker = legacy.writeCompatibilityMarker({
    canonicalBackend,
    projectId: draft.projectId,
    branchId: draft.branchId,
    draftGeneration: draft.draftGeneration,
    projectHash: draft.projectHash,
    updatedAt,
  })
  return Object.freeze({ marker: nextMarker, metadata })
}

export const materializeLegacyFromCanonical = async ({ legacy, draft, now = Date.now, crashInjector, lockManager }) => {
  assertDraft(draft)
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
  assertDraft(draft)
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
