import { isAbsolute, resolve } from 'node:path'

const DEFAULT_LIMITS = Object.freeze({
  maxMetadataBytes: 64 * 1024,
  maxBundleBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  timeoutMs: 5000,
})

const hasOnlyKeys = (value, keys) =>
  value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))

const compileOrigins = value => {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('At least one HTTPS origin is required')
  const origins = value.map(input => {
    if (typeof input !== 'string') throw new TypeError('Origin must be a string')
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new TypeError('Origin must be an HTTPS origin')
    }
    return url.origin
  })
  return Object.freeze([...new Set(origins)])
}

const compileLimits = value => {
  if (value !== undefined && !hasOnlyKeys(value, Object.keys(DEFAULT_LIMITS))) {
    throw new TypeError('Dependency limits are invalid')
  }
  const limits = { ...DEFAULT_LIMITS, ...value }
  for (const key of ['maxMetadataBytes', 'maxBundleBytes', 'timeoutMs']) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) throw new TypeError('Dependency limit is invalid')
  }
  if (!Number.isSafeInteger(limits.maxRedirects) || limits.maxRedirects < 0 || limits.maxRedirects > 10) {
    throw new TypeError('Dependency redirect limit is invalid')
  }
  return Object.freeze(limits)
}

export const compileOnlineComponentDependencyConfig = value => {
  if (!hasOnlyKeys(value, ['registryOrigins', 'cdnOrigins', 'cacheDir', 'limits'])) {
    throw new TypeError('Dependency resolver configuration is invalid')
  }
  if (typeof value.cacheDir !== 'string' || !isAbsolute(value.cacheDir)) {
    throw new TypeError('Dependency cache directory must be absolute')
  }
  return Object.freeze({
    registryOrigins: compileOrigins(value.registryOrigins),
    cdnOrigins: compileOrigins(value.cdnOrigins),
    cacheDir: resolve(value.cacheDir),
    limits: compileLimits(value.limits),
  })
}
