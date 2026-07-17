import type { AgentRuntime, BoundAgentRuntimeBinding } from '@easy-editor/agent-runtime'
import type { ReceiptRecoveryResult } from '../../../editor/agent/persistence/receipt-ledger.mjs'
import type {
  DashboardCompensationRunListRecordV1,
  DashboardCompensationRunListRequestV1,
} from '../../../lib/storage/contracts.mjs'
import type { AgentWorkspacePersistenceRecovery, AgentWorkspaceRecoveryAction } from './command-port-adapter.ts'
import type { AgentWorkspaceRecoveryProjection } from './types.ts'

export interface DashboardAgentWorkspaceProductionRecoveryPersistence {
  listCompensationRuns(
    request: DashboardCompensationRunListRequestV1,
  ): Promise<readonly DashboardCompensationRunListRecordV1[]>
  recoverDurableAgentReceipt(request: {
    readonly projectId: string
    readonly branchId: string
    readonly callId: string
  }): Promise<ReceiptRecoveryResult>
}

export interface DashboardAgentWorkspaceProductionRecoveryBridge {
  list(input: {
    readonly binding: BoundAgentRuntimeBinding
    readonly runtime?: AgentRuntime
  }): Promise<readonly AgentWorkspacePersistenceRecovery[]>
  retry(input: {
    readonly binding: BoundAgentRuntimeBinding
    readonly recoveryId: string
    readonly kind: Exclude<AgentWorkspaceRecoveryProjection['kind'], 'unsaved'>
    readonly action: AgentWorkspaceRecoveryAction
    readonly runtime?: AgentRuntime
  }): Promise<void>
}

export type AgentWorkspaceManualReconciliationClassification = 'missing' | 'indeterminate'

export declare class AgentWorkspaceManualReconciliationRequiredError extends Error {
  readonly code: 'agent-workspace-manual-reconciliation-required'
  readonly recoveryId: string
  readonly taskId: string
  readonly callId: string
  readonly classification: AgentWorkspaceManualReconciliationClassification
  constructor(input: {
    readonly recoveryId: string
    readonly taskId: string
    readonly callId: string
    readonly classification: AgentWorkspaceManualReconciliationClassification
    readonly reason?: string
  })
}

export declare const createDashboardAgentWorkspaceProductionRecoveryBridge: (input: {
  readonly persistence: DashboardAgentWorkspaceProductionRecoveryPersistence
}) => DashboardAgentWorkspaceProductionRecoveryBridge
