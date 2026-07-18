import type { AgentRuntimeFailure } from '@easy-editor/agent-runtime'
import type {
  ArtifactReadRequestV1,
  ArtifactRecordV1,
  LocalMaterialArtifactRef,
  OnlineArtifactRef,
} from '../../../../lib/storage/artifact-contracts.mjs'
import type { CanonicalWorkingDraftV1 } from '../../../../lib/storage/contracts.mjs'
import type { DurableAgentBatchV1, DurableAgentCommitResultV1 } from '../../persistence/durable-agent-commit.mjs'
import type { ReceiptIntentV1, ReceiptRecoveryResult, ToolReceiptV1 } from '../../persistence/receipt-ledger.mjs'
import type {
  OnlineArtifactCoreResult,
  OnlineArtifactPrepareResult,
  OnlineArtifactProjectCapture,
} from '../artifact/contract.mjs'
import type {
  LocalMaterialPromotionAuthority,
  LocalMaterialPromotionCall,
  LocalMaterialPromotionJournalRecordV1,
  LocalMaterialPromotionServerResultV1,
} from './contract.mjs'

export declare const LOCAL_MATERIAL_PROMOTION_FAILURE_CODE: Readonly<{
  appliedUndurable: 'APPLIED_UNDURABLE'
  coreTransactionFailed: 'CORE_TRANSACTION_FAILED'
  idempotencyConflict: 'IDEMPOTENCY_CONFLICT'
  indeterminateCoreOutcome: 'INDETERMINATE_CORE_OUTCOME'
  indeterminateReceipt: 'INDETERMINATE_RECEIPT'
  indeterminateServerOutcome: 'INDETERMINATE_SERVER_OUTCOME'
  persistenceFailure: 'PERSISTENCE_FAILURE'
  serverPromotionFailed: 'SERVER_PROMOTION_FAILED'
}>

export interface LocalMaterialPromotionPrepareInput {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly expectedRevision: string
  readonly nodeId: string
}

interface LocalMaterialPromotionCoreMutationInputBase {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly documentId: string
  readonly nodeId: string
  readonly expectedMutationVersion: number
}

export interface LocalMaterialPromotionSwitchInput extends LocalMaterialPromotionCoreMutationInputBase {
  readonly previousArtifactRef: OnlineArtifactRef
  readonly artifactRef: LocalMaterialArtifactRef
}

export interface LocalMaterialPromotionRestoreInput extends LocalMaterialPromotionCoreMutationInputBase {
  readonly previousArtifactRef: LocalMaterialArtifactRef
  readonly artifactRef: OnlineArtifactRef
}

export interface LocalMaterialPromotionCorePort {
  prepareSwitch(input: LocalMaterialPromotionPrepareInput): Promise<OnlineArtifactPrepareResult>
  switchRef(input: LocalMaterialPromotionSwitchInput): Promise<OnlineArtifactCoreResult>
  restoreOnline(input: LocalMaterialPromotionRestoreInput): Promise<OnlineArtifactCoreResult>
  captureProject(): Promise<OnlineArtifactProjectCapture>
}

export interface LocalMaterialPromotionDurableWriteSession {
  readonly draft: Pick<CanonicalWorkingDraftV1, 'draftGeneration'>
  recordIntent(intent: ReceiptIntentV1): Promise<ReceiptIntentV1>
  commitBatch(batch: DurableAgentBatchV1): Promise<DurableAgentCommitResultV1>
}

export interface LocalMaterialPromotionPersistencePort {
  readArtifact(request: ArtifactReadRequestV1): Promise<ArtifactRecordV1 | null>
  recoverDurableAgentReceipt(
    request: Readonly<{ projectId: string; branchId: string; callId: string }>,
  ): Promise<ReceiptRecoveryResult>
  readPromotionJournal(
    request: Readonly<{
      schemaVersion: 1
      projectId: string
      branchId: string
      sessionId: string
      callId: string
    }>,
  ): Promise<LocalMaterialPromotionJournalRecordV1 | null>
  listPromotionJournals(
    request: Readonly<{
      schemaVersion: 1
      projectId: string
      branchId: string
      sessionId: string
    }>,
  ): Promise<readonly LocalMaterialPromotionJournalRecordV1[]>
  writePromotionJournal(journal: LocalMaterialPromotionJournalRecordV1): Promise<LocalMaterialPromotionJournalRecordV1>
  runDurableAgentWrite<T>(operation: (session: LocalMaterialPromotionDurableWriteSession) => Promise<T>): Promise<T>
}

export interface LocalMaterialPromotionClientRequestV1 extends LocalMaterialPromotionAuthority {
  readonly schemaVersion: 1
  readonly stepId: string
  readonly callId: string
  readonly callDigest: `sha256:${string}`
  readonly promotionId: `sha256:${string}`
  readonly artifact: ArtifactRecordV1
}

export interface LocalMaterialPromotionClientPort {
  promote(request: LocalMaterialPromotionClientRequestV1): Promise<LocalMaterialPromotionServerResultV1>
  queryPromotion(request: Readonly<{ promotionId: string }>): Promise<LocalMaterialPromotionServerResultV1 | null>
}

export interface LocalMaterialPromotionPostImagesV1 {
  readonly schemaVersion: 1
  readonly kind: 'local-material-promotion-post-images'
  readonly componentName: 'GeneratedMaterialHost'
  readonly nodeId: string
  readonly artifactRef: LocalMaterialArtifactRef
}

interface LocalMaterialPromotionInvocationBase {
  readonly schemaVersion: 1
  readonly callId: string
  readonly revision?: string
}

export type LocalMaterialPromotionInvocationResult =
  | (LocalMaterialPromotionInvocationBase & {
      readonly status: 'applied'
      readonly output: LocalMaterialPromotionPostImagesV1
      readonly failure?: never
    })
  | (LocalMaterialPromotionInvocationBase & {
      readonly status: 'not-applied' | 'indeterminate' | 'rejected'
      readonly failure: AgentRuntimeFailure
      readonly output?: never
    })

export interface DashboardLocalMaterialPromotionCapabilityService {
  promoteLocal(call: LocalMaterialPromotionCall): Promise<LocalMaterialPromotionInvocationResult>
  queryReceipt(
    request: Readonly<{ projectId: string; branchId: string; callId: string }>,
  ): Promise<ToolReceiptV1 | null>
  resumePending(): Promise<Readonly<{ schemaVersion: 1; results: readonly LocalMaterialPromotionInvocationResult[] }>>
}

export interface DashboardLocalMaterialPromotionCapabilityServiceOptions {
  readonly authority: LocalMaterialPromotionAuthority
  readonly core: LocalMaterialPromotionCorePort
  readonly persistence: LocalMaterialPromotionPersistencePort
  readonly client: LocalMaterialPromotionClientPort
  readonly now?: () => number
  readonly crypto?: Crypto
  readonly isTransactionCommittedError?: (error: unknown) => boolean
  readonly isTransactionRollbackIncompleteError?: (error: unknown) => boolean
}

export declare const createDashboardLocalMaterialPromotionCapabilityService: (
  options: DashboardLocalMaterialPromotionCapabilityServiceOptions,
) => DashboardLocalMaterialPromotionCapabilityService
