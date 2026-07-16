import type { AgentRuntimeFailure, RuntimeTaskCompensationTargetV1, ToolReceipt } from '@easy-editor/agent-runtime'
import type { CanonicalActiveDocumentV1, CanonicalWorkingDraftV1, JsonObject } from '../../../lib/storage/contracts.mjs'
import type {
  DashboardCompensationRunStateInput,
  DashboardCompensationRunStateResult,
  DashboardDurableAgentWriteSession,
} from '../../persistence-runtime.js'
import type {
  AffectedScreenFieldSlot,
  AffectedScreenStructuralSlot,
  ScreenChangeImage,
  ScreenInsertedNodeIdentity,
  ScreenInverseOperationRecord,
  ScreenMaterialRegistryVersion,
} from '../capabilities/screen/index.mjs'
import type { DurableAgentArtifactRefInputV1 } from '../persistence/durable-agent-commit.mjs'
import type { MutationProvenanceV1 } from '../persistence/index.mjs'
import type {
  ApplyWitnessV1,
  FailureWitnessV1,
  ReceiptIntentV1,
  ReceiptRecoveryResult,
  ToolReceiptV1,
} from '../persistence/receipt-ledger.mjs'

export declare const TASK_COMPENSATION_SCHEMA_VERSION: 1
export declare const TASK_COMPENSATE_CAPABILITY: 'task.compensate'
export declare const SCREEN_APPLY_CHANGESET_CAPABILITY: 'screen.applyChangeSet'

export interface TaskCompensateArgumentsV1 {
  readonly schemaVersion: 1
  readonly targetTaskId: string
}

export interface CompensationConflictV1 {
  readonly originalCallId: string
  readonly inverseCallId: string
  readonly code: 'POST_IMAGE_CHANGED' | 'PROVENANCE_CHANGED' | 'ANCHOR_INVALID' | 'IDENTITY_REUSED' | 'AMBIGUOUS'
  readonly slotKeys: readonly string[]
}

export interface CompensationRunBaseV1 {
  readonly schemaVersion: 1
  readonly compensationRunId: string
  readonly outerCallId: string
  readonly sessionId: string
  readonly taskId: string
  readonly cursor: number
  /** Reverse durable execution order. */
  readonly originalCallIds: readonly string[]
  readonly conflicts: readonly CompensationConflictV1[]
}

export type CompensationRunV1 = CompensationRunBaseV1 &
  (
    | { readonly status: 'running' | 'completed' | 'completed-with-conflicts'; readonly pause?: never }
    | {
        readonly status: 'paused'
        readonly pause: {
          readonly code: 'APPLIED_UNDURABLE' | 'AMBIGUOUS_RECEIPT' | 'PROVENANCE_UNCERTAIN' | 'PERSISTENCE_FAILURE'
          readonly resumeSafe: false
          readonly failure: AgentRuntimeFailure
        }
      }
  )

export interface CompensationTargetClaimV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly targetTaskId: string
  readonly outerCallId: string
  readonly status: 'active'
}

export interface ScreenCompensationPreImagesV1 {
  readonly schemaVersion: 1
  readonly kind: 'screen-change-set-pre-images'
  readonly documentId: string
  readonly baseMutationVersion: number
  readonly materialRegistryVersion: ScreenMaterialRegistryVersion
  readonly insertedNodeIdentities: readonly ScreenInsertedNodeIdentity[]
  readonly images: readonly ScreenChangeImage[]
  readonly inverseOperations: readonly ScreenInverseOperationRecord[]
  readonly affectedFieldSlots: readonly AffectedScreenFieldSlot[]
  readonly affectedStructuralSlots: readonly AffectedScreenStructuralSlot[]
  readonly affectedSlotKeys: readonly string[]
}

export interface ScreenCompensationPostImagesV1 {
  readonly schemaVersion: 1
  readonly kind: 'screen-change-set-post-images'
  readonly documentId: string
  readonly images: readonly ScreenChangeImage[]
  readonly affectedFieldSlots: readonly AffectedScreenFieldSlot[]
  readonly affectedStructuralSlots: readonly AffectedScreenStructuralSlot[]
  readonly affectedSlotKeys: readonly string[]
}

export interface ScreenCompensationPlanV1 {
  readonly schemaVersion: 1
  readonly documentId: string
  readonly baseMutationVersion: number
  readonly materialRegistryVersion: ScreenMaterialRegistryVersion
  readonly insertedNodeIdentities: readonly ScreenInsertedNodeIdentity[]
  readonly preImages: readonly ScreenChangeImage[]
  readonly expectedPostImages: readonly ScreenChangeImage[]
  readonly inverseOperations: readonly ScreenInverseOperationRecord[]
  readonly affectedFieldSlots: readonly AffectedScreenFieldSlot[]
  readonly affectedStructuralSlots: readonly AffectedScreenStructuralSlot[]
  readonly affectedSlotKeys: readonly string[]
}

export interface ScreenCompensationObservationV1 {
  readonly schemaVersion: 1
  readonly documentId: string
  readonly images: readonly ScreenChangeImage[]
  readonly identityStates: readonly {
    readonly nodeId: string
    readonly state: 'matches' | 'missing' | 'reused' | 'ambiguous'
  }[]
  readonly anchorStates: readonly {
    readonly sourceOperationId: string
    readonly state: 'valid' | 'invalid' | 'ambiguous'
  }[]
  readonly ambiguous: boolean
}

export interface CompensationInverseOutcomeV1 {
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly projectSchema: JsonObject
  readonly receipt: ToolReceiptV1
  readonly witness: ApplyWitnessV1 | FailureWitnessV1
  readonly provenance: readonly MutationProvenanceV1[]
  readonly updatedAt: number
  readonly artifactRefs?: readonly DurableAgentArtifactRefInputV1[]
}

export interface PreparedCompensationInverseV1 {
  readonly receiptIntent: ReceiptIntentV1
  execute(): Promise<CompensationInverseOutcomeV1>
}

export interface TaskCompensationPersistence {
  runAgentMutation?<T>(callId: string, operation: () => T): T
  readCompensationRun(request: {
    readonly schemaVersion: 1
    readonly projectId: string
    readonly branchId: string
    readonly sessionId: string
    readonly outerCallId: string
  }): Promise<JsonObject | null>
  readCompensationTargetClaim(request: {
    readonly schemaVersion: 1
    readonly projectId: string
    readonly branchId: string
    readonly sessionId: string
    readonly targetTaskId: string
  }): Promise<JsonObject | null>
  commitCompensationRunState(input: DashboardCompensationRunStateInput): Promise<DashboardCompensationRunStateResult>
  recoverDurableAgentReceipt(request: {
    readonly projectId: string
    readonly branchId: string
    readonly callId: string
  }): Promise<ReceiptRecoveryResult>
  runDurableAgentWrite<T>(operation: (session: DashboardDurableAgentWriteSession) => Promise<T>): Promise<T>
}

export interface TaskCompensationObserver {
  observe(input: {
    readonly schemaVersion: 1
    readonly projectId: string
    readonly branchId: string
    readonly sessionId: string
    readonly originalCallId: string
    readonly inverseCallId: string
    readonly plan: ScreenCompensationPlanV1
  }): Promise<ScreenCompensationObservationV1>
}

export interface TaskCompensationInverseExecutor {
  prepare(input: {
    readonly schemaVersion: 1
    readonly kind: 'inverse' | 'conflict' | 'empty'
    readonly projectId: string
    readonly branchId: string
    readonly sessionId: string
    readonly originalCallId: string
    readonly inverseCallId: string
    readonly plan: ScreenCompensationPlanV1 | null
    readonly observation: ScreenCompensationObservationV1 | null
    readonly conflict: CompensationConflictV1 | null
    readonly draft: CanonicalWorkingDraftV1
  }): Promise<PreparedCompensationInverseV1>
}

export interface TaskCompensationService {
  compensate(input: {
    readonly schemaVersion: 1
    readonly outerCallId: string
    readonly target: RuntimeTaskCompensationTargetV1
  }): Promise<ToolReceipt>
  query(input: { readonly schemaVersion: 1; readonly outerCallId: string }): Promise<ToolReceipt | null>
}

export interface TaskCompensationBeforeInverseInputV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly outerCallId: string
  readonly originalCallId: string
  readonly inverseCallId: string
}

export declare const parseTaskCompensateArguments: (value: unknown) => TaskCompensateArgumentsV1
export declare const parseRuntimeTaskCompensationTarget: (value: unknown) => RuntimeTaskCompensationTargetV1
export declare const parseCompensationRun: (value: unknown) => CompensationRunV1
export declare const createCompensationRun: (value: CompensationRunV1) => CompensationRunV1
export declare const parseCompensationTargetClaim: (value: unknown) => CompensationTargetClaimV1
export declare const parseScreenCompensationPlan: (value: {
  readonly preImages: unknown
  readonly expectedPostImages: unknown
}) => ScreenCompensationPlanV1
export declare const parseScreenCompensationObservation: (value: unknown) => ScreenCompensationObservationV1
export declare const inspectScreenCompensationSafety: (value: {
  readonly originalCallId: string
  readonly inverseCallId: string
  readonly plan: {
    readonly preImages: ScreenCompensationPreImagesV1
    readonly expectedPostImages: ScreenCompensationPostImagesV1
  }
  readonly observation: ScreenCompensationObservationV1
  readonly provenanceRecords: readonly (MutationProvenanceV1 | null)[]
}) => { readonly status: 'safe' } | { readonly status: 'conflict'; readonly conflict: CompensationConflictV1 }
export declare const deriveCompensationRunId: (value: {
  readonly projectId: string
  readonly branchId: string
  readonly outerCallId: string
}) => string
export declare const deriveInverseCompensationCallId: (value: {
  readonly projectId: string
  readonly branchId: string
  readonly outerCompensationCallId: string
  readonly originalCallId: string
}) => string
export declare const deriveEmptyCompensationCallId: (value: {
  readonly projectId: string
  readonly branchId: string
  readonly outerCompensationCallId: string
}) => string
export declare const compensationRunRecordId: (outerCallId: string) => string
export declare const compensationTargetClaimRecordId: (targetTaskId: string) => string
export declare const compensationCursorCheckpointId: (
  compensationRunId: string,
  cursor: number,
  inverseCallId: string,
) => string
export declare const projectCompensationRunReceipt: (value: {
  readonly projectId: string
  readonly branchId: string
  readonly run: CompensationRunV1
}) => ToolReceipt
export declare const createTaskCompensationService: (options: {
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly persistence: TaskCompensationPersistence
  readonly observer: TaskCompensationObserver
  readonly inverseExecutor: TaskCompensationInverseExecutor
  /** Runs before entering the serialized durable writer for each real inverse. */
  readonly beforeInverse?: (input: TaskCompensationBeforeInverseInputV1) => void | Promise<void>
  readonly now?: () => number
}) => TaskCompensationService

export * from './runtime-adapter.mjs'
