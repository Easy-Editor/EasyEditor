import type { AgentRuntime, BoundAgentRuntimeBinding } from '@easy-editor/agent-runtime'

export declare const AGENT_RUNTIME_E2E_RECOVERY_STORAGE_KEY: 'easy-editor:agent-runtime:e2e-recoveries:v1'

export type AgentRuntimeE2ERecoveryConfigErrorCode = 'invalid-json' | 'invalid-recoveries' | 'storage-read-failed'

export declare class AgentRuntimeE2ERecoveryConfigError extends Error {
  readonly code: AgentRuntimeE2ERecoveryConfigErrorCode
  constructor(code: AgentRuntimeE2ERecoveryConfigErrorCode, message: string, options?: ErrorOptions)
}

export type AgentRuntimeE2ERecovery =
  | Readonly<{
      kind: 'applied-undurable'
      recoveryId: string
      taskId: string
      callId: string
      message: string
      occurredAt: number
    }>
  | Readonly<{
      kind: 'compensation-conflict'
      recoveryId: string
      taskId: string
      message: string
      occurredAt: number
      conflictPaths: readonly string[]
    }>

export type AgentRuntimeE2ERecoveryAction = 'retry-durability' | 'refresh-conflict-report'

export interface AgentRuntimeE2ERecoveryStorage {
  getItem(key: typeof AGENT_RUNTIME_E2E_RECOVERY_STORAGE_KEY): string | null
}

export interface AgentRuntimeE2ERecoveryBridge {
  list(input: {
    readonly binding: BoundAgentRuntimeBinding
    readonly runtime?: AgentRuntime
  }): Promise<readonly AgentRuntimeE2ERecovery[]>
  retry(
    input: Readonly<{
      binding: BoundAgentRuntimeBinding
      recoveryId: string
      kind: AgentRuntimeE2ERecovery['kind']
      action: AgentRuntimeE2ERecoveryAction
      runtime?: AgentRuntime
    }>,
  ): Promise<void>
}

export declare const parseAgentRuntimeE2ERecoveriesJson: (source: string) => readonly AgentRuntimeE2ERecovery[]

export declare const readAgentRuntimeE2ERecoveries: (
  storage?: AgentRuntimeE2ERecoveryStorage,
) => readonly AgentRuntimeE2ERecovery[]

export declare const createAgentRuntimeE2ERecoveryBridge: (
  recoveries: readonly AgentRuntimeE2ERecovery[],
) => AgentRuntimeE2ERecoveryBridge
