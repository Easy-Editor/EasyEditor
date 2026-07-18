import type { AgentWorkerEndpoint } from '@easy-editor/agent-runtime'
import type {
  ProductionAgentGrantAuthority,
  ProductionAgentModelConfig,
} from '../../../agent-runtime/production/index.mjs'
import type {
  AgentRuntimeE2ERecovery,
  AgentRuntimeE2EScriptedModelStep,
} from '../../../editor/agent/runtime-e2e/index.mjs'
import {
  type DashboardAgentWorkspaceComposition,
  type DashboardAgentWorkspaceCompositionOptions,
  type DashboardAgentWorkspaceRecoveryBridge,
  createDashboardAgentWorkspaceComposition,
} from './dashboard-composition.ts'

type StorageReader = Readonly<{
  getItem(key: string): string | null
}>

const AGENT_RUNTIME_E2E_BUILD_ENABLED =
  typeof __EASY_EDITOR_AGENT_RUNTIME_E2E__ === 'boolean' ? __EASY_EDITOR_AGENT_RUNTIME_E2E__ : true

type AgentRuntimeE2ESurface = Readonly<{
  loadAgentRuntimeE2EScriptConfig(): Promise<
    Readonly<{
      readAgentRuntimeE2EScript(storage: StorageReader): readonly AgentRuntimeE2EScriptedModelStep[]
    }>
  >
  loadAgentRuntimeE2EWorkerEndpointFactory(): Promise<
    (options: Readonly<{ steps: readonly AgentRuntimeE2EScriptedModelStep[] }>) => AgentWorkerEndpoint
  >
  loadAgentRuntimeE2ERecoveryConfig(): Promise<
    Readonly<{
      readAgentRuntimeE2ERecoveries(storage: StorageReader): readonly AgentRuntimeE2ERecovery[]
      createAgentRuntimeE2ERecoveryBridge(
        recoveries: readonly AgentRuntimeE2ERecovery[],
      ): DashboardAgentWorkspaceRecoveryBridge
    }>
  >
}>

type AgentRuntimeProductionSurface = Readonly<{
  readProductionAgentModelConfig(source?: Readonly<Record<string, unknown>>): Readonly<ProductionAgentModelConfig>
  createProductionAgentGrantAuthority(config: ProductionAgentModelConfig): Readonly<ProductionAgentGrantAuthority>
  loadProductionAgentWorkerEndpointFactory(): Promise<
    (options: Readonly<{ config: ProductionAgentModelConfig }>) => AgentWorkerEndpoint
  >
}>

const E2E_GRANT_AUTHORITY = Object.freeze({
  userId: 'dashboard-e2e-user',
  policyVersion: 'dashboard-e2e-policy-v1',
  providerId: 'dashboard-e2e-scripted-worker',
  providerFingerprint: 'dashboard-e2e-scripted-worker-v1',
  providerLabel: 'Dashboard E2E Scripted Worker',
})

export interface DashboardAgentWorkspaceE2EProbeState {
  readonly binding: ReturnType<DashboardAgentWorkspaceComposition['getBinding']>
  readonly snapshot: ReturnType<DashboardAgentWorkspaceComposition['getSnapshot']>
}

export interface DashboardAgentWorkspacePageIntegrationOptions {
  readonly enabled: boolean
  readonly e2eEnabled: boolean
  readonly storage: StorageReader
  readonly environment?: Readonly<Record<string, unknown>>
  readonly createComposition?: (
    options: DashboardAgentWorkspaceCompositionOptions,
  ) => Promise<DashboardAgentWorkspaceComposition>
  readonly loadE2E?: () => Promise<AgentRuntimeE2ESurface>
  readonly loadProduction?: () => Promise<AgentRuntimeProductionSurface>
  readonly registerEditorDisposer: (disposer: () => Promise<void>) => () => void
  readonly registerE2EProbe: (probe: () => DashboardAgentWorkspaceE2EProbeState) => () => void
  readonly onReady: (composition: DashboardAgentWorkspaceComposition) => void
  readonly onError: (error: unknown) => void
}

export interface DashboardAgentWorkspacePageIntegration {
  readonly ready: Promise<DashboardAgentWorkspaceComposition | null>
  dispose(): Promise<void>
}

const loadDefaultE2ESurface = (): Promise<AgentRuntimeE2ESurface> => import('@/editor/agent/runtime-e2e/index.mjs')

const loadDefaultProductionSurface = (): Promise<AgentRuntimeProductionSurface> =>
  import('../../../agent-runtime/production/index.mjs')

const productionModelEnvironment = (): Readonly<Record<string, unknown>> =>
  Object.freeze({
    VITE_DASHBOARD_AGENT_MODEL_PROVIDER_ID: import.meta.env.VITE_DASHBOARD_AGENT_MODEL_PROVIDER_ID,
    VITE_DASHBOARD_AGENT_MODEL: import.meta.env.VITE_DASHBOARD_AGENT_MODEL,
    VITE_DASHBOARD_AGENT_MODEL_PATH: import.meta.env.VITE_DASHBOARD_AGENT_MODEL_PATH,
  })

type AgentRuntimeWorkerCompositionOptions = Readonly<{
  workerFactory: () => AgentWorkerEndpoint
  recoveryBridge?: DashboardAgentWorkspaceRecoveryBridge
  grantAuthority: DashboardAgentWorkspaceCompositionOptions['grantAuthority']
}>

const loadE2ECompositionOptions: (
  options: DashboardAgentWorkspacePageIntegrationOptions,
) => Promise<AgentRuntimeWorkerCompositionOptions | undefined> = AGENT_RUNTIME_E2E_BUILD_ENABLED
  ? async options => {
      if (!options.e2eEnabled) return undefined
      const surface = await (options.loadE2E ?? loadDefaultE2ESurface)()
      const [createEndpoint, scriptConfig, recoveryConfig] = await Promise.all([
        surface.loadAgentRuntimeE2EWorkerEndpointFactory(),
        surface.loadAgentRuntimeE2EScriptConfig(),
        surface.loadAgentRuntimeE2ERecoveryConfig(),
      ])
      const steps = scriptConfig.readAgentRuntimeE2EScript(options.storage)
      const recoveries = recoveryConfig.readAgentRuntimeE2ERecoveries(options.storage)
      return Object.freeze({
        workerFactory: () => createEndpoint({ steps }),
        grantAuthority: E2E_GRANT_AUTHORITY,
        ...(recoveries.length > 0
          ? { recoveryBridge: recoveryConfig.createAgentRuntimeE2ERecoveryBridge(recoveries) }
          : {}),
      })
    }
  : async () => undefined

const loadProductionCompositionOptions = async (
  options: DashboardAgentWorkspacePageIntegrationOptions,
): Promise<AgentRuntimeWorkerCompositionOptions | undefined> => {
  if (options.e2eEnabled) return undefined
  const surface = await (options.loadProduction ?? loadDefaultProductionSurface)()
  const config = surface.readProductionAgentModelConfig(options.environment ?? productionModelEnvironment())
  const createEndpoint = await surface.loadProductionAgentWorkerEndpointFactory()
  return Object.freeze({
    workerFactory: () => createEndpoint({ config }),
    grantAuthority: surface.createProductionAgentGrantAuthority(config),
  })
}

const loadCompositionOptions = (
  options: DashboardAgentWorkspacePageIntegrationOptions,
): Promise<AgentRuntimeWorkerCompositionOptions | undefined> =>
  options.e2eEnabled ? loadE2ECompositionOptions(options) : loadProductionCompositionOptions(options)

const report = (onError: (error: unknown) => void, error: unknown): void => {
  try {
    onError(error)
  } catch {
    // Diagnostics cannot change page/runtime ownership.
  }
}

export const startDashboardAgentWorkspacePageIntegration = (
  options: DashboardAgentWorkspacePageIntegrationOptions,
): DashboardAgentWorkspacePageIntegration => {
  let disposed = !options.enabled
  let releaseEditorDisposer: () => void = () => undefined
  let releaseE2EProbe: () => void = () => undefined
  let ready: Promise<DashboardAgentWorkspaceComposition | null> = Promise.resolve(null)
  let disposePromise: Promise<void> | undefined

  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise
    disposed = true
    releaseEditorDisposer()
    releaseEditorDisposer = () => undefined
    releaseE2EProbe()
    releaseE2EProbe = () => undefined
    disposePromise = (async () => {
      const composition = await ready
      await composition?.dispose()
    })()
    return disposePromise
  }

  if (!options.enabled) return Object.freeze({ ready, dispose })

  releaseEditorDisposer = options.registerEditorDisposer(dispose)
  if (disposed) return Object.freeze({ ready, dispose })

  ready = (async () => {
    let composition: DashboardAgentWorkspaceComposition | undefined
    try {
      const workerCompositionOptions = await loadCompositionOptions(options)
      if (disposed) return null
      composition = await (options.createComposition ?? createDashboardAgentWorkspaceComposition)({
        enabled: true,
        ...(workerCompositionOptions ?? {}),
      })
      if (disposed) return composition
      const liveComposition = composition
      if (AGENT_RUNTIME_E2E_BUILD_ENABLED && options.e2eEnabled) {
        releaseE2EProbe = options.registerE2EProbe(() =>
          Object.freeze({
            binding: structuredClone(liveComposition.getBinding()),
            snapshot: structuredClone(liveComposition.getSnapshot()),
          }),
        )
      }
      options.onReady(liveComposition)
      return liveComposition
    } catch (error) {
      let reportedError = error
      releaseE2EProbe()
      releaseE2EProbe = () => undefined
      if (composition) {
        try {
          await composition.dispose()
        } catch (disposeError) {
          reportedError = new AggregateError(
            [reportedError, disposeError],
            'Agent Workspace setup and disposal both failed',
          )
        }
      }
      if (!disposed) report(options.onError, reportedError)
      return null
    }
  })()

  return Object.freeze({ ready, dispose })
}
