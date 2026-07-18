export type DashboardEditorSurfacePhase = 'mounted' | 'suspending' | 'suspended' | 'resuming'

export interface DashboardEditorSurfaceParticipant {
  acknowledge(phase: DashboardEditorSurfacePhase): void
  dispose(): void
}

export interface DashboardEditorSurfaceLifecycle {
  getSnapshot(): DashboardEditorSurfacePhase
  subscribe(listener: () => void): () => void
  registerParticipant(): DashboardEditorSurfaceParticipant
  suspend(): Promise<void>
  resume(): Promise<void>
}

export function createDashboardEditorSurfaceLifecycle(): DashboardEditorSurfaceLifecycle
export const dashboardEditorSurfaceLifecycle: DashboardEditorSurfaceLifecycle
