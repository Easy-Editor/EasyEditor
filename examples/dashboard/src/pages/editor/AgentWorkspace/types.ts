export const AGENT_WORKSPACE_GRANT_SCOPES = [
  'project.write',
  'data.read',
  'online-code.author',
  'dependency.resolve',
  'material.promote.local',
] as const

export type AgentWorkspaceGrantScope = (typeof AGENT_WORKSPACE_GRANT_SCOPES)[number]

export type AgentWorkspaceTaskPhase =
  | 'IDLE'
  | 'OBSERVE'
  | 'BLUEPRINT'
  | 'WAITING_USER'
  | 'PLAN_STEP'
  | 'EXECUTE'
  | 'YIELDED'
  | 'QUERY_RECEIPT'
  | 'VERIFY'
  | 'REPAIR'
  | 'CHECKPOINT'
  | 'PAUSED'
  | 'RECOVERING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'

export type AgentWorkspaceRuntimeStatus = 'initializing' | 'ready' | 'recovering' | 'failed' | 'disposed'

export type AgentWorkspaceAvailability =
  | { readonly state: 'ready' }
  | { readonly state: 'disabled'; readonly reason: string }
  | { readonly state: 'unavailable'; readonly reason: string; readonly detail?: string }

export interface AgentWorkspaceQuestionProjection {
  readonly questionId: string
  readonly prompt: string
  readonly responseHint?: string
}

export interface AgentWorkspaceBlueprintProjection {
  readonly title?: string
  readonly summary: string
  readonly steps: readonly {
    readonly stepId: string
    readonly label: string
    readonly status: 'pending' | 'active' | 'verified' | 'failed' | 'cancelled'
  }[]
}

export interface AgentWorkspaceContextDigestProjection {
  readonly sourceHash: string
  readonly includedTaskIds: readonly string[]
  readonly omittedTaskCount: number
  readonly unresolvedConstraintCount: number
}

export interface AgentWorkspaceTaskProjection {
  readonly taskId: string
  readonly intent: string
  readonly phase: AgentWorkspaceTaskPhase
  readonly compensationEligible: boolean
  readonly createdAt: number
  readonly updatedAt: number
  readonly parentTaskId?: string
  readonly supersedesTaskId?: string
  readonly blueprint?: AgentWorkspaceBlueprintProjection
  readonly completionSummary?: string
  readonly question?: AgentWorkspaceQuestionProjection
  readonly failure?: {
    readonly code: string
    readonly message: string
    readonly retryable: boolean
  }
  readonly contextDigest?: AgentWorkspaceContextDigestProjection
  readonly checkpointId?: string
}

export interface AgentWorkspaceVersionIdentity {
  readonly versionId: string
  readonly sourceBranchId: string
}

export interface AgentWorkspaceVersionProjection extends AgentWorkspaceVersionIdentity {
  readonly name: string
  readonly createdAt: number
  readonly sourceSessionId?: string
  readonly sourceTaskId?: string
  readonly schemaHash: string
}

export interface AgentWorkspaceGrantProjection {
  readonly scope: AgentWorkspaceGrantScope
  readonly status: 'required' | 'granted' | 'revoked'
  readonly policyVersion: string
  readonly providerLabel?: string
  readonly grantedAt?: number
}

export type AgentWorkspaceRecoveryProjection =
  | {
      readonly kind: 'unsaved'
      readonly recoveryId: string
      readonly message: string
      readonly occurredAt: number
    }
  | {
      readonly kind: 'applied-undurable'
      readonly recoveryId: string
      readonly taskId: string
      readonly callId: string
      readonly message: string
      readonly occurredAt: number
    }
  | {
      readonly kind: 'compensation-conflict'
      readonly recoveryId: string
      readonly taskId: string
      readonly message: string
      readonly occurredAt: number
      readonly conflictPaths: readonly string[]
    }

export interface AgentWorkspaceTargetRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface AgentWorkspaceTargetProjection {
  readonly targetId: string
  readonly label: string
  readonly rect: AgentWorkspaceTargetRect
  readonly tone?: 'active' | 'pending' | 'blocked'
}

export interface AgentWorkspaceSnapshot {
  readonly schemaVersion: 1
  readonly availability: AgentWorkspaceAvailability
  readonly runtimeStatus: AgentWorkspaceRuntimeStatus
  readonly projectId: string
  readonly branchId: string
  readonly sessionId?: string
  readonly activeTaskId?: string
  readonly tasks: readonly AgentWorkspaceTaskProjection[]
  readonly versions: readonly AgentWorkspaceVersionProjection[]
  readonly grants: readonly AgentWorkspaceGrantProjection[]
  readonly recoveries: readonly AgentWorkspaceRecoveryProjection[]
  readonly activeTargets: readonly AgentWorkspaceTargetProjection[]
}

export type AgentWorkspaceIntentMode = 'initial' | 'follow-up' | 'refinement'

export interface AgentWorkspaceCommandPort {
  getSnapshot(): AgentWorkspaceSnapshot
  subscribe(listener: () => void): () => void
  submitIntent(input: { readonly intent: string; readonly mode: AgentWorkspaceIntentMode }): Promise<void>
  pauseTask(taskId: string): Promise<void>
  resumeTask(taskId: string): Promise<void>
  cancelTask(taskId: string): Promise<void>
  respondToQuestion(input: {
    readonly taskId: string
    readonly questionId: string
    readonly response: string
  }): Promise<void>
  createVersion(name: string): Promise<void>
  restoreVersion(identity: AgentWorkspaceVersionIdentity): Promise<void>
  compensateTask(taskId: string): Promise<void>
  requestGrant(scope: AgentWorkspaceGrantScope): Promise<void>
  revokeGrant(scope: AgentWorkspaceGrantScope): Promise<void>
  retrySave(recoveryId: string): Promise<void>
  retryDurability(recoveryId: string): Promise<void>
  refreshCompensationConflict(recoveryId: string): Promise<void>
}

export interface AgentWorkspaceViewState {
  readonly remote: AgentWorkspaceSnapshot
  readonly intentDraft: string
  readonly versionNameDraft: string
  readonly responseDraft: string
  readonly pendingAction?: string
  readonly actionError?: string
  readonly intentMode: AgentWorkspaceIntentMode
}

export interface AgentWorkspaceControllerContract {
  getSnapshot(): AgentWorkspaceViewState
  subscribe(listener: () => void): () => void
  setIntentDraft(value: string): void
  setVersionNameDraft(value: string): void
  setResponseDraft(value: string): void
  clearActionError(): void
  submitIntent(): Promise<boolean>
  pauseCurrentTask(): Promise<boolean>
  resumeCurrentTask(): Promise<boolean>
  cancelCurrentTask(): Promise<boolean>
  respondToQuestion(): Promise<boolean>
  createVersion(): Promise<boolean>
  restoreVersion(identity: AgentWorkspaceVersionIdentity): Promise<boolean>
  compensateTask(taskId: string): Promise<boolean>
  requestGrant(scope: AgentWorkspaceGrantScope): Promise<boolean>
  revokeGrant(scope: AgentWorkspaceGrantScope): Promise<boolean>
  retrySave(recoveryId: string): Promise<boolean>
  retryDurability(recoveryId: string): Promise<boolean>
  refreshCompensationConflict(recoveryId: string): Promise<boolean>
  dispose(): void
}
