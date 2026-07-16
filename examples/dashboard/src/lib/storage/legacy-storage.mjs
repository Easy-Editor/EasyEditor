import { canonicalJsonStringify } from './canonical-json.mjs'
import { readStorageCompatibilityMarker, writeStorageCompatibilityMarker } from './compatibility-marker.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'
import { DASHBOARD_STORAGE_IDENTITY_POINTER_KEY } from './schema.mjs'

export const LEGACY_PROJECT_SCHEMA_KEY = 'projectSchema'
export const LEGACY_PAGE_INFO_KEY = 'pageInfo'
export const LEGACY_PAGE_SCHEMA_PREFIX = 'pageSchema:'
export const LEGACY_SNAPSHOT_METADATA_PREFIX = 'easy-editor:storage:legacy-snapshot:v1:'

const isPlainObject = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const nonEmptyString = value => typeof value === 'string' && value.length > 0
const safeJsonParse = raw => {
  if (typeof raw !== 'string') return { status: 'missing', value: null }
  try {
    return { status: 'valid', value: JSON.parse(raw) }
  } catch {
    return { status: 'malformed', value: null }
  }
}

const normalizeIdentity = value => {
  if (!isPlainObject(value) || value.schemaVersion !== 1) return null
  if (!nonEmptyString(value.projectId) || !nonEmptyString(value.branchId)) return null
  return Object.freeze({
    schemaVersion: 1,
    projectId: value.projectId,
    branchId: value.branchId,
  })
}

export const parseLegacyStorageIdentity = raw => {
  const parsed = safeJsonParse(raw)
  return parsed.status === 'valid' ? normalizeIdentity(parsed.value) : null
}

export const ensureLegacyStorageIdentity = (storage, options = {}) => {
  const raw = storage.getItem(DASHBOARD_STORAGE_IDENTITY_POINTER_KEY)
  const existing = parseLegacyStorageIdentity(raw)
  const marker = options.compatibilityMarker ?? readStorageCompatibilityMarker(storage).marker
  if (existing) {
    if (marker && (existing.projectId !== marker.projectId || existing.branchId !== marker.branchId)) {
      throw new DashboardStorageError(
        DASHBOARD_STORAGE_ERROR_CODE.integrityMismatch,
        'active-pointer-does-not-match-compatibility-marker',
        { projectId: existing.projectId, branchId: existing.branchId },
      )
    }
    return Object.freeze({ identity: existing, created: false, diagnostic: null })
  }

  const projectId = marker?.projectId ?? options.createProjectId?.()
  const branchId = marker?.branchId ?? 'main'
  if (!nonEmptyString(projectId)) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.validationFailed,
      'active-storage-project-id-is-unavailable',
    )
  }
  const identity = Object.freeze({ schemaVersion: 1, projectId, branchId })
  storage.setItem(DASHBOARD_STORAGE_IDENTITY_POINTER_KEY, JSON.stringify(identity))
  return Object.freeze({
    identity,
    created: true,
    diagnostic:
      raw === null
        ? null
        : Object.freeze({ code: 'malformed-active-pointer', key: DASHBOARD_STORAGE_IDENTITY_POINTER_KEY }),
  })
}

const validRoot = value => isPlainObject(value) && nonEmptyString(value.componentName)
const validProject = value =>
  isPlainObject(value) &&
  Array.isArray(value.componentsTree) &&
  value.componentsTree.length > 0 &&
  value.componentsTree.every(validRoot)

const activeDocumentFrom = (projectSchema, pagePath = null) => {
  const root = projectSchema.componentsTree[0]
  const fileName = nonEmptyString(root.fileName) ? root.fileName : pagePath
  const documentId = nonEmptyString(root.docId) ? root.docId : nonEmptyString(root.id) ? root.id : fileName
  if (!nonEmptyString(fileName) || !nonEmptyString(documentId)) return null
  return Object.freeze({ documentId, fileName, index: 0 })
}

const diagnostic = (code, key, details = {}) => Object.freeze({ code, key, ...details })

const sameJson = (left, right) => canonicalJsonStringify(left) === canonicalJsonStringify(right)

const mergeFragmentMetadata = (target, fragment, path, diagnostics) => {
  for (const [key, value] of Object.entries(fragment)) {
    if (key === 'componentsTree') continue
    if (!Object.hasOwn(target, key)) {
      target[key] = value
      continue
    }
    if (!sameJson(target[key], value)) {
      diagnostics.push(diagnostic('conflicting-project-field', `${LEGACY_PAGE_SCHEMA_PREFIX}${path}`, { field: key }))
    }
  }
}

export const readLegacyProjectCandidate = storage => {
  const diagnostics = []
  const fullRaw = storage.getItem(LEGACY_PROJECT_SCHEMA_KEY)
  const full = safeJsonParse(fullRaw)
  if (full.status === 'valid' && validProject(full.value)) {
    return Object.freeze({
      status: 'ready',
      source: 'projectSchema',
      projectSchema: full.value,
      activeDocument: activeDocumentFrom(full.value),
      diagnostics: Object.freeze(diagnostics),
    })
  }
  if (full.status === 'malformed') {
    diagnostics.push(diagnostic('malformed-project-schema', LEGACY_PROJECT_SCHEMA_KEY))
  } else if (full.status === 'valid') {
    diagnostics.push(diagnostic('invalid-project-schema', LEGACY_PROJECT_SCHEMA_KEY))
  }

  const pageInfoRaw = storage.getItem(LEGACY_PAGE_INFO_KEY)
  const parsedPageInfo = safeJsonParse(pageInfoRaw)
  if (parsedPageInfo.status === 'missing' && full.status === 'missing') {
    return Object.freeze({
      status: 'missing',
      source: null,
      projectSchema: null,
      activeDocument: null,
      diagnostics: Object.freeze(diagnostics),
    })
  }
  if (parsedPageInfo.status !== 'valid' || !Array.isArray(parsedPageInfo.value) || parsedPageInfo.value.length === 0) {
    diagnostics.push(
      diagnostic(
        parsedPageInfo.status === 'malformed' ? 'malformed-page-info' : 'missing-page-info',
        LEGACY_PAGE_INFO_KEY,
      ),
    )
    return Object.freeze({
      status: 'invalid',
      source: 'page-fragments',
      projectSchema: null,
      activeDocument: null,
      diagnostics: Object.freeze(diagnostics),
    })
  }

  const seenPaths = new Set()
  const roots = []
  const metadata = {}
  for (const [index, info] of parsedPageInfo.value.entries()) {
    if (!isPlainObject(info) || !nonEmptyString(info.path)) {
      diagnostics.push(diagnostic('invalid-page-info-entry', LEGACY_PAGE_INFO_KEY, { index }))
      continue
    }
    if (seenPaths.has(info.path)) {
      diagnostics.push(diagnostic('duplicate-page-fragment', `${LEGACY_PAGE_SCHEMA_PREFIX}${info.path}`))
      continue
    }
    seenPaths.add(info.path)
    const key = `${LEGACY_PAGE_SCHEMA_PREFIX}${info.path}`
    const parsedFragment = safeJsonParse(storage.getItem(key))
    if (parsedFragment.status === 'missing') {
      diagnostics.push(diagnostic('missing-page-fragment', key))
      continue
    }
    if (parsedFragment.status === 'malformed') {
      diagnostics.push(diagnostic('malformed-page-fragment', key))
      continue
    }
    const fragment = parsedFragment.value
    if (!isPlainObject(fragment)) {
      diagnostics.push(diagnostic('invalid-page-fragment', key))
      continue
    }
    const normalized = validRoot(fragment)
      ? { componentsTree: [fragment] }
      : validProject(fragment) && fragment.componentsTree.length === 1
        ? fragment
        : null
    if (!normalized) {
      diagnostics.push(diagnostic('invalid-page-fragment', key))
      continue
    }
    mergeFragmentMetadata(metadata, normalized, info.path, diagnostics)
    roots.push(normalized.componentsTree[0])
  }

  if (parsedPageInfo.value.length > 1) {
    diagnostics.push(diagnostic('multi-page-fragments', LEGACY_PAGE_INFO_KEY, { count: parsedPageInfo.value.length }))
  }
  if (roots.length !== parsedPageInfo.value.length) {
    diagnostics.push(
      diagnostic('partial-page-fragments', LEGACY_PAGE_INFO_KEY, {
        expected: parsedPageInfo.value.length,
        recovered: roots.length,
      }),
    )
  }
  const fatalCodes = new Set([
    'conflicting-project-field',
    'duplicate-page-fragment',
    'invalid-page-fragment',
    'invalid-page-info-entry',
    'malformed-page-fragment',
    'missing-page-fragment',
  ])
  if (roots.length !== parsedPageInfo.value.length || diagnostics.some(item => fatalCodes.has(item.code))) {
    return Object.freeze({
      status: 'invalid',
      source: 'page-fragments',
      projectSchema: null,
      activeDocument: null,
      diagnostics: Object.freeze(diagnostics),
    })
  }

  const projectSchema = { ...metadata, componentsTree: roots }
  return Object.freeze({
    status: 'ready',
    source: 'page-fragments',
    projectSchema,
    activeDocument: activeDocumentFrom(projectSchema, parsedPageInfo.value[0].path),
    diagnostics: Object.freeze(diagnostics),
  })
}

export const legacySnapshotMetadataKey = ({ projectId, branchId }) =>
  `${LEGACY_SNAPSHOT_METADATA_PREFIX}${encodeURIComponent(projectId)}:${encodeURIComponent(branchId)}`

export const createLegacyStorageAdapter = (storage, options = {}) =>
  Object.freeze({
    ensureIdentity: marker =>
      ensureLegacyStorageIdentity(storage, {
        compatibilityMarker: marker,
        createProjectId: options.createProjectId,
      }),
    inspectCompatibilityMarker: () => readStorageCompatibilityMarker(storage),
    writeCompatibilityMarker: marker => writeStorageCompatibilityMarker(storage, marker),
    readProjectCandidate: () => readLegacyProjectCandidate(storage),
    readValue: key => storage.getItem(key),
    writeValue: (key, value) => storage.setItem(key, value),
  })
