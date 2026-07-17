/// <reference types="vite/client" />

import type { DashboardPersistenceSnapshot } from './editor/persistence-runtime'
import type { DashboardAgentWorkspaceE2EProbeState } from './pages/editor/AgentWorkspace/page-integration'

declare global {
  const __EASY_EDITOR_AGENT_RUNTIME_E2E__: boolean

  interface Window {
    readonly __EASY_EDITOR_E2E__?: Readonly<{
      getAgentWorkspaceState: () => DashboardAgentWorkspaceE2EProbeState | null
      getEngineState: () => 'created' | 'initializing' | 'ready' | 'disposing' | 'disposed' | 'failed'
      getPersistenceState: () => DashboardPersistenceSnapshot
      flushPersistence: () => Promise<void>
    }>
  }
}
