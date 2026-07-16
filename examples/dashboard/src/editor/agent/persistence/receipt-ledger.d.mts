import type { JsonObject, JsonValue } from './contract.mjs'
import type { ProvenanceToken } from './provenance.mjs'

export { PersistenceLineageContractError } from './contract.mjs'

export type Sha256Digest = `sha256:${string}`
export type ToolReceiptStatus = 'applied' | 'not-applied' | 'indeterminate' | 'rejected'
export type FailedToolReceiptStatus = 'not-applied' | 'rejected'

export interface ReceiptIntentV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly preparedHash: Sha256Digest
  readonly baseRevision: string
  readonly preImages: JsonValue
  readonly expectedPostImages: JsonValue
  readonly status: 'pending'
}

export interface AffectedSlotToken extends JsonObject {
  readonly slotKey: string
  readonly token: ProvenanceToken
}

export interface ApplyWitnessV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly draftGeneration: number
  readonly coreMutationVersion: number
  readonly transactionFingerprint: Sha256Digest
  readonly affectedSlotTokens: readonly AffectedSlotToken[]
}

export interface FailureWitnessV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly draftGeneration: number
  readonly transactionFingerprint: Sha256Digest
  readonly receiptStatus: FailedToolReceiptStatus
  readonly failureCode: string
}

export interface ApplyReceiptWitnessReference extends JsonObject {
  readonly schemaVersion: 1
  readonly kind: 'apply'
  readonly draftGeneration: number
  readonly coreMutationVersion: number
  readonly transactionFingerprint: Sha256Digest
  readonly affectedSlotTokens: readonly AffectedSlotToken[]
}

export interface FailureReceiptWitnessReference extends JsonObject {
  readonly schemaVersion: 1
  readonly kind: 'failure'
  readonly draftGeneration: number
  readonly transactionFingerprint: Sha256Digest
  readonly receiptStatus: FailedToolReceiptStatus
  readonly failureCode: string
}

export interface ToolReceiptV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly status: ToolReceiptStatus
  readonly revision?: string
  readonly witness?: JsonObject
}

export interface ReceiptRecoveryEvidence {
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly receiptIntent?: ReceiptIntentV1 | null
  readonly receipt?: ToolReceiptV1 | null
  readonly applyWitness?: ApplyWitnessV1 | null
  readonly failureWitness?: FailureWitnessV1 | null
}

export type ReceiptRecoveryResult =
  | { readonly classification: 'committed' | 'failed'; readonly receipt: ToolReceiptV1 }
  | { readonly classification: 'indeterminate'; readonly reason: string }

export declare const parseReceiptIntent: (value: unknown) => ReceiptIntentV1
export declare const createReceiptIntent: (value: ReceiptIntentV1) => ReceiptIntentV1
export declare const parseToolReceipt: (value: unknown) => ToolReceiptV1
export declare const createToolReceipt: (value: ToolReceiptV1) => ToolReceiptV1
export declare const parseApplyWitness: (value: unknown) => ApplyWitnessV1
export declare const createApplyWitness: (value: ApplyWitnessV1) => ApplyWitnessV1
export declare const parseFailureWitness: (value: unknown) => FailureWitnessV1
export declare const createFailureWitness: (value: FailureWitnessV1) => FailureWitnessV1
export declare const createToolReceiptWitness: (
  witness: ApplyWitnessV1 | FailureWitnessV1,
) => ApplyReceiptWitnessReference | FailureReceiptWitnessReference
export declare const classifyReceiptRecovery: (evidence: ReceiptRecoveryEvidence) => ReceiptRecoveryResult
