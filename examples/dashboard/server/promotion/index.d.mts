import type { IncomingMessage, ServerResponse } from 'node:http'

import type { MaterialCatalogItemV1, MaterialCatalogListResponseV1 } from '../../shared/material-catalog-contract.mjs'
import type {
  MaterialIdentityV1,
  MaterialPromotionBindingV1,
  MaterialPromotionRequestV1,
} from '../../shared/material-promotion-contract.mjs'
import type { ArtifactRecordV1, ArtifactSourceRevision } from '../../src/lib/storage/artifact-contracts.mjs'

export type {
  MaterialCatalogArtifactRefV1,
  MaterialCatalogArtifactSourceRevisionV1,
  MaterialCatalogItemV1,
  MaterialCatalogListResponseV1,
  MaterialCatalogLocalTargetV1,
  MaterialCatalogRegistryRecord,
} from '../../shared/material-catalog-contract.mjs'
export {
  MATERIAL_CATALOG_COMPONENT_NAME,
  MATERIAL_CATALOG_SCHEMA_VERSION,
  createMaterialCatalogItem,
  createMaterialCatalogListResponse,
  validateMaterialCatalogItem,
  validateMaterialCatalogListResponse,
} from '../../shared/material-catalog-contract.mjs'

export type Sha256Digest = `sha256:${string}`
export type MaybePromise<T> = T | PromiseLike<T>

export interface MaterialPromotionPrincipal {
  readonly tenantId: string
  readonly userId: string
}

export interface MaterialPromotionSessionPrincipal extends MaterialPromotionPrincipal {
  readonly projectIds: readonly string[]
}

export interface MaterialPromotionCallV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly taskId: string
  readonly stepId: string
  readonly callId: string
  readonly callDigest: Sha256Digest
  readonly promotionId: Sha256Digest
  readonly artifact: ArtifactRecordV1
}

export interface MaterialPromotionQueryV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly promotionId: Sha256Digest
}

export interface MaterialCatalogListRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
}

export interface MaterialCatalogReadRequestV1 extends MaterialCatalogListRequestV1 {
  readonly materialId: string
  readonly materialVersion: string
  readonly buildIntegrity: Sha256Digest
}

export interface MaterialPromotionActiveResultV1 {
  readonly schemaVersion: 1
  readonly status: 'active'
  readonly promotionId: Sha256Digest
  readonly materialId: string
  readonly materialVersion: string
  readonly buildIntegrity: Sha256Digest
  readonly rollbackTo: ArtifactSourceRevision
}

export type MaterialPromotionAvailabilityReason = 'ready' | 'disabled' | 'node-version' | 'easypack-unavailable'

export type MaterialPromotionAvailabilityV1 =
  | Readonly<{
      schemaVersion: 1
      available: true
      reason: 'ready'
      minimumNodeMajor: 20
    }>
  | Readonly<{
      schemaVersion: 1
      available: false
      reason: Exclude<MaterialPromotionAvailabilityReason, 'ready'>
      minimumNodeMajor: 20
    }>

export interface MaterialPromotionErrorBodyV1 {
  readonly schemaVersion: 1
  readonly error: Readonly<{
    code: string
    message: string
    retryable: boolean
  }>
}

export interface MaterialPromotionSuccessTransportResult {
  readonly status: 200
  readonly body:
    | MaterialPromotionActiveResultV1
    | MaterialPromotionAvailabilityV1
    | MaterialCatalogItemV1
    | MaterialCatalogListResponseV1
}

export interface MaterialPromotionErrorTransportResult {
  readonly status: number
  readonly body: MaterialPromotionErrorBodyV1
}

export type MaterialPromotionTransportResult =
  | MaterialPromotionSuccessTransportResult
  | MaterialPromotionErrorTransportResult

export interface MaterialPromotionTransportRequest {
  readonly method?: string
  readonly path?: string
  readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly expectedOrigins?: readonly string[]
  readonly body?: string | ArrayBuffer | ArrayBufferView
  readonly signal?: AbortSignal
}

export interface MaterialPromotionHandler {
  handle(request: MaterialPromotionTransportRequest): Promise<MaterialPromotionTransportResult>
  close?(): Promise<void>
}

export interface MaterialPromotionPhaseOptions {
  readonly signal?: AbortSignal
}

export interface MaterialPromotionAuthorizationInput extends MaterialPromotionPhaseOptions {
  readonly headers: Readonly<Record<string, string>>
  readonly projectId: string
}

export type MaterialPromotionPrincipalAuthorizer = (
  input: MaterialPromotionAuthorizationInput,
) => MaybePromise<MaterialPromotionPrincipal>

export interface EasypackTrustedWrapperBuildArtifact {
  readonly path: string
  readonly type: 'asset' | 'chunk'
  readonly bytes: number
  readonly sha256: string
}

export interface EasypackTrustedWrapperBuildResult {
  readonly package: Readonly<{ name: string; version: string }>
  readonly preset: 'library'
  readonly artifacts: readonly EasypackTrustedWrapperBuildArtifact[]
}

export interface EasypackTrustedWrapperRuntime {
  buildEasypack(
    options: Readonly<{
      rootDir: string
      config: Readonly<{
        preset: 'library'
        entry: Readonly<{ main: 'src/index.mjs' }>
        output: Readonly<{
          dir: 'dist'
          esm: true
          cjs: false
          umd: false
          minify: false
          sourcemap: false
          types: false
        }>
      }>
    }>,
  ): MaybePromise<EasypackTrustedWrapperBuildResult>
}

export type EasypackRuntimeLoader = (
  options?: MaterialPromotionPhaseOptions,
) => MaybePromise<EasypackTrustedWrapperRuntime>

export interface MaterialPromotionAuthor {
  checkAvailability?(options?: MaterialPromotionPhaseOptions): MaybePromise<MaterialPromotionAvailabilityV1>
  recoverPromotionWorkspaces?(options?: MaterialPromotionPhaseOptions): MaybePromise<readonly string[]>
  authorPromotion(
    input: Readonly<{
      principal: MaterialPromotionPrincipal
      request: MaterialPromotionCallV1
      signal?: AbortSignal
    }>,
  ): MaybePromise<Readonly<MaterialPromotionRequestV1>>
  releasePromotion?(promotion: Pick<MaterialPromotionRequestV1, 'buildDirectory'>): MaybePromise<void>
  dispose?(): MaybePromise<void>
}

export interface EasypackTrustedWrapperAuthor extends MaterialPromotionAuthor {
  checkAvailability(options?: MaterialPromotionPhaseOptions): MaybePromise<MaterialPromotionAvailabilityV1>
  recoverPromotionWorkspaces(options?: MaterialPromotionPhaseOptions): Promise<readonly string[]>
  dispose(): Promise<void>
}

export type MaterialPromotionRecordV1 = MaterialPromotionBindingV1 & Readonly<{ state: 'manifest-staged' | 'active' }>
export type ActiveMaterialPromotionRecordV1 = MaterialPromotionBindingV1 & Readonly<{ state: 'active' }>
export type StagedMaterialPromotionRecordV1 = MaterialPromotionBindingV1 & Readonly<{ state: 'manifest-staged' }>

export interface MaterialRegistryIndexV1 {
  readonly materials: readonly ActiveMaterialPromotionRecordV1[]
  readonly pendingPromotions: readonly StagedMaterialPromotionRecordV1[]
}

export interface MaterialRegistryBackupExportV1 {
  readonly destinationDir: string
  readonly materials: readonly ActiveMaterialPromotionRecordV1[]
  readonly valid: true
}

export interface MaterialRegistryBackupVerificationV1 {
  readonly valid: true
  readonly materials: readonly ActiveMaterialPromotionRecordV1[]
}

export interface MaterialRegistryGarbageCollectionPlanV1 {
  readonly schemaVersion: 1
  readonly registryId: Sha256Digest
  readonly generation: `${number}:sha256:${string}`
  readonly retainedMaterialRefs: readonly MaterialIdentityV1[]
  readonly deletionCandidates: readonly MaterialIdentityV1[]
}

export interface MaterialRegistryGarbageCollectionResultV1 {
  readonly deletedMaterials: readonly MaterialIdentityV1[]
  readonly generation: `${number}:sha256:${string}`
}

export interface MaterialPromotionRegistry {
  readonly rootDir?: string
  stagePromotion(
    request: MaterialPromotionRequestV1,
    options?: MaterialPromotionPhaseOptions,
  ): MaybePromise<MaterialPromotionRecordV1>
  publishPromotion(
    request: Readonly<{ promotionId: string }>,
    options?: MaterialPromotionPhaseOptions,
  ): MaybePromise<ActiveMaterialPromotionRecordV1>
  queryPromotion?(
    request: MaterialPromotionQueryV1,
    options?: MaterialPromotionPhaseOptions,
  ): MaybePromise<MaterialPromotionRecordV1 | null>
  readMaterial?(
    identity: MaterialIdentityV1,
    options?: MaterialPromotionPhaseOptions,
  ): MaybePromise<ActiveMaterialPromotionRecordV1 | null>
  listMaterials?(
    filter: Readonly<{ projectId: string }>,
    options?: MaterialPromotionPhaseOptions,
  ): MaybePromise<readonly ActiveMaterialPromotionRecordV1[]>
  rebuildIndex?(): MaybePromise<MaterialRegistryIndexV1>
  recoverPendingPromotions?(): MaybePromise<readonly StagedMaterialPromotionRecordV1[]>
  exportBackup?(request: Readonly<{ destinationDir: string }>): MaybePromise<MaterialRegistryBackupExportV1>
  verifyBackup?(request: Readonly<{ backupDirectory: string }>): MaybePromise<MaterialRegistryBackupVerificationV1>
  planGarbageCollection?(
    request: Readonly<{
      retainedMaterialRefs: readonly MaterialIdentityV1[]
    }>,
  ): MaybePromise<MaterialRegistryGarbageCollectionPlanV1>
  sweepGarbageCollection?(
    plan: MaterialRegistryGarbageCollectionPlanV1,
  ): MaybePromise<MaterialRegistryGarbageCollectionResultV1>
}

export interface FileMaterialRegistry extends MaterialPromotionRegistry {
  readonly rootDir: string
  queryPromotion(
    request: MaterialPromotionQueryV1,
    options?: MaterialPromotionPhaseOptions,
  ): MaybePromise<MaterialPromotionRecordV1 | null>
  readMaterial(
    identity: MaterialIdentityV1,
    options?: MaterialPromotionPhaseOptions,
  ): MaybePromise<ActiveMaterialPromotionRecordV1 | null>
  listMaterials(
    filter: Readonly<{ projectId: string }>,
    options?: MaterialPromotionPhaseOptions,
  ): MaybePromise<readonly ActiveMaterialPromotionRecordV1[]>
  rebuildIndex(): MaybePromise<MaterialRegistryIndexV1>
  recoverPendingPromotions(): MaybePromise<readonly StagedMaterialPromotionRecordV1[]>
  exportBackup(request: Readonly<{ destinationDir: string }>): MaybePromise<MaterialRegistryBackupExportV1>
  verifyBackup(request: Readonly<{ backupDirectory: string }>): MaybePromise<MaterialRegistryBackupVerificationV1>
  planGarbageCollection(
    request: Readonly<{
      retainedMaterialRefs: readonly MaterialIdentityV1[]
    }>,
  ): MaybePromise<MaterialRegistryGarbageCollectionPlanV1>
  sweepGarbageCollection(
    plan: MaterialRegistryGarbageCollectionPlanV1,
  ): MaybePromise<MaterialRegistryGarbageCollectionResultV1>
}

export interface MaterialPromotionCoordinator {
  promote(
    input: Readonly<{
      headers: Readonly<Record<string, string>>
      request: MaterialPromotionCallV1
      signal?: AbortSignal
    }>,
  ): Promise<MaterialPromotionActiveResultV1>
  query(
    input: Readonly<{
      headers: Readonly<Record<string, string>>
      request: MaterialPromotionQueryV1
      signal?: AbortSignal
    }>,
  ): Promise<MaterialPromotionActiveResultV1>
  listCatalog(
    input: Readonly<{
      headers: Readonly<Record<string, string>>
      request: MaterialCatalogListRequestV1
      signal?: AbortSignal
    }>,
  ): Promise<Readonly<MaterialCatalogListResponseV1>>
  readCatalog(
    input: Readonly<{
      headers: Readonly<Record<string, string>>
      request: MaterialCatalogReadRequestV1
      signal?: AbortSignal
    }>,
  ): Promise<Readonly<MaterialCatalogItemV1>>
}

export interface MaterialPromotionCoordinatorOptions {
  readonly authorizePrincipal: MaterialPromotionPrincipalAuthorizer
  readonly author: MaterialPromotionAuthor
  readonly registry: MaterialPromotionRegistry
}

export interface EasypackWorkspaceLeaseOptions {
  readonly heartbeatMs?: number
  readonly staleAfterMs?: number
  readonly now?: () => number
}

export interface EasypackTrustedWrapperAuthorOptions {
  readonly workspaceRoot: string
  readonly nodeVersion?: string
  readonly loadEasypack?: EasypackRuntimeLoader
  readonly now?: () => number
  readonly workspaceLease?: EasypackWorkspaceLeaseOptions
}

export interface FileMaterialRegistryLeaseOptions {
  readonly acquireTimeoutMs?: number
  readonly heartbeatMs?: number
  readonly staleAfterMs?: number
}

export interface FileMaterialRegistryBudgetOptions {
  readonly maxFiles?: number
  readonly maxFileCount?: number
  readonly maxFileBytes?: number
  readonly maxTotalBytes?: number
}

export interface FileMaterialRegistryOptions {
  readonly rootDir?: string
  readonly workspaceRoot?: string
  readonly fileSystem?: typeof import('node:fs/promises')
  readonly checkpoint?: (checkpoint: Readonly<{ name: string } & Record<string, unknown>>) => MaybePromise<void>
  readonly now?: () => number
  readonly lease?: FileMaterialRegistryLeaseOptions
  readonly limits?: FileMaterialRegistryBudgetOptions
  readonly budgets?: FileMaterialRegistryBudgetOptions
}

export interface MaterialPromotionHandlerOptions {
  readonly coordinator: MaterialPromotionCoordinator
  readonly checkAvailability?: (
    options?: MaterialPromotionPhaseOptions,
  ) => MaybePromise<MaterialPromotionAvailabilityV1>
}

export interface MaterialPromotionMiddlewareOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly handler?: MaterialPromotionHandler
  readonly publicOrigins?: readonly string[]
  readonly inboundTimeoutMs?: number
  readonly operationTimeoutMs?: number
  readonly registry?: MaterialPromotionRegistry
  readonly author?: MaterialPromotionAuthor
  readonly authorizePrincipal?: MaterialPromotionPrincipalAuthorizer
  readonly resolveSessionPrincipal?: (
    input: Readonly<{
      sessionId: string
      projectId: string
    }>,
  ) => MaybePromise<MaterialPromotionSessionPrincipal | null>
  readonly registryRoot?: string
  readonly workspaceRoot?: string
  readonly nodeVersion?: string
  readonly loadEasypack?: EasypackRuntimeLoader
  readonly now?: () => number
  readonly createRegistry?: (options: FileMaterialRegistryOptions) => MaybePromise<MaterialPromotionRegistry>
}

export interface NodeMaterialPromotionMiddlewareOptions {
  readonly handler: MaterialPromotionHandler
  readonly publicOrigins?: readonly string[]
  readonly inboundTimeoutMs?: number
  readonly operationTimeoutMs?: number
}

export interface MaterialPromotionMiddleware {
  (request: IncomingMessage, response: ServerResponse, next?: () => void): Promise<boolean>
  readonly close?: () => Promise<void>
}

export declare const MATERIAL_PROMOTION_ROUTE: '/api/materials/promote'
export declare const MATERIAL_PROMOTION_QUERY_ROUTE: '/api/materials/promotion/query'
export declare const MATERIAL_PROMOTION_AVAILABILITY_ROUTE: '/api/materials/promotion/availability'
export declare const MATERIAL_CATALOG_LIST_ROUTE: '/api/materials/catalog/list'
export declare const MATERIAL_CATALOG_READ_ROUTE: '/api/materials/catalog/read'
export declare const MATERIAL_PROMOTION_MAX_INBOUND_BYTES: number
export declare const MATERIAL_PROMOTION_ENABLED_ENV: 'EASY_EDITOR_MATERIAL_PROMOTION_ENABLED'
export declare const MATERIAL_PROMOTION_CONFIG_ENV: 'EASY_EDITOR_MATERIAL_PROMOTION_CONFIG_JSON'

export declare const isEnvironmentMaterialPromotionEnabled: (env?: NodeJS.ProcessEnv) => boolean
export declare const createMaterialPromotionCoordinator: (
  options: MaterialPromotionCoordinatorOptions,
) => MaterialPromotionCoordinator
export declare const createEasypackTrustedWrapperAuthor: (
  options: EasypackTrustedWrapperAuthorOptions,
) => EasypackTrustedWrapperAuthor
export declare const createFileMaterialRegistry: (
  options?: FileMaterialRegistryOptions,
) => Promise<FileMaterialRegistry>
export declare const createMaterialPromotionHandler: (
  options: MaterialPromotionHandlerOptions,
) => MaterialPromotionHandler
export declare const createDisabledMaterialPromotionHandler: () => MaterialPromotionHandler
export declare const createEnvironmentMaterialPromotionHandler: (
  options?: MaterialPromotionMiddlewareOptions,
) => MaterialPromotionHandler
export declare const createNodeMaterialPromotionMiddleware: (
  options: NodeMaterialPromotionMiddlewareOptions,
) => MaterialPromotionMiddleware
export declare const createEnvironmentMaterialPromotionMiddleware: (
  options?: MaterialPromotionMiddlewareOptions,
) => MaterialPromotionMiddleware

export declare class MaterialPromotionError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  constructor(code: string, status: number, message: string, retryable?: boolean)
}

export declare const normalizePromotionError: (error: unknown) => MaterialPromotionError
export declare const createPromotionErrorEnvelope: (error: unknown) => MaterialPromotionErrorTransportResult
