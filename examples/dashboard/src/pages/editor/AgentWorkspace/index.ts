export { AgentWorkspace, type AgentWorkspaceProps } from './AgentWorkspace'
export {
  AgentWorkspaceActiveTargetOverlay,
  type AgentWorkspaceActiveTargetOverlayProps,
} from './ActiveTargetOverlay'
export {
  AgentWorkspaceActiveTargetLayer,
  type AgentWorkspaceActiveTargetLayerProjection,
  type AgentWorkspaceActiveTargetLayerProps,
  projectAgentWorkspaceActiveTargetLayer,
  projectAgentWorkspaceTargetStyle,
} from './ActiveTargetLayer'
export { AgentWorkspaceController, createAgentWorkspaceController, deriveAgentWorkspaceIntentMode } from './controller'
export {
  AgentWorkspaceGrantConfirmationRequiredError,
  createAgentWorkspaceCommandPortAdapter,
} from './command-port-adapter'
export { createDashboardAgentWorkspaceComposition } from './dashboard-composition'
export {
  AgentWorkspaceManualReconciliationRequiredError,
  createDashboardAgentWorkspaceProductionRecoveryBridge,
} from './production-recovery-bridge.mjs'
export { normalizeAgentWorkspaceTargets } from './overlay-projection'
export { agentWorkspaceVersionIdentityKey, agentWorkspaceVersionRestoreActionKey } from './version-identity.ts'
export type {
  DashboardAgentWorkspaceComposition,
  DashboardAgentWorkspaceCompositionDependencies,
  DashboardAgentWorkspaceCompositionErrorSource,
  DashboardAgentWorkspaceCompositionOptions,
  DashboardAgentWorkspaceGrantAuthority,
  DashboardAgentWorkspacePersistence,
  DashboardAgentWorkspaceRecoveryBridge,
  DashboardAgentWorkspaceSessionHost,
} from './dashboard-composition'
export type {
  AgentWorkspaceManualReconciliationClassification,
  DashboardAgentWorkspaceProductionRecoveryBridge,
  DashboardAgentWorkspaceProductionRecoveryPersistence,
} from './production-recovery-bridge.mjs'
export type {
  AgentWorkspaceAdapterErrorSource,
  AgentWorkspaceBinding,
  AgentWorkspaceCommandPortAdapter,
  AgentWorkspaceCommandPortAdapterOptions,
  AgentWorkspaceInvocationActivity,
  AgentWorkspaceInvocationCall,
  AgentWorkspaceInvocationSnapshot,
  AgentWorkspaceInvocationTarget,
  AgentWorkspaceLocalGrantDecision,
  AgentWorkspaceLocalGrantDecisionReason,
  AgentWorkspacePersistenceGrant,
  AgentWorkspacePersistenceLifecycle,
  AgentWorkspacePersistenceProjection,
  AgentWorkspacePersistenceRecovery,
  AgentWorkspacePersistenceSnapshot,
  AgentWorkspacePersistenceState,
  AgentWorkspacePersistenceVersion,
  AgentWorkspaceRecoveryAction,
  AgentWorkspaceResolvedTarget,
  AgentWorkspaceRuntimeContextDigest,
  AgentWorkspaceRuntimeFacade,
  AgentWorkspaceRuntimeSnapshot,
  AgentWorkspaceRuntimeTask,
  AgentWorkspaceTargetRectResolver,
} from './command-port-adapter'
export type {
  AgentWorkspaceAvailability,
  AgentWorkspaceBlueprintProjection,
  AgentWorkspaceCommandPort,
  AgentWorkspaceContextDigestProjection,
  AgentWorkspaceControllerContract,
  AgentWorkspaceGrantProjection,
  AgentWorkspaceGrantScope,
  AgentWorkspaceIntentMode,
  AgentWorkspaceRecoveryProjection,
  AgentWorkspaceRuntimeStatus,
  AgentWorkspaceSnapshot,
  AgentWorkspaceTargetProjection,
  AgentWorkspaceTargetRect,
  AgentWorkspaceTaskPhase,
  AgentWorkspaceTaskProjection,
  AgentWorkspaceVersionProjection,
  AgentWorkspaceVersionIdentity,
  AgentWorkspaceViewState,
} from './types'
