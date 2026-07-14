/**
 * Test-only monolithic entry.
 *
 * Public package entries are deliberately isolated. Kernel behavior tests need
 * legacy runtime constructors and the factory to share one module graph so
 * identity-sensitive prototype and model tests remain meaningful.
 */
export * from '../../src/index'
export { connectAgentPort } from '../../src/agent/channel/worker-client'
import { createLegacyEngine, getEngineAgentCapabilities, getEngineInnerPlugins } from '../../src/engine/engine-instance'
export { getLifecycleTeardownParent as getTestLifecycleTeardownParent } from '../../src/lifecycle/teardown-boundary'
export { inheritLifecycleMutationGuard as inheritTestLifecycleMutationGuard } from '../../src/lifecycle/mutation-barrier'
export { registerSettingTopEntryDisposer as registerTestSettingTopEntryDisposer } from '../../src/designer/setting/setting-top-entry-boundary'

/**
 * White-box kernel factory. Public-entry tests import dist/instance directly;
 * behavior regressions keep explicit test-only access to owned internals.
 */
export const createEngine = (options = {}) => {
  const engine = createLegacyEngine({ trustPolicy: 'agentRestricted', ...options })
  Object.defineProperties(engine, {
    agentCapabilities: {
      configurable: false,
      enumerable: false,
      value: getEngineAgentCapabilities(engine),
      writable: false,
    },
    innerPlugins: {
      configurable: false,
      enumerable: false,
      value: getEngineInnerPlugins(engine),
      writable: false,
    },
  })
  return engine
}
