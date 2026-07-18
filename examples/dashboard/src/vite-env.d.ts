/// <reference types="vite/client" />

import type { DashboardMaterialGcRuntimeSnapshotV1 } from './editor/agent/capabilities/promotion/material-gc-runtime.mjs'
import type {
  DashboardAgentTelemetryEvent,
  DashboardAgentTelemetryQuery,
  DashboardAgentTelemetryStats,
} from './editor/agent/telemetry/index.mjs'
import type { DashboardPersistenceSnapshot } from './editor/persistence-runtime'
import type { DashboardAgentWorkspaceE2EProbeState } from './pages/editor/AgentWorkspace/page-integration'

declare global {
  const __EASY_EDITOR_AGENT_RUNTIME_E2E__: boolean

  interface ImportMetaEnv {
    readonly VITE_DASHBOARD_AGENT_MODEL_PROVIDER_ID?: string
    readonly VITE_DASHBOARD_AGENT_MODEL?: string
    readonly VITE_DASHBOARD_AGENT_MODEL_PATH?: string
  }

  interface Window {
    readonly __EASY_EDITOR_E2E__?: Readonly<{
      getAgentWorkspaceState: () => DashboardAgentWorkspaceE2EProbeState | null
      getAgentTelemetryState: (query: DashboardAgentTelemetryQuery) => Readonly<{
        events: readonly DashboardAgentTelemetryEvent[]
        stats: DashboardAgentTelemetryStats
      }> | null
      getEngineState: () => 'created' | 'initializing' | 'ready' | 'disposing' | 'disposed' | 'failed'
      getPersistenceState: () => DashboardPersistenceSnapshot
      getMaterialGcState?: () => DashboardMaterialGcRuntimeSnapshotV1
      flushPersistence: () => Promise<void>
      triggerMaterialGc?: () => Promise<DashboardMaterialGcRuntimeSnapshotV1>
      armDashboardAgentPostIntentGate: () => void
      waitForDashboardAgentPostIntent: () => Promise<string>
      releaseDashboardAgentPostIntentGate: () => void
      armDashboardAgentPostCommitGate: () => void
      waitForDashboardAgentPostCommit: () => Promise<string>
      releaseDashboardAgentPostCommitGate: () => void
    }>
  }
}
