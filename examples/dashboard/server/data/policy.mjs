import { DataProxyError } from './errors.mjs'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'cookie',
  'host',
  'keep-alive',
  'origin',
  'proxy-authenticate',
  'proxy-authorization',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
])
const SERVER_HEADERS = new Set(['accept', 'content-type'])
const METHOD_SET = new Set(['GET', 'POST'])
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const hasUnsafeControlCharacters = value =>
  [...value].some(character => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })

const assertPlainObject = (value, message) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new DataProxyError('credential-unavailable', 503, message)
  }
}

const assertExactKeys = (value, allowed, message) => {
  if (Object.keys(value).some(key => !allowed.has(key)))
    throw new DataProxyError('credential-unavailable', 503, message)
}

const effectivePort = url => Number.parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'), 10)

export const compileProviderPolicy = raw => {
  assertPlainObject(raw, 'Credential provider is unavailable')
  assertExactKeys(
    raw,
    new Set(['scheme', 'origin', 'port', 'pathPrefix', 'methods', 'headerTemplate', 'redirect', 'limits']),
    'Credential provider is unavailable',
  )
  const scheme = raw.scheme?.endsWith(':') ? raw.scheme : `${raw.scheme}:`
  if (scheme !== 'http:' && scheme !== 'https:')
    throw new DataProxyError('credential-unavailable', 503, 'Credential provider is unavailable')
  let originUrl
  try {
    originUrl = new URL(raw.origin)
  } catch {
    throw new DataProxyError('credential-unavailable', 503, 'Credential provider is unavailable')
  }
  if (
    originUrl.origin !== raw.origin ||
    originUrl.protocol !== scheme ||
    originUrl.username ||
    originUrl.password ||
    originUrl.pathname !== '/'
  ) {
    throw new DataProxyError('credential-unavailable', 503, 'Credential provider is unavailable')
  }
  const port = Number(raw.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || effectivePort(originUrl) !== port) {
    throw new DataProxyError('credential-unavailable', 503, 'Credential provider is unavailable')
  }
  if (typeof raw.pathPrefix !== 'string' || !raw.pathPrefix.startsWith('/') || /[\r\n\\]/.test(raw.pathPrefix)) {
    throw new DataProxyError('credential-unavailable', 503, 'Credential provider is unavailable')
  }
  if (!Array.isArray(raw.methods) || raw.methods.length === 0 || raw.methods.some(method => !METHOD_SET.has(method))) {
    throw new DataProxyError('credential-unavailable', 503, 'Credential provider is unavailable')
  }
  assertPlainObject(raw.headerTemplate, 'Credential provider is unavailable')
  const headerTemplate = {}
  let hasSecretSlot = false
  for (const [rawName, template] of Object.entries(raw.headerTemplate)) {
    const name = rawName.toLowerCase()
    if (
      !HEADER_NAME.test(rawName) ||
      HOP_BY_HOP_HEADERS.has(name) ||
      SERVER_HEADERS.has(name) ||
      typeof template !== 'string' ||
      hasUnsafeControlCharacters(template) ||
      template.replaceAll('{{secret}}', '').includes('{{') ||
      template.replaceAll('{{secret}}', '').includes('}}')
    ) {
      throw new DataProxyError('credential-unavailable', 503, 'Credential provider is unavailable')
    }
    hasSecretSlot ||= template.includes('{{secret}}')
    headerTemplate[name] = template
  }
  if (!hasSecretSlot) throw new DataProxyError('credential-unavailable', 503, 'Credential provider is unavailable')

  const redirect = raw.redirect ?? { enabled: false, maxHops: 0 }
  assertPlainObject(redirect, 'Credential provider is unavailable')
  assertExactKeys(redirect, new Set(['enabled', 'maxHops']), 'Credential provider is unavailable')
  const maxHops = Number(redirect.maxHops)
  if (
    typeof redirect.enabled !== 'boolean' ||
    !Number.isInteger(maxHops) ||
    maxHops < 0 ||
    maxHops > 5 ||
    (!redirect.enabled && maxHops !== 0)
  ) {
    throw new DataProxyError('credential-unavailable', 503, 'Credential provider is unavailable')
  }

  const limits = raw.limits ?? {}
  assertPlainObject(limits, 'Credential provider is unavailable')
  assertExactKeys(
    limits,
    new Set(['maxRequestBytes', 'maxResponseBytes', 'maxRows', 'timeoutMs']),
    'Credential provider is unavailable',
  )
  const normalizedLimits = {
    maxRequestBytes: Number(limits.maxRequestBytes ?? 64 * 1024),
    maxResponseBytes: Number(limits.maxResponseBytes ?? 1024 * 1024),
    maxRows: Number(limits.maxRows ?? 1000),
    timeoutMs: Number(limits.timeoutMs ?? 5000),
  }
  if (
    !Number.isInteger(normalizedLimits.maxRequestBytes) ||
    normalizedLimits.maxRequestBytes < 1 ||
    normalizedLimits.maxRequestBytes > 1024 * 1024 ||
    !Number.isInteger(normalizedLimits.maxResponseBytes) ||
    normalizedLimits.maxResponseBytes < 1 ||
    normalizedLimits.maxResponseBytes > 10 * 1024 * 1024 ||
    !Number.isInteger(normalizedLimits.maxRows) ||
    normalizedLimits.maxRows < 1 ||
    normalizedLimits.maxRows > 10_000 ||
    !Number.isInteger(normalizedLimits.timeoutMs) ||
    normalizedLimits.timeoutMs < 1 ||
    normalizedLimits.timeoutMs > 30_000
  ) {
    throw new DataProxyError('credential-unavailable', 503, 'Credential provider is unavailable')
  }

  return Object.freeze({
    scheme,
    origin: originUrl.origin,
    port,
    pathPrefix: raw.pathPrefix,
    methods: new Set(raw.methods),
    headerTemplate: Object.freeze(headerTemplate),
    redirect: Object.freeze({ enabled: redirect.enabled, maxHops }),
    limits: Object.freeze(normalizedLimits),
  })
}

export const authorizeDestination = (policy, rawUrl, method) => {
  if (
    typeof rawUrl !== 'string' ||
    rawUrl.length > 2048 ||
    hasUnsafeControlCharacters(rawUrl) ||
    /%0d|%0a/i.test(rawUrl)
  ) {
    throw new DataProxyError('destination-denied', 403, 'Destination is not allowed')
  }
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new DataProxyError('destination-denied', 403, 'Destination is not allowed')
  }
  const pathPrefixMatches =
    url.pathname === policy.pathPrefix ||
    (policy.pathPrefix.endsWith('/')
      ? url.pathname.startsWith(policy.pathPrefix)
      : url.pathname.startsWith(`${policy.pathPrefix}/`))
  if (
    !METHOD_SET.has(method) ||
    !policy.methods.has(method) ||
    url.protocol !== policy.scheme ||
    url.origin !== policy.origin ||
    effectivePort(url) !== policy.port ||
    !pathPrefixMatches ||
    url.username ||
    url.password ||
    url.hash ||
    /%25|%2f|%5c|%2e/i.test(url.pathname)
  ) {
    throw new DataProxyError('destination-denied', 403, 'Destination is not allowed')
  }
  return url
}

export const createServerOwnedHeaders = (policy, secret, hasBody) => {
  if (typeof secret !== 'string' || secret.length === 0 || hasUnsafeControlCharacters(secret)) {
    throw new DataProxyError('credential-unavailable', 503, 'Credential is unavailable')
  }
  const headers = { accept: 'application/json' }
  if (hasBody) headers['content-type'] = 'application/json'
  for (const [name, template] of Object.entries(policy.headerTemplate)) {
    headers[name] = template.replaceAll('{{secret}}', secret)
  }
  return headers
}
