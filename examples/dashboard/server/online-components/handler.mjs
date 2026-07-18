import { createHash } from 'node:crypto'
import { BlockList, isIP } from 'node:net'
import { TextDecoder } from 'node:util'

import { resolvePinnedDestination } from '../data/address-policy.mjs'
import { DataProxyError } from '../data/errors.mjs'
import { createOnlineComponentDependencyCache } from './cache.mjs'
import { compileOnlineComponentDependencyConfig } from './config.mjs'
import { OnlineComponentDependencyError, createDependencyErrorEnvelope, toSafeDependencyError } from './errors.mjs'
import { validateBundledEsm } from './module-policy.mjs'
import { requestOnlineComponentResource } from './transport.mjs'

export const ONLINE_COMPONENT_DEPENDENCY_ROUTE = '/api/online-components/dependencies/resolve'

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])
const REQUEST_KEYS = new Set(['package', 'range'])
const METADATA_KEYS = new Set(['exactVersion', 'bundleUrl', 'format', 'installScripts', 'integrity'])
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,127}$/
const NUMERIC_IDENTIFIER = '(?:0|[1-9]\\d*)'
const PRERELEASE_IDENTIFIER = `(?:${NUMERIC_IDENTIFIER}|\\d*[A-Za-z-][0-9A-Za-z-]*)`
const BUILD_IDENTIFIER = '[0-9A-Za-z-]+'
const VERSION_SOURCE =
  `${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}` +
  `(?:-${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*)?` +
  `(?:\\+${BUILD_IDENTIFIER}(?:\\.${BUILD_IDENTIFIER})*)?`
const VERSION_PATTERN = new RegExp(
  `^(${NUMERIC_IDENTIFIER})\\.(${NUMERIC_IDENTIFIER})\\.(${NUMERIC_IDENTIFIER})` +
    `(?:-(${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*))?` +
    `(?:\\+${BUILD_IDENTIFIER}(?:\\.${BUILD_IDENTIFIER})*)?$`,
)
const EXACT_VERSION = new RegExp(`^${VERSION_SOURCE}$`)
const SIMPLE_RANGE = new RegExp(`^[~^]?${VERSION_SOURCE}$`)
const COMPARATOR = new RegExp(`^(?:>=|<=|>|<|=)?${VERSION_SOURCE}$`)
const X_RANGE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:x|X)$/
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

const invalidRequest = (status = 400) =>
  new OnlineComponentDependencyError('invalid-request', status, 'Request is invalid')
const destinationDenied = () =>
  new OnlineComponentDependencyError('destination-denied', 403, 'Destination is not allowed')
const invalidUpstream = () =>
  new OnlineComponentDependencyError('upstream-response-invalid', 502, 'Upstream response was rejected')
const lockDrift = () =>
  new OnlineComponentDependencyError('dependency-lock-drift', 409, 'Online component dependency lock changed')
const upstreamFailed = () => new OnlineComponentDependencyError('upstream-failed', 502, 'Upstream request failed', true)

const normalizeHeaders = headers => {
  const result = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') result[name.toLowerCase()] = value
    else if (Array.isArray(value)) result[name.toLowerCase()] = value.join(', ')
  }
  return result
}

const decodeUtf8 = value => {
  try {
    return utf8Decoder.decode(Buffer.from(value))
  } catch {
    return null
  }
}

const isValidRange = value => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || value.includes('||')) return false
  if (SIMPLE_RANGE.test(value) || X_RANGE.test(value)) return true
  const tokens = value.split(' ')
  return tokens.length >= 2 && tokens.length <= 4 && tokens.every(token => token && COMPARATOR.test(token))
}

const compareNumericIdentifiers = (left, right) => {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

const incrementNumericIdentifier = value => {
  const digits = [...value]
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] === '9') {
      digits[index] = '0'
      continue
    }
    digits[index] = String(Number(digits[index]) + 1)
    return digits.join('')
  }
  return `1${digits.join('')}`
}

const parseVersion = value => {
  const match = VERSION_PATTERN.exec(value)
  if (!match) return null
  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease: match[4]?.split('.') ?? [],
  }
}

const compareVersions = (left, right) => {
  for (const key of ['major', 'minor', 'patch']) {
    const comparison = compareNumericIdentifiers(left[key], right[key])
    if (comparison !== 0) return comparison
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1
    if (leftPart === rightPart) continue
    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) return compareNumericIdentifiers(leftPart, rightPart)
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

const satisfiesComparator = (version, comparator) => {
  const match = /^(>=|<=|>|<|=)?(.+)$/.exec(comparator)
  const required = parseVersion(match?.[2] ?? '')
  if (!required) return false
  const comparison = compareVersions(version, required)
  if (match[1] === '>') return comparison > 0
  if (match[1] === '>=') return comparison >= 0
  if (match[1] === '<') return comparison < 0
  if (match[1] === '<=') return comparison <= 0
  return comparison === 0
}

const comparatorVersion = comparator => parseVersion(comparator.replace(/^(?:>=|<=|>|<|=)/, ''))

const admitsPrerelease = (version, range) => {
  if (version.prerelease.length === 0) return true
  const comparators = X_RANGE.test(range)
    ? []
    : range.startsWith('^') || range.startsWith('~')
      ? [range.slice(1)]
      : range.split(' ')
  return comparators.some(comparator => {
    const required = comparatorVersion(comparator)
    return (
      required?.prerelease.length > 0 &&
      required.major === version.major &&
      required.minor === version.minor &&
      required.patch === version.patch
    )
  })
}

const satisfiesRange = (exactVersion, range) => {
  const version = parseVersion(exactVersion)
  if (!version || !admitsPrerelease(version, range)) return false
  if (X_RANGE.test(range)) {
    const [major, minor] = range.split('.')
    return version.major === major && version.minor === minor
  }
  if (range.startsWith('^') || range.startsWith('~')) {
    const required = parseVersion(range.slice(1))
    if (!required || compareVersions(version, required) < 0) return false
    const upper =
      range[0] === '~'
        ? { major: required.major, minor: incrementNumericIdentifier(required.minor), patch: '0', prerelease: [] }
        : required.major !== '0'
          ? { major: incrementNumericIdentifier(required.major), minor: '0', patch: '0', prerelease: [] }
          : required.minor !== '0'
            ? { major: '0', minor: incrementNumericIdentifier(required.minor), patch: '0', prerelease: [] }
            : { major: '0', minor: '0', patch: incrementNumericIdentifier(required.patch), prerelease: [] }
    return compareVersions(version, upper) < 0
  }
  if (SIMPLE_RANGE.test(range)) return satisfiesComparator(version, range)
  return range.split(' ').every(comparator => satisfiesComparator(version, comparator))
}

const parseRequest = request => {
  if (request.path !== ONLINE_COMPONENT_DEPENDENCY_ROUTE) throw invalidRequest(404)
  if (request.method !== 'POST') throw invalidRequest(405)
  const headers = normalizeHeaders(request.headers)
  if (!/^application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '')) throw invalidRequest(415)
  if (!Array.isArray(request.expectedOrigins) || !request.expectedOrigins.includes(headers.origin)) {
    throw invalidRequest(403)
  }
  const text = decodeUtf8(request.body ?? '')
  let value
  try {
    value = text === null ? null : JSON.parse(text)
  } catch {
    throw invalidRequest()
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== REQUEST_KEYS.size ||
    Object.keys(value).some(key => !REQUEST_KEYS.has(key)) ||
    typeof value.package !== 'string' ||
    !PACKAGE_NAME.test(value.package) ||
    !isValidRange(value.range)
  ) {
    throw invalidRequest()
  }
  return value
}

const normalizeContentType = headers => {
  const normalized = normalizeHeaders(headers)
  return normalized['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
}

const isJsonContentType = value => value === 'application/json' || value?.endsWith('+json')
const isModuleContentType = value =>
  value === 'text/javascript' ||
  value === 'application/javascript' ||
  value === 'text/ecmascript' ||
  value === 'application/ecmascript'

const normalizeAllowedUrl = (value, allowedOrigins) => {
  let url
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value)
  } catch {
    throw destinationDenied()
  }
  if (url.protocol !== 'https:' || url.username || url.password || !allowedOrigins.includes(url.origin) || url.hash) {
    throw destinationDenied()
  }
  return url
}

const withAbortSignal = (promise, signal) => {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

const isPinnedPeer = (actualAddress, pinned) => {
  if (typeof actualAddress !== 'string' || isIP(actualAddress) !== pinned.family) return false
  try {
    const family = pinned.family === 4 ? 'ipv4' : 'ipv6'
    const exactAddress = new BlockList()
    exactAddress.addAddress(pinned.address, family)
    return exactAddress.check(actualAddress, family)
  } catch {
    return false
  }
}

const fetchResource = async ({
  initialUrl,
  allowedOrigins,
  kind,
  lookup,
  transport,
  signal,
  maxBytes,
  maxRedirects,
}) => {
  let url = normalizeAllowedUrl(initialUrl, allowedOrigins)
  let redirects = 0
  while (true) {
    let pinned
    try {
      pinned = await withAbortSignal(resolvePinnedDestination(url, lookup), signal)
    } catch (error) {
      if (signal.aborted) throw error
      if (error instanceof DataProxyError && error.code === 'destination-denied') throw destinationDenied()
      throw upstreamFailed()
    }
    let response
    try {
      response = await withAbortSignal(
        transport({
          kind,
          url,
          headers: {
            accept: kind === 'registry' ? 'application/json' : 'text/javascript, application/javascript',
            'user-agent': 'EasyEditor-Online-Component-Resolver/1',
          },
          signal,
          lookup: pinned.lookup,
          maxBytes,
        }),
        signal,
      )
    } catch (error) {
      if (signal.aborted || error instanceof OnlineComponentDependencyError) throw error
      throw upstreamFailed()
    }
    let actualUrl
    try {
      actualUrl = new URL(response?.url instanceof URL ? response.url.href : response?.url)
    } catch {
      throw destinationDenied()
    }
    if (actualUrl.href !== url.href || !isPinnedPeer(response?.remoteAddress, pinned.pinned)) throw destinationDenied()
    const body = Buffer.from(response.body ?? '')
    if (body.length > maxBytes) throw invalidUpstream()
    const status = Number(response?.status)
    if (REDIRECT_STATUS.has(status)) {
      if (redirects >= maxRedirects) throw invalidUpstream()
      const headers = normalizeHeaders(response.headers)
      if (typeof headers.location !== 'string') throw invalidUpstream()
      url = normalizeAllowedUrl(new URL(headers.location, url), allowedOrigins)
      redirects += 1
      continue
    }
    if (!Number.isInteger(status) || status < 200 || status > 299) {
      throw upstreamFailed()
    }
    return { body, headers: response.headers, finalUrl: url.href }
  }
}

const parseMetadata = (response, range) => {
  if (!isJsonContentType(normalizeContentType(response.headers))) throw invalidUpstream()
  const text = decodeUtf8(response.body)
  let value
  try {
    value = text === null ? null : JSON.parse(text)
  } catch {
    throw invalidUpstream()
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !METADATA_KEYS.has(key)) ||
    typeof value.exactVersion !== 'string' ||
    !EXACT_VERSION.test(value.exactVersion) ||
    !satisfiesRange(value.exactVersion, range) ||
    typeof value.bundleUrl !== 'string' ||
    value.format !== 'bundled-esm' ||
    value.installScripts !== false ||
    (value.integrity !== undefined && typeof value.integrity !== 'string')
  ) {
    throw invalidUpstream()
  }
  return value
}

const calculateIntegrity = bytes => `sha256-${createHash('sha256').update(bytes).digest('base64')}`

const isValidIntegrity = value => {
  if (typeof value !== 'string' || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(value)) return false
  try {
    return Buffer.from(value.slice(7), 'base64').length === 32
  } catch {
    return false
  }
}

const parseBundle = response => {
  if (!isModuleContentType(normalizeContentType(response.headers))) throw invalidUpstream()
  const source = decodeUtf8(response.body)
  if (source === null) throw invalidUpstream()
  validateBundledEsm(source)
  return { bytes: response.body, source, contentType: 'text/javascript' }
}

const validateCachedRecord = (record, request, config) => {
  const keys = [
    'schemaVersion',
    'package',
    'range',
    'exactVersion',
    'bundleUrl',
    'finalUrl',
    'integrity',
    'contentType',
    'bytes',
  ]
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    Object.keys(record).length !== keys.length ||
    Object.keys(record).some(key => !keys.includes(key)) ||
    record.schemaVersion !== 1 ||
    record.package !== request.package ||
    record.range !== request.range ||
    !EXACT_VERSION.test(record.exactVersion ?? '') ||
    !satisfiesRange(record.exactVersion ?? '', request.range) ||
    record.contentType !== 'text/javascript' ||
    !isValidIntegrity(record.integrity) ||
    typeof record.bytes !== 'string'
  ) {
    throw lockDrift()
  }
  normalizeAllowedUrl(record.bundleUrl, config.cdnOrigins)
  normalizeAllowedUrl(record.finalUrl, config.cdnOrigins)
  const bytes = Buffer.from(record.bytes, 'base64')
  if (bytes.toString('base64') !== record.bytes || bytes.length > config.limits.maxBundleBytes) throw lockDrift()
  const source = decodeUtf8(bytes)
  if (source === null || calculateIntegrity(bytes) !== record.integrity) throw lockDrift()
  try {
    validateBundledEsm(source)
  } catch {
    throw lockDrift()
  }
  return { ...record, bytes }
}

const responseFor = (record, cached) => ({
  status: 200,
  body: {
    schemaVersion: 1,
    dependency: {
      package: record.package,
      range: record.range,
      exactVersion: record.exactVersion,
      finalUrl: record.finalUrl,
      integrity: record.integrity,
      cached,
      module: {
        format: 'bundled-esm',
        contentType: record.contentType,
        encoding: 'base64',
        byteLength: record.bytes.length,
        bytes: record.bytes.toString('base64'),
      },
    },
  },
})

const isRecoverableNetworkError = error =>
  !(error instanceof OnlineComponentDependencyError) ||
  error.code === 'dependency-unavailable' ||
  error.code === 'upstream-failed' ||
  error.code === 'upstream-timeout'

export const createOnlineComponentDependencyHandler = ({
  config: configInput,
  lookup,
  transport = requestOnlineComponentResource,
  cache,
  totalTimeoutMs,
  logger = { info() {}, warn() {} },
} = {}) => {
  const config = compileOnlineComponentDependencyConfig(configInput)
  const lockCache = cache ?? createOnlineComponentDependencyCache({ directory: config.cacheDir })
  return {
    async handle(request) {
      const controller = new AbortController()
      let deadlineExpired = false
      const timeoutMs =
        Number.isInteger(totalTimeoutMs) && totalTimeoutMs > 0
          ? Math.min(totalTimeoutMs, config.limits.timeoutMs)
          : config.limits.timeoutMs
      const timeout = setTimeout(() => {
        deadlineExpired = true
        controller.abort(new Error('deadline'))
      }, timeoutMs)
      const onAbort = () => controller.abort(request.signal?.reason)
      if (request.signal?.aborted) onAbort()
      else request.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const input = parseRequest(request)
        let locked
        try {
          const record = await withAbortSignal(lockCache.read(input.package, input.range), controller.signal)
          locked = record === null ? null : validateCachedRecord(record, input, config)
        } catch (error) {
          if (controller.signal.aborted) throw error
          if (error instanceof OnlineComponentDependencyError) throw error
          throw lockDrift()
        }

        try {
          const registryUrl = new URL(
            `/v1/resolve/${encodeURIComponent(input.package)}?range=${encodeURIComponent(input.range)}`,
            config.registryOrigins[0],
          )
          const metadataResponse = await fetchResource({
            initialUrl: registryUrl,
            allowedOrigins: config.registryOrigins,
            kind: 'registry',
            lookup,
            transport,
            signal: controller.signal,
            maxBytes: config.limits.maxMetadataBytes,
            maxRedirects: config.limits.maxRedirects,
          })
          const metadata = parseMetadata(metadataResponse, input.range)
          const bundleUrl = normalizeAllowedUrl(metadata.bundleUrl, config.cdnOrigins).href
          if (
            locked &&
            (locked.exactVersion !== metadata.exactVersion ||
              locked.bundleUrl !== bundleUrl ||
              (metadata.integrity !== undefined && locked.integrity !== metadata.integrity))
          ) {
            throw lockDrift()
          }
          const bundleResponse = await fetchResource({
            initialUrl: bundleUrl,
            allowedOrigins: config.cdnOrigins,
            kind: 'bundle',
            lookup,
            transport,
            signal: controller.signal,
            maxBytes: config.limits.maxBundleBytes,
            maxRedirects: config.limits.maxRedirects,
          })
          const bundle = parseBundle(bundleResponse)
          const integrity = calculateIntegrity(bundle.bytes)
          if (locked && (locked.finalUrl !== bundleResponse.finalUrl || locked.integrity !== integrity)) {
            throw lockDrift()
          }
          if (
            metadata.integrity !== undefined &&
            (!isValidIntegrity(metadata.integrity) || metadata.integrity !== integrity)
          ) {
            throw invalidUpstream()
          }
          const record = {
            schemaVersion: 1,
            package: input.package,
            range: input.range,
            exactVersion: metadata.exactVersion,
            bundleUrl,
            finalUrl: bundleResponse.finalUrl,
            integrity,
            contentType: bundle.contentType,
            bytes: bundle.bytes.toString('base64'),
          }
          let persisted = record
          if (!locked) {
            persisted = validateCachedRecord(
              await withAbortSignal(lockCache.write(input.package, input.range, record), controller.signal),
              input,
              config,
            )
            if (
              persisted.exactVersion !== record.exactVersion ||
              persisted.bundleUrl !== record.bundleUrl ||
              persisted.finalUrl !== record.finalUrl ||
              persisted.integrity !== record.integrity
            ) {
              throw lockDrift()
            }
          }
          const materialized = locked ? { ...record, bytes: bundle.bytes } : persisted
          logger.info({ event: 'online-component-dependency-resolved', package: input.package, cached: false })
          return responseFor(materialized, false)
        } catch (error) {
          if (locked && !request.signal?.aborted && (deadlineExpired || isRecoverableNetworkError(error))) {
            logger.info({ event: 'online-component-dependency-resolved', package: input.package, cached: true })
            return responseFor(locked, true)
          }
          throw error
        }
      } catch (error) {
        const safe = toSafeDependencyError(
          deadlineExpired
            ? new OnlineComponentDependencyError('upstream-timeout', 504, 'Upstream request timed out', true)
            : request.signal?.aborted
              ? new OnlineComponentDependencyError('request-aborted', 408, 'Request was aborted', true)
              : error,
        )
        logger.warn({ event: 'online-component-dependency-failed', code: safe.code })
        return createDependencyErrorEnvelope(safe)
      } finally {
        clearTimeout(timeout)
        request.signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}

export const createDisabledOnlineComponentDependencyHandler = () => ({
  async handle() {
    return createDependencyErrorEnvelope(
      new OnlineComponentDependencyError(
        'dependency-unavailable',
        503,
        'Online component dependency resolver is unavailable',
        true,
      ),
    )
  },
})
