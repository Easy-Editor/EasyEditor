import { join } from 'node:path'

import {
  createBearerPrincipalAuthorizer,
  createCookieSessionPrincipalAuthorizer,
  createHttpOnlySessionPrincipalAuthorizer,
  denyPrincipalAuthorizer,
} from '../data/registry.mjs'
import { createMaterialGcCoordinator, createMaterialPromotionCoordinator } from './coordinator.mjs'
import { createEasypackTrustedWrapperAuthor } from './easypack-author.mjs'
import { createFileMaterialRegistry } from './file-material-registry.mjs'
import {
  MATERIAL_CATALOG_LIST_ROUTE,
  MATERIAL_CATALOG_READ_ROUTE,
  MATERIAL_GC_PLAN_ROUTE,
  MATERIAL_GC_RELEASE_ROUTE,
  MATERIAL_GC_SWEEP_ROUTE,
  MATERIAL_PROMOTION_AVAILABILITY_ROUTE,
  MATERIAL_PROMOTION_MAX_INBOUND_BYTES,
  MATERIAL_PROMOTION_QUERY_ROUTE,
  MATERIAL_PROMOTION_ROUTE,
  createDisabledMaterialPromotionHandler,
  createMaterialPromotionHandler,
} from './handler.mjs'
import { createNodeMaterialPromotionMiddleware } from './node-adapter.mjs'
import { promotionError, runPromotionPhase, throwIfPromotionAborted, unavailablePromotion } from './promotion-error.mjs'

export { createMaterialGcCoordinator, createMaterialPromotionCoordinator } from './coordinator.mjs'
export { createEasypackTrustedWrapperAuthor } from './easypack-author.mjs'
export { createFileMaterialRegistry } from './file-material-registry.mjs'
export {
  MATERIAL_GC_SCHEMA_VERSION,
  createMaterialGcPlanHashInput,
  createMaterialGcPlanRequestDigestInput,
  createMaterialGcReleaseRequestDigestInput,
  validateMaterialGcPlan,
  validateMaterialGcPlanRequest,
  validateMaterialGcReleaseRequest,
  validateMaterialGcSweepRequest,
} from '../../shared/material-gc-contract.mjs'
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
  MATERIAL_GC_PLAN_ROUTE,
  MATERIAL_GC_RELEASE_ROUTE,
  MATERIAL_GC_SWEEP_ROUTE,
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
export const MATERIAL_GC_ENABLED_ENV = 'EASY_EDITOR_MATERIAL_GC_ENABLED'
export const MATERIAL_PROMOTION_CONFIG_ENV = 'EASY_EDITOR_MATERIAL_PROMOTION_CONFIG_JSON'

export const isEnvironmentMaterialPromotionEnabled = (env = process.env) => env[MATERIAL_PROMOTION_ENABLED_ENV] === '1'
export const isEnvironmentMaterialGcEnabled = (env = process.env) => env[MATERIAL_GC_ENABLED_ENV] === '1'

const unavailableMaterialGc = () =>
  promotionError('material-gc-unavailable', 503, 'Durable material garbage collection is unavailable')

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
  const promotionEnabled = isEnvironmentMaterialPromotionEnabled(env)
  const gcEnabled = isEnvironmentMaterialGcEnabled(env)
  if (!promotionEnabled && !gcEnabled) return createDisabledMaterialPromotionHandler()
  const dashboardDataRoot = env.EASY_EDITOR_DASHBOARD_DATA_DIR ?? join(process.cwd(), '.easy-editor-data')
  const workspaceRoot =
    options.workspaceRoot ??
    env.EASY_EDITOR_MATERIAL_PROMOTION_WORKSPACE_DIR ??
    join(dashboardDataRoot, 'promotion-workspaces')
  const authorizePrincipal =
    options.authorizePrincipal ??
    createEnvironmentPrincipalAuthorizer({ env, resolveSessionPrincipal: options.resolveSessionPrincipal })
  let initializedAuthor
  let initializedPromotionCoordinator
  let initializedGcCoordinator
  let initializedRegistry
  let registryInitialization
  let promotionInitialization
  let gcInitialization
  let recovery
  let workspaceRecovery
  const getAuthor = () => {
    initializedAuthor ??=
      options.author ??
      createEasypackTrustedWrapperAuthor({
        workspaceRoot,
        nodeVersion: options.nodeVersion,
        loadEasypack: options.loadEasypack,
        now: options.now,
      })
    return initializedAuthor
  }
  const initializeRegistry = async ({ recover = false } = {}) => {
    if (!initializedRegistry) {
      registryInitialization ??= Promise.resolve(
        options.registry ??
          (options.createRegistry ?? createFileMaterialRegistry)({
            rootDir:
              options.registryRoot ?? env.EASY_EDITOR_MATERIAL_REGISTRY_DIR ?? join(dashboardDataRoot, 'materials'),
            workspaceRoot,
          }),
      )
      initializedRegistry = await registryInitialization
    }
    if (recover && typeof initializedRegistry.recoverPendingPromotions === 'function') {
      recovery ??= initializedRegistry.recoverPendingPromotions()
      await recovery
    }
    return initializedRegistry
  }

  const initializePromotion = async ({ recover = false } = {}) => {
    if (!initializedPromotionCoordinator) {
      promotionInitialization ??= (async () => {
        const author = getAuthor()
        if (typeof author.recoverPromotionWorkspaces === 'function') {
          workspaceRecovery ??= author.recoverPromotionWorkspaces()
          await workspaceRecovery
        }
        const registry = await initializeRegistry({ recover })
        initializedPromotionCoordinator = createMaterialPromotionCoordinator({
          authorizePrincipal,
          author,
          registry,
        })
        return initializedPromotionCoordinator
      })()
      await promotionInitialization
    } else if (recover) {
      await initializeRegistry({ recover: true })
    }
    return initializedPromotionCoordinator
  }

  const initializeGc = async ({ recover = false } = {}) => {
    if (!initializedGcCoordinator) {
      gcInitialization ??= (async () => {
        const registry = await initializeRegistry({ recover })
        initializedGcCoordinator = createMaterialGcCoordinator({ authorizePrincipal, registry })
        return initializedGcCoordinator
      })()
      await gcInitialization
    } else if (recover) {
      await initializeRegistry({ recover: true })
    }
    return initializedGcCoordinator
  }

  const runWithInitializedCoordinator = async (
    initialize,
    method,
    input,
    { recover = false, unavailable = unavailablePromotion } = {},
  ) => {
    const signal = input?.signal
    throwIfPromotionAborted(signal)
    let coordinator
    try {
      coordinator = await runPromotionPhase(() => initialize({ recover }), signal)
    } catch (error) {
      throwIfPromotionAborted(signal)
      if (error?.code === 'promotion-aborted') throw error
      throw unavailable()
    }
    throwIfPromotionAborted(signal)
    return coordinator[method](input)
  }

  const handler = createMaterialPromotionHandler({
    coordinator: Object.freeze({
      promote: input =>
        promotionEnabled
          ? runWithInitializedCoordinator(initializePromotion, 'promote', input, { recover: true })
          : Promise.reject(unavailablePromotion()),
      query: input =>
        promotionEnabled
          ? runWithInitializedCoordinator(initializePromotion, 'query', input)
          : Promise.reject(unavailablePromotion()),
      listCatalog: input =>
        promotionEnabled
          ? runWithInitializedCoordinator(initializePromotion, 'listCatalog', input)
          : Promise.reject(unavailablePromotion()),
      readCatalog: input =>
        promotionEnabled
          ? runWithInitializedCoordinator(initializePromotion, 'readCatalog', input)
          : Promise.reject(unavailablePromotion()),
      planGc: input =>
        gcEnabled
          ? runWithInitializedCoordinator(initializeGc, 'planGc', input, {
              recover: true,
              unavailable: unavailableMaterialGc,
            })
          : undefined,
      sweepGc: input =>
        gcEnabled
          ? runWithInitializedCoordinator(initializeGc, 'sweepGc', input, {
              recover: true,
              unavailable: unavailableMaterialGc,
            })
          : undefined,
      releaseGc: input =>
        gcEnabled
          ? runWithInitializedCoordinator(initializeGc, 'releaseGc', input, {
              recover: true,
              unavailable: unavailableMaterialGc,
            })
          : undefined,
    }),
    checkAvailability: promotionEnabled
      ? async availabilityOptions => {
          const author = getAuthor()
          return typeof author.checkAvailability === 'function'
            ? author.checkAvailability(availabilityOptions)
            : { schemaVersion: 1, available: true, reason: 'ready', minimumNodeMajor: 20 }
        }
      : async () => ({ schemaVersion: 1, available: false, reason: 'disabled', minimumNodeMajor: 20 }),
  })
  let closeTask
  return Object.freeze({
    handle: request => handler.handle(request),
    close() {
      closeTask ??= Promise.resolve().then(() => initializedAuthor?.dispose?.())
      return closeTask
    },
  })
}

export const createEnvironmentMaterialPromotionMiddleware = (options = {}) => {
  const env = options.env ?? process.env
  const handler = options.handler ?? createEnvironmentMaterialPromotionHandler({ ...options, env })
  const nodeMiddleware = createNodeMaterialPromotionMiddleware({
    handler,
    inboundTimeoutMs: options.inboundTimeoutMs,
    operationTimeoutMs: options.operationTimeoutMs,
    publicOrigins:
      options.publicOrigins ??
      env.EASY_EDITOR_PUBLIC_ORIGINS?.split(',')
        .map(value => value.trim())
        .filter(Boolean),
  })
  const boundServers = new WeakSet()
  let closeTask
  const close = () => {
    closeTask ??= Promise.resolve().then(() => handler.close?.())
    return closeTask
  }
  const middleware = async (request, response, next) => {
    const server = request?.socket?.server
    if (server && typeof server.once === 'function' && !boundServers.has(server)) {
      boundServers.add(server)
      server.once('close', () => {
        void close().catch(() => undefined)
      })
    }
    return nodeMiddleware(request, response, next)
  }
  Object.defineProperty(middleware, 'close', { value: close })
  return Object.freeze(middleware)
}
