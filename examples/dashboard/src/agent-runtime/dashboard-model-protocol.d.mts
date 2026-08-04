export interface DashboardAgentModelCapabilityDescriptor {
  readonly capability: string
  readonly revision: string
  readonly input: Readonly<Record<string, unknown>>
}

export interface DashboardAgentModelCapabilityManifest {
  readonly schemaVersion: 1
  readonly revision: string
  readonly hash: string
  readonly capabilities: readonly DashboardAgentModelCapabilityDescriptor[]
}

export declare const DASHBOARD_AGENT_MODEL_CAPABILITY_MANIFEST: DashboardAgentModelCapabilityManifest
export declare const DASHBOARD_AGENT_MODEL_SYSTEM_PROMPT: string
export declare const DASHBOARD_AGENT_MODEL_SYSTEM_MESSAGES: readonly string[]
