import type { LockedArtifactDependencyV1 } from '../../../lib/storage/artifact-contracts.mjs'

export declare const ONLINE_COMPONENT_DEPENDENCY_RESOLVE_ENDPOINT: '/api/online-components/dependencies/resolve'

export interface DashboardOnlineComponentDependencyResolver {
  resolve(request: Readonly<{ package: string; range: string }>): Promise<LockedArtifactDependencyV1>
}

export declare const createDashboardOnlineComponentDependencyResolver: (options?: {
  readonly fetchImpl?: typeof fetch
}) => DashboardOnlineComponentDependencyResolver
