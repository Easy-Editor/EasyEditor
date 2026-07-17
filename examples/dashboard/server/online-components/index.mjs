import { compileOnlineComponentDependencyConfig } from './config.mjs'
import { createDisabledOnlineComponentDependencyHandler, createOnlineComponentDependencyHandler } from './handler.mjs'
import { createNodeOnlineComponentDependencyMiddleware } from './node-adapter.mjs'

export { createOnlineComponentDependencyCache } from './cache.mjs'
export { compileOnlineComponentDependencyConfig } from './config.mjs'
export {
  ONLINE_COMPONENT_DEPENDENCY_ROUTE,
  createDisabledOnlineComponentDependencyHandler,
  createOnlineComponentDependencyHandler,
} from './handler.mjs'
export { createNodeOnlineComponentDependencyMiddleware } from './node-adapter.mjs'

export const ONLINE_COMPONENT_DEPENDENCY_ENABLED_ENV = 'EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_ENABLED'
export const ONLINE_COMPONENT_DEPENDENCY_CONFIG_ENV = 'EASY_EDITOR_ONLINE_COMPONENT_DEPENDENCY_CONFIG_JSON'

export const isEnvironmentOnlineComponentDependencyEnabled = (env = process.env) =>
  env[ONLINE_COMPONENT_DEPENDENCY_ENABLED_ENV] === '1'

const parseEnvironmentConfig = env => {
  if (!isEnvironmentOnlineComponentDependencyEnabled(env)) return null
  const source = env[ONLINE_COMPONENT_DEPENDENCY_CONFIG_ENV]
  if (typeof source !== 'string') return null
  try {
    return compileOnlineComponentDependencyConfig(JSON.parse(source))
  } catch {
    return null
  }
}

export const createEnvironmentOnlineComponentDependencyHandler = ({ env = process.env, ...options } = {}) => {
  const config = parseEnvironmentConfig(env)
  return config
    ? createOnlineComponentDependencyHandler({ ...options, config })
    : createDisabledOnlineComponentDependencyHandler()
}

export const createEnvironmentOnlineComponentDependencyMiddleware = (options = {}) => {
  const env = options.env ?? process.env
  return createNodeOnlineComponentDependencyMiddleware({
    handler: options.handler ?? createEnvironmentOnlineComponentDependencyHandler({ ...options, env }),
    inboundTimeoutMs: options.inboundTimeoutMs,
    publicOrigins:
      options.publicOrigins ??
      env.EASY_EDITOR_PUBLIC_ORIGINS?.split(',')
        .map(value => value.trim())
        .filter(Boolean),
  })
}
