import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentWorkerEndpoint } from '@easy-editor/agent-runtime'
import type { ProductionAgentModelConfig } from '../../../agent-runtime/production/index.mjs'
import type {
  DashboardAgentWorkspaceComposition,
  DashboardAgentWorkspaceCompositionOptions,
} from './dashboard-composition.ts'
import { startDashboardAgentWorkspacePageIntegration } from './page-integration.ts'

const composition = (events: string[]): DashboardAgentWorkspaceComposition =>
  ({
    controller: {} as DashboardAgentWorkspaceComposition['controller'],
    getBinding: () => ({ projectId: 'project-1', branchId: 'main', sessionId: 'session-1' }),
    getSnapshot: () =>
      ({
        remote: { availability: { state: 'ready' } },
        intentDraft: '',
        versionNameDraft: '',
        responseDraft: '',
        intentMode: 'initial',
      }) as ReturnType<DashboardAgentWorkspaceComposition['getSnapshot']>,
    async dispose() {
      events.push('composition:dispose')
    },
  }) satisfies DashboardAgentWorkspaceComposition

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(onResolve => {
    resolve = onResolve
  })
  return { promise, resolve }
}

const productionConfig: Readonly<ProductionAgentModelConfig> = Object.freeze({
  providerId: 'provider-1',
  model: 'model-1',
  path: '/api/agent/model/stream',
})

const productionGrantAuthority = Object.freeze({
  userId: 'dashboard-browser-session' as const,
  policyVersion: 'dashboard-agent-gateway/1' as const,
  providerId: 'provider-1',
  providerFingerprint: 'same-origin:["/api/agent/model/stream","provider-1","model-1"]',
  providerLabel: 'provider-1 / model-1',
})

const productionLoader =
  (endpoint: AgentWorkerEndpoint, events: string[] = []) =>
  async () => ({
    readProductionAgentModelConfig(source: Readonly<Record<string, unknown>> = {}) {
      events.push('production:read-config')
      assert.equal(source.VITE_DASHBOARD_AGENT_MODEL_PROVIDER_ID, 'provider-1')
      return productionConfig
    },
    createProductionAgentGrantAuthority(config: ProductionAgentModelConfig) {
      events.push('production:create-grant')
      assert.equal(config, productionConfig)
      return productionGrantAuthority
    },
    async loadProductionAgentWorkerEndpointFactory() {
      events.push('production:load-worker')
      return (options: Readonly<{ config: ProductionAgentModelConfig }>) => {
        assert.equal(options.config, productionConfig)
        return endpoint
      }
    },
  })

test('default-off integration imports no Worker surface and allocates no page resources', async () => {
  const integration = startDashboardAgentWorkspacePageIntegration({
    enabled: false,
    e2eEnabled: false,
    storage: { getItem: () => null },
    createComposition: async () => {
      throw new Error('composition must remain uncreated')
    },
    loadE2E: async () => {
      throw new Error('E2E surface must remain unloaded')
    },
    loadProduction: async () => {
      throw new Error('production surface must remain unloaded')
    },
    registerEditorDisposer: () => assert.fail('default-off must not register a disposer'),
    registerE2EProbe: () => assert.fail('default-off must not register a probe'),
    onReady: () => assert.fail('default-off must not publish a composition'),
    onError: error => assert.fail(error instanceof Error ? error : String(error)),
  })

  assert.equal(await integration.ready, null)
  await integration.dispose()
})

test('production composition dynamically selects the Gateway Worker without a scripted fallback', async () => {
  const events: string[] = []
  let editorDisposer: (() => Promise<void>) | undefined
  const endpoint: AgentWorkerEndpoint = {
    port: {} as MessagePort,
    onFault: () => () => undefined,
    terminate: () => events.push('endpoint:terminate'),
  }
  const integration = startDashboardAgentWorkspacePageIntegration({
    enabled: true,
    e2eEnabled: false,
    storage: { getItem: () => null },
    environment: {
      VITE_DASHBOARD_AGENT_MODEL_PROVIDER_ID: 'provider-1',
      VITE_DASHBOARD_AGENT_MODEL: 'model-1',
      VITE_DASHBOARD_AGENT_MODEL_PATH: '/api/agent/model/stream',
      VITE_DASHBOARD_AGENT_PROVIDER_SECRET: 'must-not-cross-the-production-surface',
    },
    createComposition: async (options: DashboardAgentWorkspaceCompositionOptions) => {
      assert.deepEqual(options.grantAuthority, productionGrantAuthority)
      assert.equal(options.recoveryBridge, undefined)
      assert.equal(options.workerFactory?.(), endpoint)
      events.push('composition:create:worker')
      return composition(events)
    },
    loadE2E: async () => {
      throw new Error('production must not load the scripted E2E surface')
    },
    loadProduction: productionLoader(endpoint, events),
    registerEditorDisposer(disposer) {
      editorDisposer = disposer
      return () => events.push('editor-disposer:release')
    },
    registerE2EProbe: () => {
      throw new Error('production must not register an Agent Workspace E2E probe')
    },
    onReady: () => events.push('composition:ready'),
    onError: error => assert.fail(error instanceof Error ? error : String(error)),
  })

  assert.ok(editorDisposer)
  assert.ok(await integration.ready)
  await editorDisposer()
  events.push('editor:dispose-activity')

  assert.deepEqual(events, [
    'production:read-config',
    'production:load-worker',
    'production:create-grant',
    'composition:create:worker',
    'composition:ready',
    'editor-disposer:release',
    'composition:dispose',
    'editor:dispose-activity',
  ])
  await integration.dispose()
  assert.equal(events.filter(event => event === 'composition:dispose').length, 1)
})

test('E2E composition dynamically reads one script, creates the module Worker endpoint, and exposes a read-only probe', async () => {
  const events: string[] = []
  const steps = [{ expectedPhase: 'BLUEPRINT', events: [] }] as const
  const recoveries = [
    {
      kind: 'applied-undurable',
      recoveryId: 'fixture-recovery-1',
      taskId: 'task-1',
      callId: 'call-1',
      message: 'fixture',
      occurredAt: 1,
    },
  ] as const
  const endpoint: AgentWorkerEndpoint = {
    port: {} as MessagePort,
    onFault: () => () => undefined,
    terminate: () => {
      events.push('endpoint:terminate')
    },
  }
  const recoveryBridge = {
    async list() {
      return []
    },
    async retry() {},
  }
  let probe: (() => unknown) | undefined
  const integration = startDashboardAgentWorkspacePageIntegration({
    enabled: true,
    e2eEnabled: true,
    storage: {
      getItem(key) {
        events.push(`storage:read:${key}`)
        return 'script-json'
      },
    },
    createComposition: async options => {
      assert.ok(options.workerFactory)
      assert.deepEqual(options.grantAuthority, {
        userId: 'dashboard-e2e-user',
        policyVersion: 'dashboard-e2e-policy-v1',
        providerId: 'dashboard-e2e-scripted-worker',
        providerFingerprint: 'dashboard-e2e-scripted-worker-v1',
        providerLabel: 'Dashboard E2E Scripted Worker',
      })
      assert.equal(options.recoveryBridge, recoveryBridge)
      assert.equal(options.workerFactory(), endpoint)
      events.push('composition:create:worker')
      return composition(events)
    },
    loadE2E: async () => ({
      async loadAgentRuntimeE2EScriptConfig() {
        events.push('e2e:load-config')
        return {
          readAgentRuntimeE2EScript(storage) {
            assert.equal(storage.getItem('easy-editor:agent-runtime:e2e-steps:v1'), 'script-json')
            return steps
          },
        }
      },
      async loadAgentRuntimeE2EWorkerEndpointFactory() {
        events.push('e2e:load-worker')
        return options => {
          assert.equal(options.steps, steps)
          return endpoint
        }
      },
      async loadAgentRuntimeE2ERecoveryConfig() {
        events.push('e2e:load-recovery')
        return {
          readAgentRuntimeE2ERecoveries(storage) {
            assert.equal(storage.getItem('easy-editor:agent-runtime:e2e-recoveries:v1'), 'script-json')
            return recoveries
          },
          createAgentRuntimeE2ERecoveryBridge(input) {
            assert.equal(input, recoveries)
            return recoveryBridge
          },
        }
      },
    }),
    loadProduction: async () => {
      throw new Error('E2E selection must not load the production Worker surface')
    },
    registerEditorDisposer: () => () => events.push('editor-disposer:release'),
    registerE2EProbe(nextProbe) {
      probe = nextProbe
      events.push('probe:register')
      return () => {
        probe = undefined
        events.push('probe:release')
      }
    },
    onReady: () => events.push('composition:ready'),
    onError: error => assert.fail(error instanceof Error ? error : String(error)),
  })

  assert.ok(await integration.ready)
  assert.deepEqual(probe?.(), {
    binding: { projectId: 'project-1', branchId: 'main', sessionId: 'session-1' },
    snapshot: {
      remote: { availability: { state: 'ready' } },
      intentDraft: '',
      versionNameDraft: '',
      responseDraft: '',
      intentMode: 'initial',
    },
  })
  await integration.dispose()
  assert.equal(probe, undefined)
  assert.ok(events.indexOf('probe:release') < events.indexOf('composition:dispose'))
})

test('an empty E2E recovery fixture leaves the production recovery bridge unshadowed', async () => {
  const endpoint: AgentWorkerEndpoint = {
    port: {} as MessagePort,
    onFault: () => () => undefined,
    terminate: () => undefined,
  }
  const integration = startDashboardAgentWorkspacePageIntegration({
    enabled: true,
    e2eEnabled: true,
    storage: { getItem: () => null },
    createComposition: async options => {
      assert.ok(options.workerFactory)
      assert.equal(options.recoveryBridge, undefined)
      assert.equal(options.workerFactory(), endpoint)
      return composition([])
    },
    loadE2E: async () => ({
      async loadAgentRuntimeE2EScriptConfig() {
        return { readAgentRuntimeE2EScript: () => [] }
      },
      async loadAgentRuntimeE2EWorkerEndpointFactory() {
        return () => endpoint
      },
      async loadAgentRuntimeE2ERecoveryConfig() {
        return {
          readAgentRuntimeE2ERecoveries: () => [],
          createAgentRuntimeE2ERecoveryBridge() {
            throw new Error('empty recoveries must not install the fixture bridge')
          },
        }
      },
    }),
    loadProduction: async () => {
      throw new Error('E2E selection must not load the production Worker surface')
    },
    registerEditorDisposer: () => () => undefined,
    registerE2EProbe: () => () => undefined,
    onReady: () => undefined,
    onError: error => assert.fail(error instanceof Error ? error : String(error)),
  })

  assert.ok(await integration.ready)
  await integration.dispose()
})

test('disposal during composition bootstrap owns the late resource once and propagates its cleanup failure', async () => {
  const pending = deferred<DashboardAgentWorkspaceComposition>()
  const compositionStarted = deferred<void>()
  let disposeCalls = 0
  const endpoint: AgentWorkerEndpoint = {
    port: {} as MessagePort,
    onFault: () => () => undefined,
    terminate: () => undefined,
  }
  const integration = startDashboardAgentWorkspacePageIntegration({
    enabled: true,
    e2eEnabled: false,
    storage: { getItem: () => null },
    createComposition: () => {
      compositionStarted.resolve()
      return pending.promise
    },
    environment: { VITE_DASHBOARD_AGENT_MODEL_PROVIDER_ID: 'provider-1' },
    loadProduction: productionLoader(endpoint),
    registerEditorDisposer: () => () => undefined,
    registerE2EProbe: () => () => undefined,
    onReady: () => assert.fail('a disposed integration must not publish its late composition'),
    onError: () => assert.fail('expected disposal to own the late cleanup failure'),
  })
  await compositionStarted.promise
  const disposing = integration.dispose()
  pending.resolve({
    ...composition([]),
    async dispose() {
      disposeCalls += 1
      throw new Error('late composition disposal failed')
    },
  })

  await assert.rejects(disposing, /late composition disposal failed/)
  assert.equal(disposeCalls, 1)
})
