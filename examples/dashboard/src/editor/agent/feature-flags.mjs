export const AGENT_RUNTIME_FEATURE_FLAG_ENV = Object.freeze({
  runtime: 'VITE_DASHBOARD_AGENT_RUNTIME',
  data: 'VITE_DASHBOARD_AGENT_DATA',
  online: 'VITE_DASHBOARD_AGENT_ONLINE',
  promotion: 'VITE_DASHBOARD_AGENT_PROMOTION',
})

export const DEFAULT_AGENT_RUNTIME_FEATURE_FLAGS = Object.freeze({
  runtime: false,
  data: false,
  online: false,
  promotion: false,
})

const isEnabled = value => value === true || value === 'true' || value === '1'

export const resolveAgentRuntimeFeatureFlags = (source = {}) =>
  Object.freeze({
    runtime: isEnabled(source[AGENT_RUNTIME_FEATURE_FLAG_ENV.runtime]),
    data: isEnabled(source[AGENT_RUNTIME_FEATURE_FLAG_ENV.data]),
    online: isEnabled(source[AGENT_RUNTIME_FEATURE_FLAG_ENV.online]),
    promotion: isEnabled(source[AGENT_RUNTIME_FEATURE_FLAG_ENV.promotion]),
  })
