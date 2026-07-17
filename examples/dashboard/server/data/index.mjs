import { createDataProxyHandler } from './handler.mjs'
import { createNodeDataProxyMiddleware } from './node-adapter.mjs'
import {
  createBearerPrincipalAuthorizer,
  createCookieSessionPrincipalAuthorizer,
  createCredentialRegistry,
  createDisabledCredentialRegistry,
  createHttpOnlySessionPrincipalAuthorizer,
  denyPrincipalAuthorizer,
} from './registry.mjs'

export { isForbiddenAddress, resolvePinnedDestination } from './address-policy.mjs'
export { createDataProxyHandler } from './handler.mjs'
export { createNodeDataProxyMiddleware, DATA_PROXY_ROUTE } from './node-adapter.mjs'
export { authorizeDestination, compileProviderPolicy, createServerOwnedHeaders } from './policy.mjs'
export {
  createBearerPrincipalAuthorizer,
  createCookieSessionPrincipalAuthorizer,
  createCredentialRegistry,
  createDisabledCredentialRegistry,
  createHttpOnlySessionPrincipalAuthorizer,
  denyPrincipalAuthorizer,
} from './registry.mjs'

const parseEnvironmentConfig = env => {
  if (!env.EASY_EDITOR_DATA_PROXY_CONFIG_JSON) return null
  try {
    const value = JSON.parse(env.EASY_EDITOR_DATA_PROXY_CONFIG_JSON)
    return hasOnlyKeys(value, ['auth', 'credentials']) ? value : null
  } catch {
    return null
  }
}

const hasOnlyKeys = (value, allowedKeys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every(key => allowedKeys.includes(key))

export const DATA_PROXY_ENABLED_ENV = 'EASY_EDITOR_DATA_PROXY_ENABLED'

export const isEnvironmentDataProxyEnabled = (env = process.env) => env[DATA_PROXY_ENABLED_ENV] === '1'

export const createEnvironmentDataProxyHandler = ({
  env = process.env,
  lookup,
  transport,
  logger,
  monotonicNow,
  now,
  resolveSessionPrincipal,
  totalTimeoutMs,
} = {}) => {
  const config = parseEnvironmentConfig(env)
  let authorizePrincipal = denyPrincipalAuthorizer
  let credentialRegistry = createDisabledCredentialRegistry()
  if (config && Array.isArray(config.credentials)) {
    try {
      credentialRegistry = createCredentialRegistry(config.credentials)
      if (config.auth?.mode === 'cookie-session' && hasOnlyKeys(config.auth, ['mode', 'cookieName', 'sessions'])) {
        authorizePrincipal = createCookieSessionPrincipalAuthorizer({
          cookieName: config.auth.cookieName,
          sessions: config.auth.sessions,
        })
      } else if (
        config.auth?.mode === 'external-session' &&
        hasOnlyKeys(config.auth, ['mode', 'cookieName']) &&
        typeof resolveSessionPrincipal === 'function'
      ) {
        authorizePrincipal = createHttpOnlySessionPrincipalAuthorizer({
          cookieName: config.auth.cookieName,
          resolveSessionPrincipal,
        })
      } else if (
        config.auth?.mode === 'bearer' &&
        hasOnlyKeys(config.auth, ['mode', 'principals']) &&
        Array.isArray(config.auth.principals)
      ) {
        authorizePrincipal = createBearerPrincipalAuthorizer(config.auth.principals)
      } else {
        throw new TypeError('Unsupported data proxy auth mode')
      }
    } catch {
      authorizePrincipal = denyPrincipalAuthorizer
      credentialRegistry = createDisabledCredentialRegistry()
    }
  }
  return createDataProxyHandler({
    authorizePrincipal,
    credentialRegistry,
    lookup,
    transport,
    logger,
    monotonicNow,
    now,
    totalTimeoutMs,
  })
}

export const createEnvironmentDataProxyMiddleware = (options = {}) => {
  const env = options.env ?? process.env
  if (!isEnvironmentDataProxyEnabled(env)) {
    return async (_request, _response, next) => {
      next?.()
      return false
    }
  }
  return createNodeDataProxyMiddleware({
    handler: options.handler ?? createEnvironmentDataProxyHandler({ ...options, env }),
    inboundTimeoutMs: options.inboundTimeoutMs,
    publicOrigins:
      options.publicOrigins ??
      env.EASY_EDITOR_PUBLIC_ORIGINS?.split(',')
        .map(value => value.trim())
        .filter(Boolean),
  })
}
