import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'
import { DASHBOARD_STORAGE_COMPATIBILITY_MARKER_KEY } from './schema.mjs'

export const DASHBOARD_STORAGE_READER_VERSION = 1
export const DASHBOARD_STORAGE_WRITER_VERSION = 1

const hashPattern = /^sha256:[\da-f]{64}$/u

const isPlainObject = value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const isNonEmptyString = value => typeof value === 'string' && value.length > 0
const isGeneration = value => Number.isSafeInteger(value) && value >= 0
const isVersion = value => Number.isSafeInteger(value) && value > 0

const normalizeMarker = value => {
  if (!isPlainObject(value)) return null
  if (value.schemaVersion !== 1) return null
  if (!isVersion(value.writerVersion) || !isVersion(value.minReaderVersion)) return null
  if (value.canonicalBackend !== 'legacy-local-storage' && value.canonicalBackend !== 'indexeddb') return null
  if (!isNonEmptyString(value.projectId) || !isNonEmptyString(value.branchId)) return null
  if (!isGeneration(value.draftGeneration) || !hashPattern.test(value.projectHash)) return null
  if (!isGeneration(value.updatedAt)) return null
  return Object.freeze({
    schemaVersion: 1,
    writerVersion: value.writerVersion,
    canonicalBackend: value.canonicalBackend,
    minReaderVersion: value.minReaderVersion,
    projectId: value.projectId,
    branchId: value.branchId,
    draftGeneration: value.draftGeneration,
    projectHash: value.projectHash,
    updatedAt: value.updatedAt,
  })
}

export const createStorageCompatibilityMarker = value => {
  const marker = normalizeMarker({
    schemaVersion: 1,
    writerVersion: value?.writerVersion ?? DASHBOARD_STORAGE_WRITER_VERSION,
    canonicalBackend: value?.canonicalBackend,
    minReaderVersion: value?.minReaderVersion ?? DASHBOARD_STORAGE_READER_VERSION,
    projectId: value?.projectId,
    branchId: value?.branchId,
    draftGeneration: value?.draftGeneration,
    projectHash: value?.projectHash,
    updatedAt: value?.updatedAt,
  })
  if (!marker) {
    throw new DashboardStorageError(
      DASHBOARD_STORAGE_ERROR_CODE.validationFailed,
      'storage-compatibility-marker-is-invalid',
    )
  }
  return marker
}

export const parseStorageCompatibilityMarker = raw => {
  if (typeof raw !== 'string') return null
  try {
    return normalizeMarker(JSON.parse(raw))
  } catch {
    return null
  }
}

export const readStorageCompatibilityMarker = storage => {
  const raw = storage.getItem(DASHBOARD_STORAGE_COMPATIBILITY_MARKER_KEY)
  if (raw === null) return Object.freeze({ marker: null, diagnostic: null })
  const marker = parseStorageCompatibilityMarker(raw)
  return Object.freeze({
    marker,
    diagnostic: marker
      ? null
      : Object.freeze({
          code: 'malformed-compatibility-marker',
          key: DASHBOARD_STORAGE_COMPATIBILITY_MARKER_KEY,
        }),
  })
}

export const getStorageCompatibilityAccess = (
  marker,
  { readerVersion = DASHBOARD_STORAGE_READER_VERSION, writerVersion = DASHBOARD_STORAGE_WRITER_VERSION } = {},
) => {
  if (!marker) return 'read-write'
  return marker.minReaderVersion > readerVersion || marker.writerVersion > writerVersion ? 'read-only' : 'read-write'
}

export const assertStorageCompatibilityWritable = (marker, options = {}) => {
  if (getStorageCompatibilityAccess(marker, options) === 'read-write') return
  throw new DashboardStorageError(
    DASHBOARD_STORAGE_ERROR_CODE.readOnlyCompatibility,
    'storage-marker-requires-a-newer-reader',
    {
      readerVersion: options.readerVersion ?? DASHBOARD_STORAGE_READER_VERSION,
      writerVersion: options.writerVersion ?? DASHBOARD_STORAGE_WRITER_VERSION,
      minReaderVersion: marker.minReaderVersion,
      markerWriterVersion: marker.writerVersion,
    },
  )
}

export const writeStorageCompatibilityMarker = (storage, value) => {
  const marker = createStorageCompatibilityMarker(value)
  storage.setItem(DASHBOARD_STORAGE_COMPATIBILITY_MARKER_KEY, JSON.stringify(marker))
  return marker
}
