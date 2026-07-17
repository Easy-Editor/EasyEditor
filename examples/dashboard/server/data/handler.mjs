import http from 'node:http'
import https from 'node:https'
import { TextDecoder } from 'node:util'

import { resolvePinnedDestination } from './address-policy.mjs'
import { DataProxyError, createErrorEnvelope, toSafeError } from './errors.mjs'
import { authorizeDestination, createServerOwnedHeaders } from './policy.mjs'

const REQUEST_KEYS = new Set(['schemaVersion', 'projectId', 'providerId', 'credentialRef', 'url', 'method', 'body'])
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])
const DEFAULT_TOTAL_TIMEOUT_MS = 5000
const REFLECTION_SCAN_MAX_ITEMS = 50_000
const REFLECTION_SCAN_MAX_DECODE_DEPTH = 5
const REFLECTION_SCAN_MIN_CHARACTER_BUDGET = 256 * 1024
const REFLECTION_SCAN_MAX_CHARACTER_BUDGET = 64 * 1024 * 1024
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

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

const runWithAbortSignal = (operation, signal) => {
  if (signal.aborted) return Promise.reject(signal.reason)
  return withAbortSignal(Promise.resolve().then(operation), signal)
}

const requestTransport = ({ url, method, headers, body, signal, lookup, maxBytes }) =>
  new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.request(
      url,
      { method, headers, lookup, signal, autoSelectFamily: false, servername: url.hostname },
      response => {
        const chunks = []
        let bytes = 0
        response.on('data', chunk => {
          bytes += chunk.length
          if (bytes > maxBytes) {
            request.destroy(
              new DataProxyError('upstream-response-invalid', 502, 'Upstream response exceeded its byte limit'),
            )
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 502, headers: response.headers, body: Buffer.concat(chunks) }),
        )
      },
    )
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })

const normalizeHeaders = headers => {
  const result = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') result[name.toLowerCase()] = value
    else if (Array.isArray(value)) result[name.toLowerCase()] = value.join(', ')
  }
  return result
}

const parseRequest = request => {
  if (request.method !== 'POST' || request.path !== '/api/data/credentialed-json') {
    throw new DataProxyError('invalid-request', request.method === 'POST' ? 404 : 405, 'Request is not supported')
  }
  const headers = normalizeHeaders(request.headers)
  if (headers['content-type']?.toLowerCase() !== 'application/json') {
    throw new DataProxyError('invalid-request', 415, 'Content-Type must be application/json')
  }
  if (!request.expectedOrigins?.includes(headers.origin)) {
    throw new DataProxyError('invalid-request', 403, 'Request origin is not allowed')
  }
  let value
  try {
    value = JSON.parse(
      typeof request.body === 'string' ? request.body : Buffer.from(request.body ?? '').toString('utf8'),
    )
  } catch {
    throw new DataProxyError('invalid-request', 400, 'Request body must be valid JSON')
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !REQUEST_KEYS.has(key))
  ) {
    throw new DataProxyError('invalid-request', 400, 'Request body is invalid')
  }
  for (const key of ['projectId', 'providerId', 'credentialRef']) {
    if (typeof value[key] !== 'string' || !ID.test(value[key]))
      throw new DataProxyError('invalid-request', 400, 'Request body is invalid')
  }
  if (
    value.schemaVersion !== 1 ||
    (value.method !== 'GET' && value.method !== 'POST') ||
    typeof value.url !== 'string'
  ) {
    throw new DataProxyError('invalid-request', 400, 'Request body is invalid')
  }
  if (
    (value.method === 'GET' && Object.hasOwn(value, 'body')) ||
    (value.method === 'POST' && value.body === undefined && Object.hasOwn(value, 'body'))
  ) {
    throw new DataProxyError('invalid-request', 400, 'Request body is invalid')
  }
  return { headers, value }
}

const getContentType = headers => {
  const value = headers?.['content-type'] ?? headers?.['Content-Type']
  return Array.isArray(value) ? value[0] : value
}

const isJsonContentType = value =>
  typeof value === 'string' && /^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(value)

const countNestedRows = (value, maxRows) => {
  const stack = [value]
  let rows = 0
  while (stack.length > 0) {
    const current = stack.pop()
    if (Array.isArray(current)) {
      rows += current.length
      if (rows > maxRows) return rows
      for (const item of current) {
        if (item && typeof item === 'object') stack.push(item)
      }
      continue
    }
    if (current && typeof current === 'object') {
      for (const item of Object.values(current)) {
        if (item && typeof item === 'object') stack.push(item)
      }
    }
  }
  return Math.max(1, rows)
}

const reflectionScanError = () => new DataProxyError('upstream-response-invalid', 502, 'Upstream response was rejected')

const decodeUtf8 = bytes => {
  try {
    return utf8Decoder.decode(bytes)
  } catch {
    return null
  }
}

const decodeBase64 = value => {
  const compact = value.replace(/\s+/g, '')
  if (compact.length < 4 || compact.length % 4 === 1 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) {
    return null
  }
  const normalized = compact.replaceAll('-', '+').replaceAll('_', '/').replace(/=+$/, '')
  try {
    const bytes = Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64')
    if (bytes.toString('base64').replace(/=+$/, '') !== normalized) return null
    return decodeUtf8(bytes)
  } catch {
    return null
  }
}

const decodeHex = value => {
  const compact = value.replace(/\s+/g, '')
  if (compact.length < 2 || compact.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(compact)) return null
  return decodeUtf8(Buffer.from(compact, 'hex'))
}

const decodeEscapedCharacters = value => {
  let changed = false
  const decoded = value
    .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (match, codePoint) => {
      const value = Number.parseInt(codePoint, 16)
      if (value > 0x10ffff) return match
      changed = true
      return String.fromCodePoint(value)
    })
    .replace(/\\u([0-9a-f]{4})/gi, (_match, codePoint) => {
      changed = true
      return String.fromCharCode(Number.parseInt(codePoint, 16))
    })
    .replace(/\\x([0-9a-f]{2})/gi, (_match, byte) => {
      changed = true
      return String.fromCharCode(Number.parseInt(byte, 16))
    })
  return changed ? decoded : null
}

const responseContainsSensitiveData = (rawText, data, sensitiveValues) => {
  const targets = [...new Set(sensitiveValues)].filter(value => typeof value === 'string' && value.length > 0)
  if (targets.length === 0) return false
  const foldedTargets = targets.map(value => {
    const folded = value.toLocaleLowerCase('en-US')
    return { folded, compact: folded.replace(/\s+/g, '') }
  })
  const characterBudget = Math.min(
    REFLECTION_SCAN_MAX_CHARACTER_BUDGET,
    Math.max(REFLECTION_SCAN_MIN_CHARACTER_BUDGET, rawText.length * 8),
  )
  const candidates = []
  const seenCandidates = new Set()
  let consumedCharacters = 0
  let consumedItems = 0

  const consumeItem = () => {
    consumedItems += 1
    if (consumedItems > REFLECTION_SCAN_MAX_ITEMS) throw reflectionScanError()
  }
  const enqueueCandidate = (value, depth = 0) => {
    if (typeof value !== 'string' || value.length === 0 || depth > REFLECTION_SCAN_MAX_DECODE_DEPTH) return
    const key = `${depth}\u0000${value}`
    if (seenCandidates.has(key)) return
    consumeItem()
    consumedCharacters += value.length
    if (consumedCharacters > characterBudget) throw reflectionScanError()
    seenCandidates.add(key)
    candidates.push({ value, depth })
  }
  const collectValueCandidates = (root, depth = 0) => {
    const stack = [root]
    const globalStrings = []
    const globalCharacters = []
    const globalBytes = []
    const globalKeys = []
    const globalOrderedScalars = []
    while (stack.length > 0) {
      consumeItem()
      const current = stack.pop()
      if (typeof current === 'string') {
        enqueueCandidate(current, depth)
        globalStrings.push(current)
        if ([...current].length === 1) globalCharacters.push(current)
        continue
      }
      if (Number.isInteger(current) && current >= 0 && current <= 255) {
        globalBytes.push(current)
        continue
      }
      if (!current || typeof current !== 'object') continue
      const entries = Array.isArray(current)
        ? current.map((value, index) => [String(index), value])
        : Object.entries(current)
      const directStrings = []
      const directCharacters = []
      const directBytes = []
      const directKeys = []
      const directOrderedScalars = []
      for (const [key, value] of entries) {
        if (!Array.isArray(current)) {
          enqueueCandidate(key, depth)
          directKeys.push(key)
          directOrderedScalars.push(key)
          globalKeys.push(key)
          globalOrderedScalars.push(key)
        }
        if (typeof value === 'string') {
          directStrings.push(value)
          directOrderedScalars.push(value)
          globalOrderedScalars.push(value)
          if ([...value].length === 1) directCharacters.push(value)
        } else if (Number.isInteger(value) && value >= 0 && value <= 255) {
          directBytes.push(value)
        }
      }
      if (directStrings.length > 1) enqueueCandidate(directStrings.join(''), depth)
      if (directCharacters.length > 1) enqueueCandidate(directCharacters.join(''), depth)
      if (directBytes.length > 1) enqueueCandidate(decodeUtf8(Buffer.from(directBytes)), depth)
      if (directKeys.length > 1) enqueueCandidate(directKeys.join(''), depth)
      if (directOrderedScalars.length > 1) enqueueCandidate(directOrderedScalars.join(''), depth)
      for (let index = entries.length - 1; index >= 0; index -= 1) stack.push(entries[index][1])
    }
    if (globalStrings.length > 1) enqueueCandidate(globalStrings.join(''), depth)
    if (globalCharacters.length > 1) enqueueCandidate(globalCharacters.join(''), depth)
    if (globalBytes.length > 1) enqueueCandidate(decodeUtf8(Buffer.from(globalBytes)), depth)
    if (globalKeys.length > 1) enqueueCandidate(globalKeys.join(''), depth)
    if (globalOrderedScalars.length > 1) enqueueCandidate(globalOrderedScalars.join(''), depth)
  }

  enqueueCandidate(rawText)
  collectValueCandidates(data)
  for (let index = 0; index < candidates.length; index += 1) {
    consumeItem()
    const { value, depth } = candidates[index]
    const compact = value.replace(/\s+/g, '')
    const folded = value.toLocaleLowerCase('en-US')
    const foldedCompact = compact.toLocaleLowerCase('en-US')
    if (
      foldedTargets.some(
        target => folded.includes(target.folded) || (target.compact && foldedCompact.includes(target.compact)),
      )
    ) {
      return true
    }
    if (depth >= REFLECTION_SCAN_MAX_DECODE_DEPTH) continue
    const nextDepth = depth + 1
    if (value.includes('%') || value.includes('+')) {
      try {
        enqueueCandidate(decodeURIComponent(value.replaceAll('+', '%20')), nextDepth)
      } catch {
        // Invalid percent encodings are not useful decoder inputs.
      }
    }
    enqueueCandidate(decodeEscapedCharacters(value), nextDepth)
    enqueueCandidate(decodeBase64(value), nextDepth)
    enqueueCandidate(decodeHex(value), nextDepth)
    if (/^[\[{\"]/.test(value.trim())) {
      try {
        collectValueCandidates(JSON.parse(value), nextDepth)
      } catch {
        // Non-JSON strings remain covered by the other bounded decoders.
      }
    }
  }
  return false
}

const serializeBody = (value, limit) => {
  if (!Object.hasOwn(value, 'body')) return undefined
  let body
  try {
    body = Buffer.from(JSON.stringify(value.body))
  } catch {
    throw new DataProxyError('invalid-request', 400, 'Request body is invalid')
  }
  if (body.length > limit) throw new DataProxyError('invalid-request', 413, 'Request body exceeded its byte limit')
  return body
}

export const createDataProxyHandler = ({
  authorizePrincipal,
  credentialRegistry,
  lookup,
  transport = requestTransport,
  logger = { info() {}, warn() {} },
  now = Date.now,
  monotonicNow = () => performance.now(),
  totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
}) => ({
  async handle(request) {
    let providerId
    const startedAt = now()
    const deadlineStartedAt = monotonicNow()
    const controller = new AbortController()
    let deadlineExpired = false
    let policyTimeout
    const expireDeadline = () => {
      deadlineExpired = true
      controller.abort(new Error('deadline'))
    }
    const totalTimeout = setTimeout(expireDeadline, totalTimeoutMs)
    const onAbort = () => controller.abort(request.signal?.reason)
    if (request.signal?.aborted) onAbort()
    else request.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const { headers, value } = parseRequest(request)
      providerId = value.providerId
      const principal = await runWithAbortSignal(
        () => authorizePrincipal({ headers, projectId: value.projectId }),
        controller.signal,
      )
      const credential = await runWithAbortSignal(
        () =>
          credentialRegistry.resolveBinding({
            principal,
            projectId: value.projectId,
            providerId: value.providerId,
            credentialRef: value.credentialRef,
          }),
        controller.signal,
      )
      const policyRemainingMs = credential.policy.limits.timeoutMs - (monotonicNow() - deadlineStartedAt)
      if (policyRemainingMs <= 0) expireDeadline()
      else policyTimeout = setTimeout(expireDeadline, policyRemainingMs)
      let url = authorizeDestination(credential.policy, value.url, value.method)
      const outboundBody = serializeBody(value, credential.policy.limits.maxRequestBytes)
      let response
      let hops = 0
      const sensitiveValues = new Set()
      while (true) {
        const pinned = await runWithAbortSignal(() => resolvePinnedDestination(url, lookup), controller.signal)
        const secret = await runWithAbortSignal(
          () => credentialRegistry.readSecret(credential.handle),
          controller.signal,
        )
        sensitiveValues.add(secret)
        const outboundHeaders = createServerOwnedHeaders(credential.policy, secret, Boolean(outboundBody))
        for (const name of Object.keys(credential.policy.headerTemplate)) {
          sensitiveValues.add(outboundHeaders[name])
        }
        response = await runWithAbortSignal(
          () =>
            transport({
              url,
              method: value.method,
              headers: outboundHeaders,
              body: outboundBody,
              signal: controller.signal,
              lookup: pinned.lookup,
              maxBytes: credential.policy.limits.maxResponseBytes,
            }),
          controller.signal,
        )
        if (!REDIRECT_STATUS.has(response.status)) break
        if (
          !credential.policy.redirect.enabled ||
          hops >= credential.policy.redirect.maxHops ||
          (value.method === 'POST' && response.status < 307)
        ) {
          throw new DataProxyError('destination-denied', 403, 'Redirect destination is not allowed')
        }
        const location = response.headers?.location ?? response.headers?.Location
        if (typeof location !== 'string')
          throw new DataProxyError('upstream-response-invalid', 502, 'Upstream redirect was invalid')
        url = authorizeDestination(credential.policy, new URL(location, url).href, value.method)
        hops += 1
      }
      if (response.status < 200 || response.status > 299) {
        throw new DataProxyError(
          'upstream-failed',
          502,
          'Upstream request failed',
          response.status === 429 || response.status >= 500,
        )
      }
      const bytes = Buffer.byteLength(response.body)
      if (bytes > credential.policy.limits.maxResponseBytes || !isJsonContentType(getContentType(response.headers))) {
        throw new DataProxyError('upstream-response-invalid', 502, 'Upstream response was not valid JSON')
      }
      let data
      const rawText = decodeUtf8(Buffer.from(response.body))
      if (rawText === null) {
        throw new DataProxyError('upstream-response-invalid', 502, 'Upstream response was not valid JSON')
      }
      try {
        data = JSON.parse(rawText)
      } catch {
        throw new DataProxyError('upstream-response-invalid', 502, 'Upstream response was not valid JSON')
      }
      if (responseContainsSensitiveData(rawText, data, sensitiveValues)) {
        throw new DataProxyError('upstream-response-invalid', 502, 'Upstream response was rejected')
      }
      const rows = countNestedRows(data, credential.policy.limits.maxRows)
      if (rows > credential.policy.limits.maxRows) {
        throw new DataProxyError('upstream-response-invalid', 502, 'Upstream response exceeded its row limit')
      }
      logger.info({ event: 'data-proxy-request-complete', status: response.status, bytes, rows })
      return {
        status: 200,
        body: {
          schemaVersion: 1,
          data,
          diagnostics: { status: response.status, rows, bytes, durationMs: Math.max(0, now() - startedAt), providerId },
        },
      }
    } catch (error) {
      const safe = toSafeError(
        deadlineExpired
          ? new DataProxyError('upstream-timeout', 504, 'Upstream request timed out', true)
          : request.signal?.aborted
            ? new DataProxyError('request-aborted', 408, 'Request was aborted', true)
            : error,
      )
      logger.warn({ event: 'data-proxy-request-failed', code: safe.code })
      return createErrorEnvelope(safe)
    } finally {
      clearTimeout(totalTimeout)
      clearTimeout(policyTimeout)
      request.signal?.removeEventListener('abort', onAbort)
    }
  },
})
