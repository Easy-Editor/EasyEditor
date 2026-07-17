import type { InvocationResult, SemanticCall } from '@easy-editor/agent-runtime'
import type { EngineInstance } from '@easy-editor/core/instance'
import type { DashboardAgentHostAuthority } from '../../host/index.mjs'
import type { ScreenSafeMaterialManifest } from '../screen/index.mjs'
import type { DashboardDataResolver } from './contract.mjs'

export * from './contract.mjs'

export declare const DASHBOARD_DATA_CAPABILITIES: readonly ['data.bind', 'data.inspect', 'data.preview', 'data.upsert']
export declare const isDashboardDataCapability: (capability: string) => boolean

export interface DashboardDataManifestCache {
  get(componentName: string, materialRegistryVersion: number | string): Promise<ScreenSafeMaterialManifest>
}

export declare const createDashboardDataManifestCache: (
  baseManifestCache: DashboardDataManifestCache,
) => DashboardDataManifestCache

export interface DashboardDataCapabilityService {
  inspect(call: SemanticCall): Promise<unknown>
  preview(call: SemanticCall): Promise<unknown>
  upsert(call: SemanticCall): Promise<InvocationResult>
  bind(call: SemanticCall): Promise<InvocationResult>
}

export declare const createDashboardDataCapabilityService: (
  options: Readonly<{
    authority: DashboardAgentHostAuthority
    engine: EngineInstance
    recoverInvocation(
      authority: Readonly<{ projectId: string; branchId: string; callId: string }>,
    ): Promise<InvocationResult | null>
    resolver: DashboardDataResolver
    screenApplyChangeSet(call: SemanticCall): Promise<InvocationResult>
  }>,
) => DashboardDataCapabilityService
