export type AgentRuntimeFeatureFlags = Readonly<{
  runtime: boolean
  data: boolean
  online: boolean
  promotion: boolean
}>

export declare const AGENT_RUNTIME_FEATURE_FLAG_ENV: Readonly<{
  runtime: 'VITE_DASHBOARD_AGENT_RUNTIME'
  data: 'VITE_DASHBOARD_AGENT_DATA'
  online: 'VITE_DASHBOARD_AGENT_ONLINE'
  promotion: 'VITE_DASHBOARD_AGENT_PROMOTION'
}>

export declare const DEFAULT_AGENT_RUNTIME_FEATURE_FLAGS: AgentRuntimeFeatureFlags

export declare const resolveAgentRuntimeFeatureFlags: (
  source?: Readonly<Record<string, unknown>>,
) => AgentRuntimeFeatureFlags
