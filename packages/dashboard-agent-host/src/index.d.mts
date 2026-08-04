export interface DashboardAgentHostAuthority {
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly taskId: string
}

export interface DashboardAgentHost {
  readonly disposed: boolean
  observe(request: Readonly<Record<string, unknown>>): Promise<unknown>
  describeCapability(request: Readonly<Record<string, unknown>>): Promise<unknown>
  invoke(call: Readonly<Record<string, unknown>>, context: Readonly<Record<string, unknown>>): Promise<unknown>
  queryReceipt(request: Readonly<Record<string, unknown>>): Promise<unknown>
  dispose(): void
}

export declare const DASHBOARD_AGENT_HOST_VERSION: '0.0.0'

export declare const DASHBOARD_AGENT_HOST_COMPATIBILITY: Readonly<{
  schemaVersion: 1
  host: Readonly<{ package: '@easy-editor/dashboard-agent-host'; version: '0.0.0' }>
  runtime: Readonly<{ package: '@easy-editor/agent-runtime'; version: '0.0.0' }>
  core: Readonly<{ package: '@easy-editor/core'; version: '1.0.3' }>
  renderer: Readonly<{ package: '@easy-editor/react-renderer-dashboard'; version: '1.0.4' }>
  contracts: Readonly<{
    agentHost: 1
    projectSchema: '1.0.0'
    screenApplyChangeSet: 1
  }>
}>

export interface DashboardAgentHostCompatibility {
  readonly runtimeVersion: string
  readonly runtimeSha256: string
  readonly coreVersion: string
  readonly coreSha256: string
  readonly rendererVersion: string
  readonly rendererSha256: string
  readonly dashboardAgentHostVersion: string
  readonly dashboardAgentHostSha256: string
  readonly browserArtifactVersion: string
  readonly browserArtifactSha256: string
  readonly materialManifestVersion: string
  readonly materialManifestSha256: string
}

export declare const createDashboardAgentHostCompatibility: (
  input: Readonly<{
    runtimeVersion?: string
    runtimeSha256: string
    coreVersion?: string
    coreSha256: string
    rendererVersion?: string
    rendererSha256: string
    dashboardAgentHostVersion?: string
    dashboardAgentHostSha256: string
    browserArtifactVersion: string
    browserArtifactSha256: string
    materialManifestVersion: string
    materialManifestSha256: string
  }>,
) => Readonly<DashboardAgentHostCompatibility>

export declare const DASHBOARD_AGENT_HOST_ERROR_CODE: Readonly<Record<string, string>>

export declare class DashboardAgentHostError extends Error {}

export declare class DashboardAgentHost implements DashboardAgentHost {}

export declare const createDashboardAgentHost: (
  options?: Readonly<Record<string, unknown>>,
) => DashboardAgentHost | null

export declare const createDashboardAgentHostFactory: (
  options: Readonly<{
    composeHost(authority: DashboardAgentHostAuthority): DashboardAgentHost | null
  }>,
) => Readonly<{
  compatibility: typeof DASHBOARD_AGENT_HOST_COMPATIBILITY
  create(authority: DashboardAgentHostAuthority): DashboardAgentHost
}>

export interface MemoryDashboardAgentPersistence {
  readonly kind: 'memory'
  snapshot(): Readonly<{ kind: 'memory'; draftGeneration: number; receiptCount: number }>
}

export declare const createMemoryDashboardAgentPersistence: (
  options?: Readonly<{ draftGeneration?: number }>,
) => MemoryDashboardAgentPersistence

export declare const createInMemoryDashboardAgentHostFactory: (
  options: Readonly<{
    engine: object
    persistence?: MemoryDashboardAgentPersistence
    now?: () => number
  }>,
) => Readonly<{
  compatibility: typeof DASHBOARD_AGENT_HOST_COMPATIBILITY
  persistence: MemoryDashboardAgentPersistence
  create(authority: DashboardAgentHostAuthority): DashboardAgentHost
}>
