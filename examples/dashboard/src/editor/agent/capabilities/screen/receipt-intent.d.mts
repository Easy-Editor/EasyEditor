import type { ReceiptIntentV1, Sha256Digest, ToolReceiptV1 } from '../../persistence/receipt-ledger.mjs'
import type {
  AffectedScreenFieldSlot,
  AffectedScreenStructuralSlot,
  CompiledScreenCommand,
  ScreenChangeImage,
  ScreenInsertedNodeIdentity,
  ScreenInverseOperationRecord,
  ScreenManifestFingerprint,
  ScreenMaterialRegistryVersion,
  ScreenSemanticOperation,
} from './index.mjs'

export interface ScreenChangeSetPreImagesV1 {
  readonly schemaVersion: 1
  readonly kind: 'screen-change-set-pre-images'
  readonly documentId: string
  readonly baseMutationVersion: number
  readonly materialRegistryVersion: ScreenMaterialRegistryVersion
  readonly manifestFingerprints: readonly ScreenManifestFingerprint[]
  readonly insertedNodeIdentities: readonly ScreenInsertedNodeIdentity[]
  readonly operations: readonly ScreenSemanticOperation[]
  readonly commands: readonly CompiledScreenCommand[]
  readonly images: readonly ScreenChangeImage[]
  readonly inverseOperations: readonly ScreenInverseOperationRecord[]
  readonly affectedFieldSlots: readonly AffectedScreenFieldSlot[]
  readonly affectedStructuralSlots: readonly AffectedScreenStructuralSlot[]
  readonly affectedSlotKeys: readonly string[]
}

export interface ScreenChangeSetPostImagesV1 {
  readonly schemaVersion: 1
  readonly kind: 'screen-change-set-post-images'
  readonly documentId: string
  readonly images: readonly ScreenChangeImage[]
  readonly affectedFieldSlots: readonly AffectedScreenFieldSlot[]
  readonly affectedStructuralSlots: readonly AffectedScreenStructuralSlot[]
  readonly affectedSlotKeys: readonly string[]
}

export interface ScreenPreparedHashInputV1 {
  readonly schemaVersion: 1
  readonly kind: 'screen-apply-change-set-prepared'
  readonly capability: 'screen.applyChangeSet'
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly baseRevision: string
  readonly preImages: ScreenChangeSetPreImagesV1
  readonly expectedPostImages: ScreenChangeSetPostImagesV1
}

export declare const parseScreenChangeSetReceiptPayloads: (
  value: Readonly<{
    preImages: unknown
    expectedPostImages: unknown
  }>,
) => Readonly<{ preImages: ScreenChangeSetPreImagesV1; expectedPostImages: ScreenChangeSetPostImagesV1 }>

export declare const createScreenPreparedHashInput: (
  value: Omit<ScreenPreparedHashInputV1, 'schemaVersion' | 'kind' | 'capability'>,
) => ScreenPreparedHashInputV1
export declare const createScreenTransactionFingerprintInput: (
  value: Readonly<{
    callId: string
    documentId: string
    baseMutationVersion: number
    materialRegistryVersion: ScreenMaterialRegistryVersion
    manifestFingerprints: readonly ScreenManifestFingerprint[]
    insertedNodeIdentities: readonly ScreenInsertedNodeIdentity[]
    commands: readonly CompiledScreenCommand[]
  }>,
) => Readonly<Record<string, unknown>>

export type ScreenReceiptIntentVerification =
  | Readonly<{ classification: 'indeterminate'; reason: string }>
  | Readonly<{
      classification: 'verified'
      receiptIntent: ReceiptIntentV1
      payloads: Readonly<{ preImages: ScreenChangeSetPreImagesV1; expectedPostImages: ScreenChangeSetPostImagesV1 }>
      transactionFingerprint: Sha256Digest
    }>

export declare const verifyScreenReceiptIntentRecovery: (
  value: Readonly<{
    receiptIntent: ReceiptIntentV1
    receipt: ToolReceiptV1
    hashCanonicalJson(value: unknown): Promise<Sha256Digest>
  }>,
) => Promise<ScreenReceiptIntentVerification>
