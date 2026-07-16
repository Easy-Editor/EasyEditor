import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'

const identifierPattern = /^[A-Za-z_$][\w$]*$/u

const childPath = (path, key) => (identifierPattern.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`)

const validationError = (reason, path, details = {}) =>
  new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.validationFailed, reason, { path, ...details })

const assertDataDescriptor = (descriptor, path) => {
  if (!descriptor || !('value' in descriptor)) {
    throw validationError('accessor-values-are-not-json', path)
  }
  return descriptor.value
}

const serializeNumber = (value, path) => {
  if (!Number.isFinite(value)) throw validationError('non-finite-numbers-are-not-json', path)
  return Object.is(value, -0) ? '0' : String(value)
}

const serializeArray = (value, path, ancestors) => {
  const symbolKeys = Object.getOwnPropertySymbols(value)
  if (symbolKeys.length > 0) throw validationError('symbol-keys-are-not-json', path)

  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length') continue
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      throw validationError('array-properties-must-be-dense-indexes', childPath(path, key))
    }
  }

  const entries = []
  for (let index = 0; index < value.length; index += 1) {
    const indexPath = `${path}[${index}]`
    const item = assertDataDescriptor(Reflect.getOwnPropertyDescriptor(value, String(index)), indexPath)
    entries.push(serializeValue(item, indexPath, ancestors))
  }
  return `[${entries.join(',')}]`
}

const serializeObject = (value, path, ancestors) => {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw validationError('objects-must-have-a-json-prototype', path)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw validationError('symbol-keys-are-not-json', path)

  const keys = Object.getOwnPropertyNames(value).sort()
  const entries = keys.map(key => {
    const entryPath = childPath(path, key)
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable) throw validationError('non-enumerable-properties-are-not-json', entryPath)
    const item = assertDataDescriptor(descriptor, entryPath)
    return `${JSON.stringify(key)}:${serializeValue(item, entryPath, ancestors)}`
  })
  return `{${entries.join(',')}}`
}

const serializeValue = (value, path, ancestors) => {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return serializeNumber(value, path)
  if (typeof value !== 'object') throw validationError('value-is-not-json', path, { valueType: typeof value })
  if (ancestors.has(value)) throw validationError('cyclic-values-are-not-json', path)

  ancestors.add(value)
  try {
    return Array.isArray(value) ? serializeArray(value, path, ancestors) : serializeObject(value, path, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

export const canonicalJsonStringify = value => serializeValue(value, '$', new WeakSet())

const bytesToHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

export const hashCanonicalJson = async (value, options = {}) => {
  const crypto = options.crypto ?? globalThis.crypto
  if (!crypto?.subtle || typeof crypto.subtle.digest !== 'function') {
    throw new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.storageUnavailable, 'webcrypto-sha-256-is-unavailable')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJsonStringify(value)))
  return `sha256:${bytesToHex(new Uint8Array(digest))}`
}
