import type { OnlineArtifactRef } from '../../../../lib/storage/artifact-contracts.mjs'
import type { CanonicalActiveDocumentV1 } from '../../../../lib/storage/contracts.mjs'
import type { JsonObject } from '../../persistence/contract.mjs'

export declare const ONLINE_ARTIFACT_CAPABILITIES: readonly ['artifact.createOnline', 'artifact.reviseOnline']
export type OnlineArtifactCapability = (typeof ONLINE_ARTIFACT_CAPABILITIES)[number]
export declare const GENERATED_MATERIAL_HOST_COMPONENT_NAME: 'GeneratedMaterialHost'

export interface OnlineArtifactAuthority {
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly taskId: string
}

export type OnlineArtifactRelativePosition =
  | Readonly<{ place: 'first' | 'last' }>
  | Readonly<{ place: 'before' | 'after'; siblingId: string }>

export interface OnlineArtifactRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface OnlineArtifactDependencyRequest {
  readonly package: string
  readonly range: string
}

export interface OnlineArtifactSourceArguments {
  readonly schemaVersion: 1
  readonly source: string
  readonly css: string
  readonly safeManifest: JsonObject & Readonly<{ schemaVersion: 1 }>
  readonly dependencies: readonly OnlineArtifactDependencyRequest[]
}

export interface OnlineArtifactCreateArguments extends OnlineArtifactSourceArguments {
  readonly documentId: string
  readonly parentId: string
  readonly position: OnlineArtifactRelativePosition
  readonly props?: JsonObject
  readonly rect?: OnlineArtifactRect
}

export interface OnlineArtifactReviseArguments extends OnlineArtifactSourceArguments {
  readonly nodeId: string
}

interface OnlineArtifactCallBase {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly taskId: string
  readonly stepId: string
  readonly callId: string
  readonly expectedRevision: string
}

export interface OnlineArtifactCreateCall extends OnlineArtifactCallBase {
  readonly capability: 'artifact.createOnline'
  readonly arguments: OnlineArtifactCreateArguments
}

export interface OnlineArtifactReviseCall extends OnlineArtifactCallBase {
  readonly capability: 'artifact.reviseOnline'
  readonly arguments: OnlineArtifactReviseArguments
}

export type OnlineArtifactCall = OnlineArtifactCreateCall | OnlineArtifactReviseCall

export interface OnlineArtifactPrepareResult {
  readonly schemaVersion: 1
  readonly baseRevision: string
  readonly documentId: string
  readonly nodeId: string
  readonly baseMutationVersion: number
  readonly previousArtifactRef: OnlineArtifactRef | null
}

export interface OnlineArtifactCoreResult {
  readonly schemaVersion: 1
  readonly revision: string
  readonly documentId: string
  readonly nodeId: string
  readonly componentName: 'GeneratedMaterialHost'
  readonly coreMutationVersion: number
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly projectSchema: JsonObject
  readonly affectedSlotKeys: readonly string[]
}

export interface OnlineArtifactProjectCapture {
  readonly schemaVersion: 1
  readonly revision: string
  readonly documentId: string
  readonly coreMutationVersion: number
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly projectSchema: JsonObject
}

export declare const normalizeOnlineArtifactCall: (
  value: unknown,
  boundAuthority: OnlineArtifactAuthority,
  expectedCapability: OnlineArtifactCapability,
) => OnlineArtifactCall

export declare const normalizeOnlineArtifactPrepareResult: (
  value: unknown,
  expected: Readonly<{
    capability: OnlineArtifactCapability
    expectedRevision: string
    nodeId: string
    documentId?: string
  }>,
) => OnlineArtifactPrepareResult

export declare const normalizeOnlineArtifactCoreResult: (
  value: unknown,
  expected: OnlineArtifactPrepareResult & Readonly<{ artifactRef: OnlineArtifactRef }>,
) => OnlineArtifactCoreResult

export declare const normalizeOnlineArtifactProjectCapture: (value: unknown) => OnlineArtifactProjectCapture
