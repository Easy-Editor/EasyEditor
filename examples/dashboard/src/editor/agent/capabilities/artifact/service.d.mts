import type { AgentRuntimeFailure, ToolReceipt } from '@easy-editor/agent-runtime'
import type {
  ArtifactCreateResultV1,
  ArtifactReadRequestV1,
  ArtifactRecordV1,
  LockedArtifactDependencyV1,
  OnlineArtifactRef,
} from '../../../../lib/storage/artifact-contracts.mjs'
import type { CanonicalWorkingDraftV1 } from '../../../../lib/storage/contracts.mjs'
import type { JsonObject } from '../../persistence/contract.mjs'
import type { DurableAgentBatchV1, DurableAgentCommitResultV1 } from '../../persistence/durable-agent-commit.mjs'
import type { ReceiptIntentV1, ReceiptRecoveryResult } from '../../persistence/receipt-ledger.mjs'
import type {
  OnlineArtifactAuthority,
  OnlineArtifactCoreResult,
  OnlineArtifactCreateCall,
  OnlineArtifactPrepareResult,
  OnlineArtifactProjectCapture,
  OnlineArtifactRect,
  OnlineArtifactRelativePosition,
  OnlineArtifactReviseCall,
} from './contract.mjs'

export declare const ONLINE_ARTIFACT_FAILURE_CODE: Readonly<{
  appliedUndurable: 'APPLIED_UNDURABLE'
  coreTransactionFailed: 'CORE_TRANSACTION_FAILED'
  indeterminateCoreOutcome: 'INDETERMINATE_CORE_OUTCOME'
  indeterminateReceipt: 'INDETERMINATE_RECEIPT'
  persistenceFailure: 'PERSISTENCE_FAILURE'
}>

export type OnlineArtifactCoreOutcome = 'applied' | 'indeterminate' | 'not-applied'

export declare class OnlineArtifactCoreOutcomeError extends Error {
  readonly name: 'OnlineArtifactCoreOutcomeError'
  readonly outcome: OnlineArtifactCoreOutcome
  constructor(outcome: OnlineArtifactCoreOutcome, message: string, options?: ErrorOptions)
}

export interface OnlineArtifactCoreFailureClassifiers {
  isTransactionCommittedError?(error: unknown): boolean
  isTransactionRollbackIncompleteError?(error: unknown): boolean
}

export declare const classifyOnlineArtifactCoreFailure: (
  error: unknown,
  options?: OnlineArtifactCoreFailureClassifiers,
) => OnlineArtifactCoreOutcome

export interface OnlineArtifactCreatePrepareInput {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly expectedRevision: string
  readonly documentId: string
  readonly parentId: string
  readonly position: OnlineArtifactRelativePosition
  readonly props?: JsonObject
  readonly rect?: OnlineArtifactRect
  readonly nodeId: string
}

export interface OnlineArtifactRevisePrepareInput {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly expectedRevision: string
  readonly nodeId: string
}

interface OnlineArtifactCoreMutationInputBase {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly documentId: string
  readonly nodeId: string
  readonly expectedMutationVersion: number
  readonly artifactRef: OnlineArtifactRef
}

export interface OnlineArtifactCreateCoreInput extends OnlineArtifactCoreMutationInputBase {
  readonly parentId: string
  readonly position: OnlineArtifactRelativePosition
  readonly props?: JsonObject
  readonly rect?: OnlineArtifactRect
}

export interface OnlineArtifactReviseCoreInput extends OnlineArtifactCoreMutationInputBase {
  readonly previousArtifactRef: OnlineArtifactRef
}

export interface OnlineArtifactCorePort {
  prepareCreate(input: OnlineArtifactCreatePrepareInput): Promise<OnlineArtifactPrepareResult>
  prepareRevise(input: OnlineArtifactRevisePrepareInput): Promise<OnlineArtifactPrepareResult>
  createOnline(input: OnlineArtifactCreateCoreInput): Promise<OnlineArtifactCoreResult>
  reviseOnline(input: OnlineArtifactReviseCoreInput): Promise<OnlineArtifactCoreResult>
  captureProject(): Promise<OnlineArtifactProjectCapture>
}

export interface OnlineArtifactDurableWriteSession {
  readonly draft: Pick<CanonicalWorkingDraftV1, 'draftGeneration'>
  recordIntent(intent: ReceiptIntentV1): Promise<ReceiptIntentV1>
  commitBatch(batch: DurableAgentBatchV1): Promise<DurableAgentCommitResultV1>
}

export interface OnlineArtifactPersistencePort {
  createArtifact(artifact: ArtifactRecordV1): Promise<ArtifactCreateResultV1>
  readArtifact(request: ArtifactReadRequestV1): Promise<ArtifactRecordV1 | null>
  recoverDurableAgentReceipt(
    request: Readonly<{ projectId: string; branchId: string; callId: string }>,
  ): Promise<ReceiptRecoveryResult>
  runDurableAgentWrite<T>(operation: (session: OnlineArtifactDurableWriteSession) => Promise<T>): Promise<T>
}

export interface OnlineArtifactDependencyResolver {
  resolve(request: Readonly<{ package: string; range: string }>): Promise<LockedArtifactDependencyV1>
}

export interface OnlineArtifactPostImagesV1 {
  readonly schemaVersion: 1
  readonly kind: 'online-artifact-post-images'
  readonly componentName: 'GeneratedMaterialHost'
  readonly nodeId: string
  readonly artifactRef: OnlineArtifactRef
}

interface OnlineArtifactInvocationBase {
  readonly schemaVersion: 1
  readonly callId: string
  readonly revision?: string
}

export type OnlineArtifactInvocationResult =
  | (OnlineArtifactInvocationBase & {
      readonly status: 'applied'
      readonly output: OnlineArtifactPostImagesV1
      readonly failure?: never
    })
  | (OnlineArtifactInvocationBase & {
      readonly status: 'not-applied' | 'indeterminate' | 'rejected'
      readonly failure: AgentRuntimeFailure
      readonly output?: never
    })

export interface DashboardOnlineArtifactCapabilityService {
  createOnline(call: OnlineArtifactCreateCall): Promise<OnlineArtifactInvocationResult>
  queryReceipt(request: Readonly<{ projectId: string; branchId: string; callId: string }>): Promise<ToolReceipt | null>
  reviseOnline(call: OnlineArtifactReviseCall): Promise<OnlineArtifactInvocationResult>
}

export interface DashboardOnlineArtifactCapabilityServiceOptions extends OnlineArtifactCoreFailureClassifiers {
  readonly authority: OnlineArtifactAuthority
  readonly core: OnlineArtifactCorePort
  readonly persistence: OnlineArtifactPersistencePort
  readonly resolver: OnlineArtifactDependencyResolver
  readonly now?: () => number
  readonly crypto?: Crypto
}

export declare const createDashboardOnlineArtifactCapabilityService: (
  options: DashboardOnlineArtifactCapabilityServiceOptions,
) => DashboardOnlineArtifactCapabilityService
