import {
  createBearerPrincipalAuthorizer,
  createCookieSessionPrincipalAuthorizer,
  createHttpOnlySessionPrincipalAuthorizer,
  denyPrincipalAuthorizer,
} from '../data/registry.mjs'
import { createModelGatewayHandler } from './handler.mjs'
import { createNodeModelGatewayMiddleware } from './node-adapter.mjs'
import { createOpenAICompatibleProviderTransport } from './openai-provider.mjs'
import { createModelGatewayVitePlugin } from './vite-adapter.mjs'

export * from './contract.mjs'
export * from './handler.mjs'
export * from './node-adapter.mjs'
export * from './openai-provider.mjs'
export * from './vite-adapter.mjs'

export const AGENT_MODEL_GATEWAY_ENABLED_ENV = 'EASY_EDITOR_AGENT_GATEWAY_ENABLED'
export const AGENT_MODEL_GATEWAY_CONFIG_ENV = 'EASY_EDITOR_AGENT_GATEWAY_CONFIG_JSON'
export const AGENT_MODEL_GATEWAY_BASE_URL_ENV = 'EASY_EDITOR_AGENT_BASE_URL'
export const AGENT_MODEL_GATEWAY_API_KEY_ENV = 'EASY_EDITOR_AGENT_API_KEY'
export const AGENT_MODEL_GATEWAY_MODEL_ENV = 'EASY_EDITOR_AGENT_MODEL'
export const AGENT_MODEL_GATEWAY_PROVIDER_ID_ENV = 'EASY_EDITOR_AGENT_PROVIDER_ID'
export const AGENT_MODEL_GATEWAY_SESSION_COOKIE_NAME_ENV = 'EASY_EDITOR_AGENT_SESSION_COOKIE_NAME'
export const AGENT_MODEL_GATEWAY_SESSION_TOKEN_ENV = 'EASY_EDITOR_AGENT_SESSION_TOKEN'
export const AGENT_MODEL_GATEWAY_PROJECT_ID_ENV = 'EASY_EDITOR_AGENT_PROJECT_ID'

const DEFAULT_FLAT_PROVIDER_ID = 'default'
const DEFAULT_FLAT_SESSION_COOKIE = 'easy-editor-agent-session'

const CONFIG_KEYS = new Set(['auth', 'providers'])
const PROVIDER_KEYS = new Set(['providerId', 'baseUrl', 'apiKey', 'defaultModel', 'models', 'timeoutMs'])
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

class ProviderRoutingError extends Error {
  constructor(code, status, message, retryable = false) {
    super(message)
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

const exactRecord = (value, keys) =>
  value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key))

const exactKeys = (value, keys) => exactRecord(value, keys) && Object.keys(value).length === keys.size

const validateConfig = config => {
  if (!exactKeys(config, CONFIG_KEYS) || !Array.isArray(config.providers) || config.providers.length === 0) return null
  const seen = new Set()
  for (const provider of config.providers) {
    if (
      !exactRecord(provider, PROVIDER_KEYS) ||
      !Object.hasOwn(provider, 'providerId') ||
      !Object.hasOwn(provider, 'baseUrl') ||
      !Object.hasOwn(provider, 'apiKey') ||
      !ID.test(provider.providerId ?? '') ||
      typeof provider.baseUrl !== 'string' ||
      provider.baseUrl.length === 0 ||
      typeof provider.apiKey !== 'string' ||
      provider.apiKey.length === 0 ||
      seen.has(provider.providerId)
    ) {
      return null
    }
    seen.add(provider.providerId)
    if (
      (provider.defaultModel !== undefined && !ID.test(provider.defaultModel)) ||
      (provider.timeoutMs !== undefined && (!Number.isInteger(provider.timeoutMs) || provider.timeoutMs < 1)) ||
      (provider.models !== undefined &&
        (!Array.isArray(provider.models) ||
          provider.models.length === 0 ||
          provider.models.some(model => !ID.test(model ?? '')) ||
          new Set(provider.models).size !== provider.models.length)) ||
      (provider.defaultModel !== undefined &&
        provider.models !== undefined &&
        !provider.models.includes(provider.defaultModel))
    ) {
      return null
    }
  }
  return config
}

const parseJsonConfig = source => {
  if (typeof source !== 'string') return null
  try {
    return validateConfig(JSON.parse(source))
  } catch {
    return null
  }
}

const flatSessionAuth = env => {
  const token = env[AGENT_MODEL_GATEWAY_SESSION_TOKEN_ENV]
  const projectId = env[AGENT_MODEL_GATEWAY_PROJECT_ID_ENV]
  if (typeof token !== 'string' || token.length === 0 || typeof projectId !== 'string' || projectId.length === 0) {
    return undefined
  }
  return {
    mode: 'cookie-session',
    cookieName: env[AGENT_MODEL_GATEWAY_SESSION_COOKIE_NAME_ENV] ?? DEFAULT_FLAT_SESSION_COOKIE,
    sessions: [
      {
        token,
        tenantId: 'local',
        userId: 'local',
        projectIds: [projectId],
      },
    ],
  }
}

const parseFlatConfig = env => {
  const baseUrl = env[AGENT_MODEL_GATEWAY_BASE_URL_ENV]
  const apiKey = env[AGENT_MODEL_GATEWAY_API_KEY_ENV]
  const model = env[AGENT_MODEL_GATEWAY_MODEL_ENV]
  if (
    typeof baseUrl !== 'string' ||
    baseUrl.length === 0 ||
    typeof apiKey !== 'string' ||
    apiKey.length === 0 ||
    typeof model !== 'string' ||
    !ID.test(model)
  ) {
    return null
  }
  return validateConfig({
    auth: flatSessionAuth(env),
    providers: [
      {
        providerId: env[AGENT_MODEL_GATEWAY_PROVIDER_ID_ENV] ?? DEFAULT_FLAT_PROVIDER_ID,
        baseUrl,
        apiKey,
        defaultModel: model,
        models: [model],
      },
    ],
  })
}

const parseConfig = env =>
  Object.hasOwn(env, AGENT_MODEL_GATEWAY_CONFIG_ENV)
    ? parseJsonConfig(env[AGENT_MODEL_GATEWAY_CONFIG_ENV])
    : parseFlatConfig(env)

const createAuthorizer = ({ auth, resolveSessionPrincipal }) => {
  try {
    if (auth?.mode === 'bearer' && exactKeys(auth, new Set(['mode', 'principals'])) && Array.isArray(auth.principals)) {
      return createBearerPrincipalAuthorizer(auth.principals)
    }
    if (
      auth?.mode === 'cookie-session' &&
      exactKeys(auth, new Set(['mode', 'cookieName', 'sessions'])) &&
      Array.isArray(auth.sessions)
    ) {
      return createCookieSessionPrincipalAuthorizer({ cookieName: auth.cookieName, sessions: auth.sessions })
    }
    if (
      auth?.mode === 'external-session' &&
      exactKeys(auth, new Set(['mode', 'cookieName'])) &&
      typeof resolveSessionPrincipal === 'function'
    ) {
      return createHttpOnlySessionPrincipalAuthorizer({ cookieName: auth.cookieName, resolveSessionPrincipal })
    }
  } catch {
    return denyPrincipalAuthorizer
  }
  return denyPrincipalAuthorizer
}

const unavailableProviderTransport = Object.freeze({
  async stream() {
    throw new ProviderRoutingError('PROVIDER_UNAVAILABLE', 503, 'Model provider is unavailable', true)
  },
})

const createProviderRouter = ({ config, fetchImpl }) => {
  if (!config) return unavailableProviderTransport
  try {
    const providers = new Map(
      config.providers.map(provider => [
        provider.providerId,
        {
          models: provider.models ? new Set(provider.models) : null,
          transport: createOpenAICompatibleProviderTransport({
            fetchImpl,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            defaultModel: provider.defaultModel,
            timeoutMs: provider.timeoutMs,
          }),
        },
      ]),
    )
    return Object.freeze({
      async stream(input) {
        const provider = providers.get(input.request.providerId)
        if (!provider)
          throw new ProviderRoutingError('PROVIDER_UNAVAILABLE', 503, 'Model provider is unavailable', true)
        if (provider.models && !provider.models.has(input.request.model)) {
          throw new ProviderRoutingError('PROVIDER_REJECTED', 422, 'Model provider rejected the request')
        }
        return provider.transport.stream(input)
      },
    })
  } catch {
    return unavailableProviderTransport
  }
}

export const isEnvironmentModelGatewayEnabled = (env = process.env) => env[AGENT_MODEL_GATEWAY_ENABLED_ENV] === '1'

export const createEnvironmentModelGatewayHandler = (options = {}) => {
  if (options.handler) return options.handler
  const env = options.env ?? process.env
  const config = parseConfig(env)
  return createModelGatewayHandler({
    authorizePrincipal:
      options.authorizePrincipal ??
      (config
        ? createAuthorizer({ auth: config.auth, resolveSessionPrincipal: options.resolveSessionPrincipal })
        : denyPrincipalAuthorizer),
    providerTransport: options.providerTransport ?? createProviderRouter({ config, fetchImpl: options.fetchImpl }),
    maxConcurrent: options.maxConcurrent,
    timeoutMs: options.timeoutMs,
    logger: options.logger,
  })
}

export const createEnvironmentModelGatewayMiddleware = (options = {}) => {
  const env = options.env ?? process.env
  if (!isEnvironmentModelGatewayEnabled(env)) {
    return async (_request, _response, next) => {
      next?.()
      return false
    }
  }
  return createNodeModelGatewayMiddleware({
    handler: options.handler ?? createEnvironmentModelGatewayHandler({ ...options, env }),
    inboundTimeoutMs: options.inboundTimeoutMs,
    publicOrigins:
      options.publicOrigins ??
      env.EASY_EDITOR_PUBLIC_ORIGINS?.split(',')
        .map(value => value.trim())
        .filter(Boolean),
  })
}

const localViteSession = env => {
  if (!isEnvironmentModelGatewayEnabled(env) || Object.hasOwn(env, AGENT_MODEL_GATEWAY_CONFIG_ENV)) return undefined
  const config = parseFlatConfig(env)
  if (config?.auth?.mode !== 'cookie-session') return undefined
  try {
    createCookieSessionPrincipalAuthorizer(config.auth)
  } catch {
    return undefined
  }
  return Object.freeze({ cookieName: config.auth.cookieName, token: config.auth.sessions[0].token })
}

export const createEnvironmentModelGatewayVitePlugin = (options = {}) => {
  const env = options.env ?? process.env
  return createModelGatewayVitePlugin(createEnvironmentModelGatewayMiddleware({ ...options, env }), {
    localSession: localViteSession(env),
  })
}
