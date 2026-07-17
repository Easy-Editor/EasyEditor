import { createHash, timingSafeEqual } from 'node:crypto'

import { DataProxyError } from './errors.mjs'
import { compileProviderPolicy } from './policy.mjs'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/
const SESSION_ID = /^[A-Za-z0-9._~+/=-]{1,4096}$/
const bindingKey = binding =>
  [binding.tenantId, binding.userId, binding.projectId, binding.providerId, binding.credentialRef].join('\u0000')

const assertId = value => {
  if (typeof value !== 'string' || !ID.test(value))
    throw new DataProxyError('credential-unavailable', 503, 'Credential is unavailable')
}

export const createCredentialRegistry = (entries = []) => {
  const records = new Map()
  const revoked = new Set()
  for (const entry of entries) {
    for (const key of ['tenantId', 'userId', 'projectId', 'providerId', 'credentialRef']) assertId(entry?.[key])
    if (typeof entry.secret !== 'string' || entry.secret.length === 0) {
      throw new DataProxyError('credential-unavailable', 503, 'Credential is unavailable')
    }
    const record = { ...entry, policy: compileProviderPolicy(entry.policy) }
    records.set(bindingKey(record), record)
  }
  return Object.freeze({
    async resolveBinding({ principal, projectId, providerId, credentialRef }) {
      const key = bindingKey({
        tenantId: principal.tenantId,
        userId: principal.userId,
        projectId,
        providerId,
        credentialRef,
      })
      const record = records.get(key)
      if (!record || revoked.has(key))
        throw new DataProxyError('credential-unavailable', 403, 'Credential is unavailable')
      return { handle: key, policy: record.policy }
    },
    async readSecret(handle) {
      const record = records.get(handle)
      if (!record || revoked.has(handle))
        throw new DataProxyError('credential-unavailable', 403, 'Credential is unavailable')
      return record.secret
    },
    revoke(binding) {
      revoked.add(bindingKey(binding))
    },
  })
}

export const createDisabledCredentialRegistry = () => ({
  async resolveBinding() {
    throw new DataProxyError('credential-unavailable', 503, 'Credential broker is unavailable')
  },
  async readSecret() {
    throw new DataProxyError('credential-unavailable', 503, 'Credential broker is unavailable')
  },
})

const invalidAuthorizerConfig = () =>
  new DataProxyError('credential-unavailable', 503, 'Credential broker is unavailable')

const safeTokenEqual = (actual, expected) => {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false
  const digest = value => createHash('sha256').update(value, 'utf8').digest()
  return timingSafeEqual(digest(actual), digest(expected))
}

export const createBearerPrincipalAuthorizer = (principals = []) => {
  if (!Array.isArray(principals) || principals.length === 0) throw invalidAuthorizerConfig()
  const records = []
  const configuredTokens = new Set()
  for (const principal of principals) {
    if (
      !principal ||
      typeof principal !== 'object' ||
      Array.isArray(principal) ||
      Object.keys(principal).some(key => !['token', 'tenantId', 'userId', 'projectIds'].includes(key)) ||
      !SESSION_ID.test(principal.token ?? '') ||
      configuredTokens.has(principal.token) ||
      !ID.test(principal.tenantId ?? '') ||
      !ID.test(principal.userId ?? '') ||
      !Array.isArray(principal.projectIds) ||
      principal.projectIds.length === 0 ||
      principal.projectIds.some(projectId => !ID.test(projectId))
    ) {
      throw invalidAuthorizerConfig()
    }
    configuredTokens.add(principal.token)
    records.push({ ...principal, projectIds: new Set(principal.projectIds) })
  }
  return async ({ headers, projectId }) => {
    const authorization = headers.authorization
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      throw new DataProxyError('unauthorized', 401, 'Request is not authorized')
    }
    const token = authorization.slice(7)
    let principal
    for (const record of records) {
      if (safeTokenEqual(token, record.token)) principal = record
    }
    if (!principal || !principal.projectIds.has(projectId)) {
      throw new DataProxyError('unauthorized', 403, 'Request is not authorized')
    }
    return { tenantId: principal.tenantId, userId: principal.userId }
  }
}

const unauthorized = () => new DataProxyError('unauthorized', 401, 'Request is not authorized')

const readSessionCookie = (headers, cookieName) => {
  const cookie = headers.cookie
  if (typeof cookie !== 'string' || cookie.length > 8192 || /[\r\n]/.test(cookie)) throw unauthorized()
  let sessionId
  for (const segment of cookie.split(';')) {
    const separator = segment.indexOf('=')
    if (separator < 1) continue
    const name = segment.slice(0, separator).trim()
    if (name !== cookieName) continue
    if (sessionId !== undefined) throw unauthorized()
    sessionId = segment.slice(separator + 1).trim()
  }
  if (!sessionId || !SESSION_ID.test(sessionId)) throw unauthorized()
  return sessionId
}

export const createCookieSessionPrincipalAuthorizer = ({ cookieName = 'easy-editor-session', sessions = [] } = {}) => {
  if (!COOKIE_NAME.test(cookieName) || !Array.isArray(sessions) || sessions.length === 0) {
    throw invalidAuthorizerConfig()
  }
  const records = []
  const configuredTokens = new Set()
  for (const session of sessions) {
    if (
      !session ||
      typeof session !== 'object' ||
      Array.isArray(session) ||
      Object.keys(session).some(key => !['token', 'tenantId', 'userId', 'projectIds'].includes(key)) ||
      !SESSION_ID.test(session.token ?? '') ||
      configuredTokens.has(session.token) ||
      !ID.test(session.tenantId ?? '') ||
      !ID.test(session.userId ?? '') ||
      !Array.isArray(session.projectIds) ||
      session.projectIds.length === 0 ||
      session.projectIds.some(projectId => !ID.test(projectId))
    ) {
      throw invalidAuthorizerConfig()
    }
    configuredTokens.add(session.token)
    records.push({
      token: session.token,
      tenantId: session.tenantId,
      userId: session.userId,
      projectIds: new Set(session.projectIds),
    })
  }
  return async ({ headers, projectId }) => {
    const token = readSessionCookie(headers, cookieName)
    let principal
    for (const record of records) {
      if (safeTokenEqual(token, record.token)) principal = record
    }
    if (!principal || !principal.projectIds.has(projectId)) {
      throw new DataProxyError('unauthorized', 403, 'Request is not authorized')
    }
    return { tenantId: principal.tenantId, userId: principal.userId }
  }
}

export const createHttpOnlySessionPrincipalAuthorizer = ({
  cookieName = 'easy-editor-session',
  resolveSessionPrincipal,
} = {}) => {
  if (!COOKIE_NAME.test(cookieName) || typeof resolveSessionPrincipal !== 'function') {
    return async () => {
      throw unauthorized()
    }
  }
  return async ({ headers, projectId }) => {
    const sessionId = readSessionCookie(headers, cookieName)
    let principal
    try {
      principal = await resolveSessionPrincipal({ sessionId, projectId })
    } catch {
      throw unauthorized()
    }
    if (
      !principal ||
      typeof principal !== 'object' ||
      Array.isArray(principal) ||
      !ID.test(principal.tenantId ?? '') ||
      !ID.test(principal.userId ?? '') ||
      !Array.isArray(principal.projectIds) ||
      !principal.projectIds.includes(projectId)
    ) {
      throw unauthorized()
    }
    return { tenantId: principal.tenantId, userId: principal.userId }
  }
}

export const denyPrincipalAuthorizer = async () => {
  throw new DataProxyError('unauthorized', 401, 'Request is not authorized')
}
