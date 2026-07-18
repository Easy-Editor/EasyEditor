import type { InvocationResult, SemanticCall } from '@easy-editor/agent-runtime'
import type { ArtifactMaterialIdentityV1 } from '../../../../lib/storage/artifact-contracts.mjs'
import type { CanonicalActiveDocumentV1, CanonicalWorkingDraftV1 } from '../../../../lib/storage/contracts.mjs'
import type { DurableAgentBatchV1 } from '../../persistence/durable-agent-commit.mjs'
import type { ReceiptIntentV1, ReceiptRecoveryResult, ToolReceiptV1 } from '../../persistence/receipt-ledger.mjs'
import type { DashboardAgentTelemetryLedger } from '../../telemetry/index.mjs'
import type {
  DashboardMaterialGcAdmissionInput,
  DashboardMaterialGcRuntime,
} from '../promotion/material-gc-runtime.mjs'
import type {
  CompileScreenChangeSetInput,
  CompiledScreenChangeSet,
  SafeMaterialManifest,
  ScreenCompileDocument,
  ScreenJsonObject,
  ScreenJsonValue,
  ScreenMaterialRegistryVersion,
  ScreenSemanticChangeSet,
} from './index.mjs'

export declare const SCREEN_APPLY_CHANGESET_FAILURE_CODE: Readonly<{
  appliedUndurable: 'APPLIED_UNDURABLE'
  coreTransactionFailed: 'CORE_TRANSACTION_FAILED'
  humanActivity: 'HUMAN_ACTIVITY'
  indeterminateCoreOutcome: 'INDETERMINATE_CORE_OUTCOME'
  indeterminateReceipt: 'INDETERMINATE_RECEIPT'
  invalidMaterialRef: 'INVALID_MATERIAL_REF'
  materialAdmissionFailed: 'MATERIAL_ADMISSION_FAILED'
  noChange: 'NO_CHANGE'
  persistenceFailure: 'PERSISTENCE_FAILURE'
  rollbackIncomplete: 'TRANSACTION_ROLLBACK_INCOMPLETE'
  staleRevision: 'STALE_REVISION'
}>

export declare class ScreenApplyChangeSetError extends TypeError {
  readonly name: 'ScreenApplyChangeSetError'
  readonly code: string
  readonly reason: string
  readonly details: ScreenJsonObject
  constructor(code: string, reason: string, details?: ScreenJsonObject)
  toJSON(): Readonly<{
    schemaVersion: 1
    code: string
    reason: string
    details: ScreenJsonObject
  }>
}

export interface ScreenApplyChangeSetAuthority {
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly taskId: string
}

export type ScreenApplyChangeSetCall = Omit<SemanticCall, 'capability' | 'arguments'> & {
  readonly capability: 'screen.applyChangeSet'
  readonly arguments: ScreenSemanticChangeSet
}

export interface ScreenApplyFullSnapshot {
  readonly revision: string
  readonly [key: string]: ScreenJsonValue
}

export interface ScreenApplyPrepareContext<DocumentHandle = unknown> {
  readonly documentHandle: DocumentHandle
  readonly document: ScreenCompileDocument
  readonly materialRegistryVersion: ScreenMaterialRegistryVersion
  readonly manifests: readonly SafeMaterialManifest[]
  /** Exact JSON fence containing document binding, provider, registry, and manifest generations. */
  readonly fence: ScreenJsonValue
}

export interface ScreenApplyProjectCapture {
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly projectSchema: ScreenJsonObject
}

export interface ScreenApplyDurableWriteSession {
  readonly draft: Pick<CanonicalWorkingDraftV1, 'draftGeneration'>
  recordIntent(intent: ReceiptIntentV1): Promise<ReceiptIntentV1>
  commitBatch(batch: DurableAgentBatchV1): Promise<Readonly<{ receipt: ToolReceiptV1 }>>
}

export interface ScreenApplyPersistencePort {
  runAgentMutation?<T>(callId: string, operation: () => T): T
  recoverDurableAgentReceipt(
    request: Readonly<{ projectId: string; branchId: string; callId: string }>,
  ): Promise<ReceiptRecoveryResult>
  runDurableAgentWrite<T>(operation: (session: ScreenApplyDurableWriteSession) => Promise<T>): Promise<T>
}

export interface ScreenApplyMaterialAdmissionInputV1 extends DashboardMaterialGcAdmissionInput {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly materialRefs: readonly Readonly<ArtifactMaterialIdentityV1>[]
  readonly reason: 'screen-apply'
}

export interface ScreenApplyChangeSetDependencies<DocumentHandle = unknown> {
  readonly authority: ScreenApplyChangeSetAuthority
  readonly activityLease: Readonly<{
    readonly generation: number
    isActive(): boolean
    waitUntilIdle(): Promise<Readonly<{ generation: number }>>
  }>
  readonly persistence: ScreenApplyPersistencePort
  readonly admitMaterialRefsUnderSharedMutation?: (
    input: Readonly<ScreenApplyMaterialAdmissionInputV1>,
  ) => unknown | PromiseLike<unknown>
  captureFullSnapshot(): Promise<ScreenApplyFullSnapshot>
  capturePrepareContext(
    input: Readonly<{
      call: ScreenApplyChangeSetCall
      changeSet: ScreenSemanticChangeSet
      snapshot: ScreenApplyFullSnapshot
    }>,
  ): Promise<ScreenApplyPrepareContext<DocumentHandle>>
  captureCurrentFence(
    input: Readonly<{
      call: ScreenApplyChangeSetCall
      prepared: ScreenApplyPrepareContext<DocumentHandle>
    }>,
  ): Promise<ScreenJsonValue>
  captureDocumentState(handle: DocumentHandle): ScreenCompileDocument | Promise<ScreenCompileDocument>
  captureProject(): ScreenApplyProjectCapture | Promise<ScreenApplyProjectCapture>
  compileChangeSet(input: CompileScreenChangeSetInput): Readonly<CompiledScreenChangeSet>
  createTelemetryChangeSetId?(callId: string): string
  hashCanonicalJson(value: ScreenJsonValue): Promise<`sha256:${string}`>
  runOnDocument(
    handle: DocumentHandle,
    commands: CompiledScreenChangeSet['commands'],
    options: Readonly<{ agentCallId: string; expectedMutationVersion: number }>,
  ): unknown | Promise<unknown>
  isTransactionCommittedError(error: unknown): boolean
  isTransactionRollbackIncompleteError(error: unknown): boolean
  now(): number
  readonly telemetry?: Pick<DashboardAgentTelemetryLedger, 'record'>
  readonly telemetryNow?: () => number
}

type AssertTrue<Value extends true> = Value
type _DashboardScreenAdmissionPortCompatibility = AssertTrue<
  DashboardMaterialGcRuntime['admitMaterialRefsUnderSharedMutation'] extends NonNullable<
    ScreenApplyChangeSetDependencies['admitMaterialRefsUnderSharedMutation']
  >
    ? true
    : false
>

export type ScreenApplyChangeSetHandler = (call: SemanticCall) => Promise<InvocationResult>

export declare const createScreenApplyChangeSetHandler: <DocumentHandle = unknown>(
  dependencies: ScreenApplyChangeSetDependencies<DocumentHandle>,
) => ScreenApplyChangeSetHandler
