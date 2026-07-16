export { PersistenceLineageContractError } from './contract.mjs'

export type FieldSlotRoot = 'props' | 'extras'
export type ProvenanceSource = 'agent' | 'external' | 'human' | 'unknown'
export type ProvenanceToken = 'human' | 'external' | 'unknown' | `agent:${string}`

export interface FieldSlotInput {
  readonly projectId: string
  readonly branchId: string
  readonly nodeId: string
  readonly root: FieldSlotRoot
  readonly path: readonly string[]
}

export interface NodeSlotInput {
  readonly projectId: string
  readonly branchId: string
  readonly nodeId: string
}

export interface ChildrenOrderSlotInput {
  readonly projectId: string
  readonly branchId: string
  readonly parentId: string
}

export interface MutationProvenanceV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly slotKey: string
  readonly draftGeneration: number
  readonly token: ProvenanceToken
}

export interface ProvenanceEvidence {
  readonly source?: ProvenanceSource | 'unclassified'
  readonly callId?: string
  readonly ambiguous?: boolean
  readonly listenerGap?: boolean
  readonly restartGap?: boolean
}

export interface MutationProvenanceBatchInput extends ProvenanceEvidence {
  readonly projectId: string
  readonly branchId: string
  readonly draftGeneration: number
  readonly slotKeys: readonly string[]
  readonly source: ProvenanceSource | 'unclassified'
}

export declare const HUMAN_PROVENANCE_TOKEN: 'human'
export declare const EXTERNAL_PROVENANCE_TOKEN: 'external'
export declare const UNKNOWN_PROVENANCE_TOKEN: 'unknown'

export declare const toRfc6901Pointer: (path: readonly string[]) => string
export declare const createFieldSlotKey: (input: FieldSlotInput) => string
export declare const createFieldSlotAliases: (input: FieldSlotInput) => readonly string[]
export declare const createNodeExistenceSlotKey: (input: NodeSlotInput) => string
export declare const createNodeParentSlotKey: (input: NodeSlotInput) => string
export declare const createNodeSubtreeSlotKey: (input: NodeSlotInput) => string
export declare const createNodeStructuralSlotKeys: (input: NodeSlotInput) => readonly string[]
export declare const createChildrenOrderSlotKey: (input: ChildrenOrderSlotInput) => string
export declare const createAgentProvenanceToken: (callId: string) => `agent:${string}`
export declare const parseProvenanceToken: (
  token: unknown,
) => { readonly source: 'human' | 'external' | 'unknown' } | { readonly source: 'agent'; readonly callId: string }
export declare const resolveProvenanceToken: (evidence: ProvenanceEvidence) => ProvenanceToken
export declare const parseMutationProvenance: (value: unknown) => MutationProvenanceV1
export declare const createMutationProvenance: (value: MutationProvenanceV1) => MutationProvenanceV1
export declare const createMutationProvenanceBatch: (
  input: MutationProvenanceBatchInput,
) => readonly MutationProvenanceV1[]
