export type ScreenJsonPrimitive = null | boolean | number | string
export type ScreenJsonValue = ScreenJsonPrimitive | ScreenJsonObject | readonly ScreenJsonValue[]
export interface ScreenJsonObject {
  readonly [key: string]: ScreenJsonValue
}

export type ScreenMaterialRegistryVersion = number | string

export interface ScreenSafeManifestTarget {
  readonly path: readonly string[]
  readonly valuePath?: readonly string[]
}

export interface ScreenSafeManifestField {
  readonly fieldId: string
  readonly access: 'read-only' | 'read-write' | 'unsupported'
  readonly title?: string
  readonly required?: boolean
  readonly readPath?: readonly string[]
  readonly writeTargets?: readonly ScreenSafeManifestTarget[]
  readonly unsetTargets?: readonly ScreenSafeManifestTarget[]
  readonly valueSchema?: ScreenJsonObject
  readonly verifyPaths?: readonly (readonly string[])[]
}

export interface ScreenSafeManifestDiagnostic {
  readonly code: string
  readonly message: string
  readonly fieldId?: string
  readonly sourcePath?: string
}

export interface ScreenSafeMaterialManifest {
  readonly schemaVersion: 1
  readonly materialRegistryVersion: ScreenMaterialRegistryVersion
  readonly componentName: string
  readonly title?: string
  readonly group?: string
  readonly category?: string
  readonly fields: readonly ScreenSafeManifestField[]
  readonly diagnostics: readonly ScreenSafeManifestDiagnostic[]
  readonly readiness: {
    readonly status: 'ready' | 'not-ready'
    readonly missingFieldIds: readonly string[]
    readonly unsupportedFieldIds: readonly string[]
  }
}

export interface ScreenChangeSetLimits {
  readonly maxArrayLength: number
  readonly maxDocumentNodes: number
  readonly maxFieldsPerManifest: number
  readonly maxInputBytes: number
  readonly maxJsonDepth: number
  readonly maxJsonNodes: number
  readonly maxManifests: number
  readonly maxOperations: number
  readonly maxOutputBytes: number
  readonly maxPathSegmentLength: number
  readonly maxPathSegments: number
  readonly maxStringLength: number
}

export type ScreenChangeSetCompileErrorCode =
  | 'AMBIGUOUS_STRUCTURE'
  | 'BUDGET_EXCEEDED'
  | 'INVALID_CHANGESET'
  | 'INVALID_JSON'
  | 'INVALID_MANIFEST'
  | 'INVERSE_UNREPRESENTABLE'
  | 'STALE_MUTATION_VERSION'
  | 'UNKNOWN_FIELD'
  | 'UNKNOWN_MATERIAL'
  | 'UNKNOWN_NODE'
  | 'UNSUPPORTED_FIELD'
  | 'UNSUPPORTED_VALUE_SCHEMA'
  | 'VALUE_CONSTRAINT'
  | 'WRITE_CONFLICT'

export declare const SCREEN_CHANGESET_SCHEMA_VERSION: 1
export declare const DEFAULT_SCREEN_CHANGESET_LIMITS: Readonly<ScreenChangeSetLimits>

export declare class ScreenChangeSetCompileError extends TypeError {
  constructor(code: ScreenChangeSetCompileErrorCode, reason: string, path?: string)
  readonly name: 'ScreenChangeSetCompileError'
  readonly code: ScreenChangeSetCompileErrorCode
  readonly reason: string
  readonly path: string
  toJSON(): {
    readonly schemaVersion: 1
    readonly code: ScreenChangeSetCompileErrorCode
    readonly reason: string
    readonly path: string
  }
}

export interface ScreenRectValue {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type ScreenRelativePosition =
  | { readonly place: 'first' }
  | { readonly place: 'last' }
  | { readonly place: 'before'; readonly siblingId: string }
  | { readonly place: 'after'; readonly siblingId: string }

export interface ScreenSetOperation {
  readonly opId: string
  readonly type: 'set'
  readonly nodeId: string
  readonly fieldId: string
  readonly value: ScreenJsonValue
}

export interface ScreenUnsetOperation {
  readonly opId: string
  readonly type: 'unset'
  readonly nodeId: string
  readonly fieldId: string
}

export interface ScreenResizeOperation {
  readonly opId: string
  readonly type: 'resize'
  readonly nodeId: string
  readonly rect: ScreenRectValue
}

export interface ScreenInsertOperation {
  readonly opId: string
  readonly type: 'insert'
  readonly parentId: string
  readonly componentName: string
  readonly position?: ScreenRelativePosition
  readonly fields?: Readonly<Record<string, ScreenJsonValue>>
}

export interface ScreenMoveOperation {
  readonly opId: string
  readonly type: 'move'
  readonly nodeId: string
  readonly parentId: string
  readonly position?: ScreenRelativePosition
}

export interface ScreenReorderOperation {
  readonly opId: string
  readonly type: 'reorder'
  readonly nodeId: string
  readonly position: ScreenRelativePosition
}

export interface ScreenRemoveOperation {
  readonly opId: string
  readonly type: 'remove'
  readonly nodeId: string
}

export type ScreenSemanticOperation =
  | ScreenInsertOperation
  | ScreenMoveOperation
  | ScreenRemoveOperation
  | ScreenReorderOperation
  | ScreenResizeOperation
  | ScreenSetOperation
  | ScreenUnsetOperation

export interface ScreenSemanticChangeSet {
  readonly schemaVersion: 1
  readonly documentId: string
  readonly operations: readonly ScreenSemanticOperation[]
}

export interface ScreenCompileDocument {
  readonly id: string
  readonly mutationVersion: number
  /** A trusted, deterministic Core `document.exportRaw()` capture. */
  readonly schema: ScreenJsonObject
}

export interface CompileScreenChangeSetInput {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  /** Trusted stable invocation identity; it is not part of the model-facing ChangeSet. */
  readonly callId: string
  /** Trusted material-registry fence captured with `manifests`. */
  readonly materialRegistryVersion: ScreenMaterialRegistryVersion
  /** Trusted Host context captured from the same fenced document snapshot as `document`. */
  readonly expectedMutationVersion: number
  readonly document: ScreenCompileDocument
  readonly manifests: readonly ScreenSafeMaterialManifest[]
  /** Model-facing DTO. It intentionally carries no Core command, raw NodeSchema, or mutation-version field. */
  readonly changeSet: ScreenSemanticChangeSet
}

export interface CompileScreenChangeSetOptions {
  readonly limits?: Partial<ScreenChangeSetLimits>
}

export interface CompiledInsertNodeCommand {
  readonly type: 'insertNode'
  readonly documentId: string
  readonly parentId: string
  readonly at: number
  readonly node: ScreenJsonObject
}

export interface CompiledUpdatePropsCommand {
  readonly type: 'updateProps'
  readonly documentId: string
  readonly nodeId: string
  /** Keys are validated canonical relative dotted paths understood by Core Props. */
  readonly props?: Readonly<Record<string, ScreenJsonValue>>
  /** Keys are validated canonical relative dotted paths understood by Core Extras. */
  readonly extras?: Readonly<Record<string, ScreenJsonValue>>
  readonly unsetPropPaths?: readonly string[]
  readonly unsetExtraPaths?: readonly string[]
}

export interface CompiledRemoveNodeCommand {
  readonly type: 'removeNode'
  readonly documentId: string
  readonly nodeId: string
}

export interface CompiledMoveNodeCommand {
  readonly type: 'moveNode'
  readonly documentId: string
  readonly nodeId: string
  readonly parentId: string
  readonly at: number
}

export type CompiledScreenCommand =
  | CompiledInsertNodeCommand
  | CompiledMoveNodeCommand
  | CompiledRemoveNodeCommand
  | CompiledUpdatePropsCommand

export interface ScreenFieldImage {
  readonly operationIndex: number
  readonly kind: 'field'
  readonly nodeId: string
  readonly fieldId: string
  readonly root: 'props' | 'extras'
  readonly path: readonly string[]
  readonly existed: boolean
  /** `existed` is authoritative; null is a legitimate present value, never an unset sentinel. */
  readonly value: ScreenJsonValue
}

export interface ScreenNodeImage {
  readonly operationIndex: number
  readonly kind: 'node'
  readonly nodeId: string
  readonly existed: boolean
  readonly node: ScreenJsonObject | null
}

export interface ScreenPlacementImage {
  readonly operationIndex: number
  readonly kind: 'placement'
  readonly nodeId: string
  readonly existed: boolean
  readonly parentId: string | null
  readonly index: number | null
  readonly beforeId: string | null
  readonly afterId: string | null
}

export type ScreenChangeImage = ScreenFieldImage | ScreenNodeImage | ScreenPlacementImage

export interface ScreenRelativeAnchors {
  readonly beforeId: string | null
  readonly afterId: string | null
}

export interface ScreenInverseMoveOperation {
  readonly opId: string
  readonly type: 'move'
  readonly nodeId: string
  readonly parentId: string
  readonly position: ScreenRelativePosition
}

export interface ScreenInverseReorderOperation {
  readonly opId: string
  readonly type: 'reorder'
  readonly nodeId: string
  readonly position: ScreenRelativePosition
}

export interface ScreenInverseRestoreOperation {
  readonly opId: string
  readonly type: 'insert'
  readonly parentId: string
  readonly position: ScreenRelativePosition
  /** Trusted journal-only subtree; this shape is never accepted from the model-facing insert DTO. */
  readonly node: ScreenJsonObject
}

export type ScreenInverseSemanticOperation =
  | ScreenInverseMoveOperation
  | ScreenInverseReorderOperation
  | ScreenInverseRestoreOperation
  | ScreenRemoveOperation
  | ScreenResizeOperation
  | ScreenSetOperation
  | ScreenUnsetOperation

export interface ScreenInverseOperationRecord {
  readonly sourceOperationId: string
  readonly sourceOperationIndex: number
  /** Stable journal metadata used when the relative sibling anchor is no longer available. */
  readonly anchors?: ScreenRelativeAnchors
  readonly operation: ScreenInverseSemanticOperation
}

export interface AffectedScreenFieldSlot {
  readonly nodeId: string
  readonly fieldId: string
  readonly root: 'props' | 'extras'
  readonly path: readonly string[]
  readonly slotKey: string
  /** Exact slot, ancestor containers, and prepared pre/post descendant aliases. */
  readonly aliases: readonly string[]
}

export interface AffectedScreenStructuralSlot {
  readonly kind: 'children-order' | 'node-existence' | 'node-parent' | 'node-subtree'
  readonly nodeId?: string
  readonly parentId?: string
  readonly slotKey: string
}

export interface ScreenInsertedNodeIdentity {
  readonly opId: string
  readonly nodeId: string
}

export interface ScreenManifestFingerprint {
  readonly componentName: string
  readonly materialRegistryVersion: ScreenMaterialRegistryVersion
  readonly readiness: {
    readonly status: 'ready'
    readonly missingFieldIds: readonly string[]
    readonly unsupportedFieldIds: readonly string[]
  }
  /** Full canonical semantic descriptor retained so later cryptographic hashing is collision-safe. */
  readonly semanticDescriptor: ScreenJsonObject
  readonly semanticDigest: string
}

export interface ScreenTransactionFingerprintInput {
  readonly schemaVersion: 1
  readonly callId: string
  readonly documentId: string
  readonly baseMutationVersion: number
  readonly materialRegistryVersion: ScreenMaterialRegistryVersion
  readonly manifestFingerprints: readonly ScreenManifestFingerprint[]
  readonly insertedNodeIdentities: readonly ScreenInsertedNodeIdentity[]
  readonly commands: readonly CompiledScreenCommand[]
}

export interface ScreenPreparedHashInput {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly documentId: string
  readonly baseMutationVersion: number
  readonly materialRegistryVersion: ScreenMaterialRegistryVersion
  readonly manifestFingerprints: readonly ScreenManifestFingerprint[]
  readonly insertedNodeIdentities: readonly ScreenInsertedNodeIdentity[]
  readonly operations: readonly ScreenSemanticOperation[]
  readonly transactionFingerprint: ScreenTransactionFingerprintInput
  readonly preImages: readonly ScreenChangeImage[]
  readonly expectedPostImages: readonly ScreenChangeImage[]
  readonly inverseOperations: readonly ScreenInverseOperationRecord[]
  readonly affectedFieldSlots: readonly AffectedScreenFieldSlot[]
  readonly affectedStructuralSlots: readonly AffectedScreenStructuralSlot[]
  readonly affectedSlotKeys: readonly string[]
}

export interface CompiledScreenChangeSet {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly callId: string
  readonly documentId: string
  readonly baseMutationVersion: number
  readonly materialRegistryVersion: ScreenMaterialRegistryVersion
  readonly manifestFingerprints: readonly ScreenManifestFingerprint[]
  readonly insertedNodeIdentities: readonly ScreenInsertedNodeIdentity[]
  readonly operations: readonly ScreenSemanticOperation[]
  readonly commands: readonly CompiledScreenCommand[]
  readonly preImages: readonly ScreenChangeImage[]
  readonly expectedPostImages: readonly ScreenChangeImage[]
  /** Reverse execution order, already suitable for compensation journaling. */
  readonly inverseOperations: readonly ScreenInverseOperationRecord[]
  readonly affectedFieldSlots: readonly AffectedScreenFieldSlot[]
  readonly affectedStructuralSlots: readonly AffectedScreenStructuralSlot[]
  readonly affectedSlotKeys: readonly string[]
  readonly fingerprintInputs: {
    readonly preparedHash: ScreenPreparedHashInput
    readonly transactionFingerprint: ScreenTransactionFingerprintInput
  }
}

/** Pure, deterministic Host identity derivation for model-facing insert `opId`s. */
export declare const deriveInsertedScreenNodeId: (callId: string, opId: string) => string

export declare const compileScreenChangeSet: (
  input: CompileScreenChangeSetInput,
  options?: CompileScreenChangeSetOptions,
) => Readonly<CompiledScreenChangeSet>

export * from './apply.mjs'
export * from './receipt-intent.mjs'
export * from './runtime-adapter.mjs'
