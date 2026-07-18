import { join } from 'node:path'

import {
  createBearerPrincipalAuthorizer,
  createCookieSessionPrincipalAuthorizer,
  createHttpOnlySessionPrincipalAuthorizer,
  denyPrincipalAuthorizer,
} from '../data/registry.mjs'
import { createMaterialPromotionCoordinator } from './coordinator.mjs'
import { createEasypackTrustedWrapperAuthor } from './easypack-author.mjs'
import { createFileMaterialRegistry } from './file-material-registry.mjs'
import {
  MATERIAL_CATALOG_LIST_ROUTE,
  MATERIAL_CATALOG_READ_ROUTE,
  MATERIAL_PROMOTION_AVAILABILITY_ROUTE,
  MATERIAL_PROMOTION_MAX_INBOUND_BYTES,
  MATERIAL_PROMOTION_QUERY_ROUTE,
  MATERIAL_PROMOTION_ROUTE,
  createDisabledMaterialPromotionHandler,
  createMaterialPromotionHandler,
} from './handler.mjs'
import { createNodeMaterialPromotionMiddleware } from './node-adapter.mjs'
import { runPromotionPhase, throwIfPromotionAborted, unavailablePromotion } from './promotion-error.mjs'

export { createMaterialPromotionCoordinator } from './coordinator.mjs'
export { createEasypackTrustedWrapperAuthor } from './easypack-author.mjs'
export { createFileMaterialRegistry } from './file-material-registry.mjs'
export {
  MATERIAL_CATALOG_COMPONENT_NAME,
  MATERIAL_CATALOG_SCHEMA_VERSION,
  createMaterialCatalogItem,
  createMaterialCatalogListResponse,
  validateMaterialCatalogItem,
  validateMaterialCatalogListResponse,
} from '../../shared/material-catalog-contract.mjs'
export {
  MATERIAL_CATALOG_LIST_ROUTE,
  MATERIAL_CATALOG_READ_ROUTE,
  MATERIAL_PROMOTION_AVAILABILITY_ROUTE,
  MATERIAL_PROMOTION_MAX_INBOUND_BYTES,
  MATERIAL_PROMOTION_QUERY_ROUTE,
  MATERIAL_PROMOTION_ROUTE,
  createDisabledMaterialPromotionHandler,
  createMaterialPromotionHandler,
} from './handler.mjs'
export { createNodeMaterialPromotionMiddleware } from './node-adapter.mjs'
export {
  MaterialPromotionError,
  createPromotionErrorEnvelope,
  normalizePromotionError,
} from './promotion-error.mjs'

export const MATERIAL_PROMOTION_ENABLED_ENV = 'EASY_EDITOR_MATERIAL_PROMOTION_ENABLED'
export const MATERIAL_PROMOTION_CONFIG_ENV = 'EASY_EDITOR_MATERIAL_PROMOTION_CONFIG_JSON'

export const isEnvironmentMaterialPromotionEnabled = (env = process.env) => env[MATERIAL_PROMOTION_ENABLED_ENV] === '1'

const hasOnlyKeys = (value, keys) =>
  value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))

const readAuthConfig = env => {
  const source = env[MATERIAL_PROMOTION_CONFIG_ENV] ?? env.EASY_EDITOR_DATA_PROXY_CONFIG_JSON
  if (typeof source !== 'string') return null
  try {
    const config = JSON.parse(source)
    if (!hasOnlyKeys(config, ['auth', 'credentials'])) return null
    return config.auth ?? null
  } catch {
    return null
  }
}

const createEnvironmentPrincipalAuthorizer = ({ env, resolveSessionPrincipal }) => {
  const auth = readAuthConfig(env)
  try {
    if (auth?.mode === 'bearer' && hasOnlyKeys(auth, ['mode', 'principals']) && Array.isArray(auth.principals)) {
      return createBearerPrincipalAuthorizer(auth.principals)
    }
    if (
      auth?.mode === 'cookie-session' &&
      hasOnlyKeys(auth, ['mode', 'cookieName', 'sessions']) &&
      Array.isArray(auth.sessions)
    ) {
      return createCookieSessionPrincipalAuthorizer({ cookieName: auth.cookieName, sessions: auth.sessions })
    }
    if (
      auth?.mode === 'external-session' &&
      hasOnlyKeys(auth, ['mode', 'cookieName']) &&
      typeof resolveSessionPrincipal === 'function'
    ) {
      return createHttpOnlySessionPrincipalAuthorizer({
        cookieName: auth.cookieName,
        resolveSessionPrincipal,
      })
    }
  } catch {
    return denyPrincipalAuthorizer
  }
  return denyPrincipalAuthorizer
}

export const createEnvironmentMaterialPromotionHandler = (options = {}) => {
  const env = options.env ?? process.env
  if (!isEnvironmentMaterialPromotionEnabled(env)) return createDisabledMaterialPromotionHandler()
  const dashboardDataRoot = env.EASY_EDITOR_DASHBOARD_DATA_DIR ?? join(process.cwd(), '.easy-editor-data')
  const workspaceRoot =
    options.workspaceRoot ??
    env.EASY_EDITOR_MATERIAL_PROMOTION_WORKSPACE_DIR ??
    join(dashboardDataRoot, 'promotion-workspaces')
  const author =
    options.author ??
    createEasypackTrustedWrapperAuthor({
      workspaceRoot,
      nodeVersion: options.nodeVersion,
      loadEasypack: options.loadEasypack,
      now: options.now,
    })

  let initializedCoordinator
  let initializedRegistry
  let initialization
  let recovery
  const initialize = async ({ recover = false } = {}) => {
    if (!initializedCoordinator) {
      initialization ??= (async () => {
        const registry =
          options.registry ??
          (await (options.createRegistry ?? createFileMaterialRegistry)({
            rootDir:
              options.registryRoot ?? env.EASY_EDITOR_MATERIAL_REGISTRY_DIR ?? join(dashboardDataRoot, 'materials'),
            workspaceRoot,
          }))
        initializedRegistry = registry
        initializedCoordinator = createMaterialPromotionCoordinator({
          authorizePrincipal:
            options.authorizePrincipal ??
            createEnvironmentPrincipalAuthorizer({ env, resolveSessionPrincipal: options.resolveSessionPrincipal }),
          author,
          registry,
        })
        return initializedCoordinator
      })()
      await initialization
    }
    if (recover && typeof initializedRegistry.recoverPendingPromotions === 'function') {
      recovery ??= initializedRegistry.recoverPendingPromotions()
      await recovery
    }
    return initializedCoordinator
  }

  const runWithInitializedCoordinator = async (method, input, { recover = false } = {}) => {
    const signal = input?.signal
    throwIfPromotionAborted(signal)
    let coordinator
    try {
      coordinator = await runPromotionPhase(() => initialize({ recover }), signal)
    } catch (error) {
      throwIfPromotionAborted(signal)
      if (error?.code === 'promotion-aborted') throw error
      throw unavailablePromotion()
    }
    throwIfPromotionAborted(signal)
    return coordinator[method](input)
  }

  return createMaterialPromotionHandler({
    coordinator: Object.freeze({
      promote: input => runWithInitializedCoordinator('promote', input, { recover: true }),
      query: input => runWithInitializedCoordinator('query', input),
      listCatalog: input => runWithInitializedCoordinator('listCatalog', input),
      readCatalog: input => runWithInitializedCoordinator('readCatalog', input),
    }),
    checkAvailability:
      typeof author.checkAvailability === 'function'
        ? options => author.checkAvailability(options)
        : async () => ({ schemaVersion: 1, available: true, reason: 'ready', minimumNodeMajor: 20 }),
  })
}

export const createEnvironmentMaterialPromotionMiddleware = (options = {}) => {
  const env = options.env ?? process.env
  return createNodeMaterialPromotionMiddleware({
    handler: options.handler ?? createEnvironmentMaterialPromotionHandler({ ...options, env }),
    inboundTimeoutMs: options.inboundTimeoutMs,
    operationTimeoutMs: options.operationTimeoutMs,
    publicOrigins:
      options.publicOrigins ??
      env.EASY_EDITOR_PUBLIC_ORIGINS?.split(',')
        .map(value => value.trim())
        .filter(Boolean),
  })
}
