import type { LoadingStateManager, Materials, ResourceRegistry, Setters } from '@easy-editor/core'
import type { RemoteResourceScope } from './resource-scope.js'

export interface RemoteEnvironment {
  readonly document: Document
  readonly fetch: typeof fetch
  readonly importModule: (url: string) => Promise<unknown>
  readonly WebSocket: typeof WebSocket
  readonly window: Window
}

export interface DashboardRemoteServices {
  readonly environment: RemoteEnvironment
  readonly instanceId: string
  readonly loadingState: LoadingStateManager
  readonly materials: Materials
  readonly registry: ResourceRegistry
  readonly scope: RemoteResourceScope
  readonly setters: Setters
}
