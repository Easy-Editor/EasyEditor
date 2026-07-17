import type { AgentRuntimeE2EScriptedModelStep } from './protocol.mjs'

export declare const AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY: 'easy-editor:agent-runtime:e2e-steps:v1'

export type AgentRuntimeE2EScriptConfigErrorCode = 'invalid-json' | 'invalid-script' | 'storage-read-failed'

export declare class AgentRuntimeE2EScriptConfigError extends Error {
  readonly code: AgentRuntimeE2EScriptConfigErrorCode
  constructor(code: AgentRuntimeE2EScriptConfigErrorCode, message: string, options?: ErrorOptions)
}

export declare const DEFAULT_AGENT_RUNTIME_E2E_SCRIPT: readonly AgentRuntimeE2EScriptedModelStep[]

/** Pure parser used by tests and by the sessionStorage boundary. */
export declare const parseAgentRuntimeE2EScriptJson: (
  source: string | null,
) => readonly AgentRuntimeE2EScriptedModelStep[]

export interface AgentRuntimeE2EScriptStorage {
  getItem(key: typeof AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY): string | null
}

export declare const readAgentRuntimeE2EScript: (
  storage?: AgentRuntimeE2EScriptStorage,
) => readonly AgentRuntimeE2EScriptedModelStep[]
