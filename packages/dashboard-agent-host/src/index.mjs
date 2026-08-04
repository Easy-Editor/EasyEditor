import {
  DASHBOARD_AGENT_HOST_ERROR_CODE,
  DashboardAgentHost,
  DashboardAgentHostError,
  createDashboardAgentHost,
} from '../../../examples/dashboard/src/editor/agent/host/index.mjs'

export { DASHBOARD_AGENT_HOST_ERROR_CODE, DashboardAgentHost, DashboardAgentHostError, createDashboardAgentHost }

export const DASHBOARD_AGENT_HOST_VERSION = '0.0.0'

const IMMUTABLE_SHA256_PATTERN = /^[a-f0-9]{64}$/u

export const DASHBOARD_AGENT_HOST_COMPATIBILITY = Object.freeze({
  schemaVersion: 1,
  host: Object.freeze({
    package: '@easy-editor/dashboard-agent-host',
    version: DASHBOARD_AGENT_HOST_VERSION,
  }),
  runtime: Object.freeze({
    package: '@easy-editor/agent-runtime',
    version: '0.0.0',
  }),
  core: Object.freeze({
    package: '@easy-editor/core',
    version: '1.0.3',
  }),
  renderer: Object.freeze({
    package: '@easy-editor/react-renderer-dashboard',
    version: '1.0.4',
  }),
  contracts: Object.freeze({
    agentHost: 1,
    projectSchema: '1.0.0',
    screenApplyChangeSet: 1,
  }),
})

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return value
}

const requireSha256 = (value, label) => {
  if (!IMMUTABLE_SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256`)
  }
  return value
}

export const createDashboardAgentHostCompatibility = ({
  runtimeVersion = DASHBOARD_AGENT_HOST_COMPATIBILITY.runtime.version,
  runtimeSha256,
  coreVersion = DASHBOARD_AGENT_HOST_COMPATIBILITY.core.version,
  coreSha256,
  rendererVersion = DASHBOARD_AGENT_HOST_COMPATIBILITY.renderer.version,
  rendererSha256,
  dashboardAgentHostVersion = DASHBOARD_AGENT_HOST_VERSION,
  dashboardAgentHostSha256,
  browserArtifactVersion,
  browserArtifactSha256,
  materialManifestVersion,
  materialManifestSha256,
} = {}) =>
  Object.freeze({
    runtimeVersion: requireNonEmptyString(runtimeVersion, 'runtimeVersion'),
    runtimeSha256: requireSha256(runtimeSha256, 'runtimeSha256'),
    coreVersion: requireNonEmptyString(coreVersion, 'coreVersion'),
    coreSha256: requireSha256(coreSha256, 'coreSha256'),
    rendererVersion: requireNonEmptyString(rendererVersion, 'rendererVersion'),
    rendererSha256: requireSha256(rendererSha256, 'rendererSha256'),
    dashboardAgentHostVersion: requireNonEmptyString(dashboardAgentHostVersion, 'dashboardAgentHostVersion'),
    dashboardAgentHostSha256: requireSha256(dashboardAgentHostSha256, 'dashboardAgentHostSha256'),
    browserArtifactVersion: requireNonEmptyString(browserArtifactVersion, 'browserArtifactVersion'),
    browserArtifactSha256: requireSha256(browserArtifactSha256, 'browserArtifactSha256'),
    materialManifestVersion: requireNonEmptyString(materialManifestVersion, 'materialManifestVersion'),
    materialManifestSha256: requireSha256(materialManifestSha256, 'materialManifestSha256'),
  })

const clone = value => structuredClone(value)

export const createMemoryDashboardAgentPersistence = ({ draftGeneration = 0 } = {}) => {
  const lineage = new Map()
  let generation = draftGeneration
  return Object.freeze({
    kind: 'memory',
    async recoverDurableAgentReceipt({ callId }) {
      return clone(lineage.get(callId) ?? { classification: 'missing' })
    },
    async runDurableAgentWrite(operation) {
      let pendingIntent = null
      return operation({
        draft: { draftGeneration: generation },
        async recordIntent(intent) {
          pendingIntent = clone(intent)
          lineage.set(intent.callId, {
            classification: 'indeterminate',
            reason: 'intent-without-terminal-receipt',
          })
          return clone(intent)
        },
        async commitBatch(batch) {
          if (!pendingIntent) throw new Error('memory Host persistence requires an intent before commit')
          generation += 1
          lineage.set(batch.callId, {
            classification: batch.receipt.status === 'applied' ? 'committed' : 'failed',
            receiptIntent: clone(batch.receiptIntent),
            receipt: clone(batch.receipt),
          })
          return { receipt: clone(batch.receipt) }
        },
      })
    },
    runAgentMutation(_callId, operation) {
      return operation()
    },
    snapshot() {
      return {
        kind: 'memory',
        draftGeneration: generation,
        receiptCount: lineage.size,
      }
    },
  })
}

export const createDashboardAgentHostFactory = ({ composeHost } = {}) => {
  if (typeof composeHost !== 'function') throw new TypeError('composeHost must be a function')

  return Object.freeze({
    compatibility: DASHBOARD_AGENT_HOST_COMPATIBILITY,
    create(authority) {
      const host = composeHost(authority)
      if (!host) throw new Error('Dashboard Agent Host is unavailable in the connected page')
      return host
    },
  })
}

export const createInMemoryDashboardAgentHostFactory = ({
  engine,
  persistence = createMemoryDashboardAgentPersistence(),
  now = Date.now,
} = {}) => {
  if (!engine || typeof engine !== 'object') throw new TypeError('engine must be an object')
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  const activityLease = Object.freeze({
    generation: 0,
    isActive: () => false,
    waitUntilIdle: async () => ({ generation: 0 }),
  })
  return Object.freeze({
    compatibility: DASHBOARD_AGENT_HOST_COMPATIBILITY,
    persistence,
    create(authority) {
      for (const field of ['projectId', 'branchId', 'sessionId', 'taskId']) {
        requireNonEmptyString(authority?.[field], `authority.${field}`)
      }
      const host = createDashboardAgentHost({
        activityLease,
        authority,
        compensationService: Object.freeze({
          async compensate() {
            throw new Error('task.compensate is unavailable in the Document Executor memory Host')
          },
          async query() {
            return null
          },
        }),
        enabled: true,
        engine,
        now,
        persistence,
        isTransactionCommittedError: error => error?.name === 'TransactionCommittedError',
        isTransactionRollbackIncompleteError: error => error?.name === 'TransactionRollbackIncompleteError',
      })
      if (!host) throw new Error('Dashboard Agent Host could not be created')
      return host
    },
  })
}
