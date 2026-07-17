import { canonicalJsonStringify, hashCanonicalJson } from './canonical-json.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'
import {
  LEGACY_PAGE_INFO_KEY,
  LEGACY_PAGE_SCHEMA_PREFIX,
  LEGACY_PROJECT_SCHEMA_KEY,
  legacySnapshotMetadataKey,
} from './legacy-storage.mjs'

const hashPattern = /^sha256:[\da-f]{64}$/u
const legacySnapshotFencePrefix = 'easy-editor:storage:legacy-snapshot-fence:v1:'

export const assertCanonicalWorkingDraftForLegacySnapshot = draft => {
  if (
    !draft ||
    draft.schemaVersion !== 1 ||
    typeof draft.projectId !== 'string' ||
    draft.projectId.length === 0 ||
    typeof draft.branchId !== 'string' ||
    draft.branchId.length === 0 ||
    !Number.isSafeInteger(draft.draftGeneration) ||
    draft.draftGeneration <= 0 ||
    !draft.projectSchema ||
    typeof draft.projectSchema !== 'object' ||
    Array.isArray(draft.projectSchema) ||
    !hashPattern.test(draft.projectHash)
  ) {
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
      { projectId: draft.projectId, branchId: draft.branchId },
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

export const writeVerifiedLegacySnapshotPayload = async ({ legacy, draft, now, crashInjector }) => {
  assertCanonicalWorkingDraftForLegacySnapshot(draft)
  const computedHash = await hashCanonicalJson(draft.projectSchema)
  if (computedHash !== draft.projectHash) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
      'canonical-draft-project-hash-is-invalid',
    )
  }
  claimSnapshotFence(legacy, draft)
  const snapshot = buildLegacySnapshot(draft)
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
  return metadata
}
