import {
  type CanonicalActiveDocumentV1,
  type CanonicalWorkingDraftV1,
  DASHBOARD_STORAGE_ERROR_CODE,
  type DashboardAgentPersistenceBatchV1,
  type DashboardAgentPersistenceCommitResultV1,
  type DashboardAgentPersistenceReadRequestV1,
  type DashboardAgentPersistenceReadResultV1,
  type DashboardCompensationRunReadRequestV1,
  type DashboardCompensationTargetClaimReadRequestV1,
  type DashboardMutationProvenanceReadRequestV1,
  type DashboardReceiptLineageReadRequest,
  type DashboardReceiptLineageResult,
  type DashboardStorageBackend,
  IndexedDbDashboardStorageBackend,
  type JsonObject,
  type LegacyStorageAdapter,
  type ProjectPersistenceCompensationRunStateResultV1,
  ProjectPersistenceCoordinator,
  type ProjectPersistenceMutationProvenanceReadResultV1,
  type StringStorageWriter,
  createLegacyStorageAdapter,
  hashCanonicalJson,
  isDashboardStorageError,
  migrateLegacyStorage,
  refreshIndexedDbCompatibilitySnapshot,
} from '../lib/storage/index.mjs'
import {
  type DurableAgentBatchV1,
  type DurableAgentCommitResultV1,
  commitDurableAgentBatch as commitCoordinatorDurableAgentBatch,
  recordDurableAgentIntent as recordCoordinatorDurableAgentIntent,
  recoverDurableAgentReceipt as recoverCoordinatorDurableAgentReceipt,
} from './agent/persistence/durable-agent-commit.mjs'
import {
  type DashboardMutationAttribution,
  createDashboardMutationAttribution,
} from './agent/persistence/mutation-attribution.mjs'
import { createMutationProvenanceBatch } from './agent/persistence/provenance.mjs'
import type { ReceiptIntentV1, ReceiptRecoveryResult } from './agent/persistence/receipt-ledger.mjs'

type DashboardPersistenceState = 'created' | 'initializing' | 'ready' | 'failed' | 'disposing' | 'disposed'
type DashboardEditorCommitKind = 'autosave' | 'manual-save'

export interface DashboardPersistenceInput {
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly projectSchema: JsonObject
}

export interface DashboardPersistenceSaveInput extends DashboardPersistenceInput {
  readonly commitKind: DashboardEditorCommitKind
}

export interface DashboardPersistenceWarning {
  readonly code: 'compatibility-snapshot-refresh-failed'
  readonly draftGeneration: number
  readonly message: string
  readonly cause: unknown
}

export interface DashboardPersistenceSaveResult {
  readonly draft: CanonicalWorkingDraftV1
  readonly compatibilityWarning: DashboardPersistenceWarning | null
}

export interface DashboardMutationAttributionInput {
  readonly source: 'external' | 'human' | 'unknown'
  readonly slotKeys: readonly string[]
  readonly ambiguous?: true
}

export interface DashboardDurableAgentCommitResult extends DurableAgentCommitResultV1 {
  readonly compatibilityWarning: DashboardPersistenceWarning | null
}

export interface DashboardDurableAgentWriteSession {
  readonly draft: CanonicalWorkingDraftV1
  recordIntent(intent: ReceiptIntentV1): Promise<ReceiptIntentV1>
  readReceiptLineage(request: DashboardReceiptLineageReadRequest): Promise<DashboardReceiptLineageResult>
  readMutationProvenance(
    request: DashboardMutationProvenanceReadRequestV1,
  ): Promise<ProjectPersistenceMutationProvenanceReadResultV1>
  commitBatch(batch: DurableAgentBatchV1): Promise<DashboardDurableAgentCommitResult>
}

export interface DashboardCompensationRunStateInput {
  readonly schemaVersion: 1
  readonly action: 'acquire' | 'retain' | 'release'
  readonly projectId: string
  readonly branchId: string
  readonly sessionId: string
  readonly outerCallId: string
  readonly targetTaskId: string
  readonly updatedAt: number
  readonly run: JsonObject
}

export interface DashboardCompensationRunStateResult extends ProjectPersistenceCompensationRunStateResultV1 {
  readonly compatibilityWarning: DashboardPersistenceWarning | null
}

export interface DashboardPersistenceSnapshot {
  readonly state: DashboardPersistenceState
  readonly projectId: string | null
  readonly branchId: string | null
  readonly draftGeneration: number
  readonly projectHash: string | null
  readonly projectSchemaVersion: string | null
  readonly activeDocument: CanonicalActiveDocumentV1 | null
  readonly pendingAutosave: boolean
  readonly compatibilityWarning: Omit<DashboardPersistenceWarning, 'cause'> | null
}

type CompatibilitySnapshotWriter = typeof refreshIndexedDbCompatibilitySnapshot

export interface DashboardPersistenceRuntimeOptions {
  readonly storage: StringStorageWriter
  readonly backend?: DashboardStorageBackend
  readonly indexedDB?: IDBFactory
  readonly crypto?: Pick<Crypto, 'subtle'>
  readonly now?: () => number
  readonly createProjectId?: () => string
  readonly autosaveDelayMs?: number
  readonly isHumanActivityActive?: () => boolean
  readonly onError?: (error: unknown) => void
  readonly onWarning?: (warning: DashboardPersistenceWarning) => void
  /** Narrow deterministic test seam; production uses the verified compatibility Bridge. */
  readonly refreshCompatibilitySnapshot?: CompatibilitySnapshotWriter
}

type DashboardPersistenceScope = Readonly<{ projectId: string; branchId: string }>
type PendingAttributionSnapshot = Readonly<{
  forceProvenanceInvalidation: boolean
  records: readonly Readonly<{
    sequence: number
    slotKey: string
    source: 'external' | 'human' | 'unknown'
  }>[]
  unknownSequence: number
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requireFullProject = (value: JsonObject): JsonObject => {
  if (!Array.isArray(value.componentsTree) || value.componentsTree.length === 0) {
    throw new TypeError('Dashboard persistence requires a full project schema with at least one document')
  }
  if (!value.componentsTree.every(isRecord)) {
    throw new TypeError('Dashboard project documents must be objects')
  }
  return structuredClone(value)
}

const stringField = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

export const createDashboardActiveDocument = (
  projectSchema: JsonObject,
  index = 0,
): CanonicalActiveDocumentV1 | null => {
  const roots = projectSchema.componentsTree
  if (!Array.isArray(roots) || !Number.isSafeInteger(index) || index < 0 || index >= roots.length) return null
  const root = roots[index]
  if (!isRecord(root)) return null
  const fileName = stringField(root.fileName) ?? stringField(root.docId) ?? stringField(root.id)
  const documentId = stringField(root.docId) ?? fileName
  return fileName && documentId ? Object.freeze({ documentId, fileName, index }) : null
}

export const selectDashboardActiveDocumentSchema = (
  projectSchema: JsonObject,
  activeDocument: CanonicalActiveDocumentV1 | null,
): JsonObject => {
  const roots = projectSchema.componentsTree
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new TypeError('Canonical Dashboard project has no documents')
  }

  const byIdentity = activeDocument
    ? roots.find(root => {
        if (!isRecord(root)) return false
        return (
          stringField(root.docId) === activeDocument.documentId ||
          stringField(root.id) === activeDocument.documentId ||
          stringField(root.fileName) === activeDocument.fileName
        )
      })
    : undefined
  const selected = byIdentity ?? (activeDocument ? roots[activeDocument.index] : roots[0])
  if (!isRecord(selected)) {
    throw new Error('Canonical Dashboard active document cannot be resolved')
  }
  return structuredClone(selected) as JsonObject
}

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(typeof value === 'string' ? value : 'Unknown persistence failure')

export class DashboardPersistenceRuntime {
  readonly #coordinator: ProjectPersistenceCoordinator
  readonly #legacy: LegacyStorageAdapter
  readonly #now: () => number
  readonly #crypto: Pick<Crypto, 'subtle'> | undefined
  readonly #autosaveDelayMs: number
  readonly #onError: (error: unknown) => void
  readonly #onWarning: (warning: DashboardPersistenceWarning) => void
  readonly #refreshCompatibilitySnapshot: CompatibilitySnapshotWriter
  readonly #isHumanActivityActive: () => boolean

  #state: DashboardPersistenceState = 'created'
  #accepting = false
  #scope: DashboardPersistenceScope | null = null
  #draft: CanonicalWorkingDraftV1 | null = null
  #initializePromise: Promise<CanonicalWorkingDraftV1> | null = null
  #disposePromise: Promise<void> | null = null
  #tail: Promise<void> = Promise.resolve()
  #scheduledAutosave: (() => DashboardPersistenceInput) | null = null
  #autosaveTimer: ReturnType<typeof setTimeout> | null = null
  #backgroundAutosaves = new Set<Promise<DashboardPersistenceSaveResult>>()
  #backgroundAutosaveError: unknown = null
  #compatibilityWarning: DashboardPersistenceWarning | null = null
  #mutationAttribution: DashboardMutationAttribution | null = null
  #attributionSequence = 0
  #pendingAttribution = new Map<
    string,
    { readonly sequence: number; readonly source: 'external' | 'human' | 'unknown' }
  >()
  #pendingUnknownSequence = 0

  constructor(options: DashboardPersistenceRuntimeOptions) {
    if (!options?.storage) throw new TypeError('Dashboard persistence requires a local storage Bridge')
    this.#now = options.now ?? Date.now
    this.#crypto = options.crypto
    this.#autosaveDelayMs = options.autosaveDelayMs ?? 300
    if (!Number.isSafeInteger(this.#autosaveDelayMs) || this.#autosaveDelayMs < 0) {
      throw new TypeError('Dashboard autosave delay must be a non-negative safe integer')
    }
    this.#onError = options.onError ?? (() => undefined)
    this.#onWarning = options.onWarning ?? (() => undefined)
    this.#isHumanActivityActive = options.isHumanActivityActive ?? (() => false)
    if (typeof this.#isHumanActivityActive !== 'function') {
      throw new TypeError('Dashboard persistence human activity predicate must be a function')
    }
    this.#refreshCompatibilitySnapshot = options.refreshCompatibilitySnapshot ?? refreshIndexedDbCompatibilitySnapshot
    const backend =
      options.backend ?? new IndexedDbDashboardStorageBackend({ indexedDB: options.indexedDB, crypto: options.crypto })
    this.#coordinator = new ProjectPersistenceCoordinator({
      backend,
      compatibilityStorage: options.storage,
      crypto: options.crypto,
    })
    this.#legacy = createLegacyStorageAdapter(options.storage, {
      createProjectId:
        options.createProjectId ??
        (() => {
          const randomUUID = globalThis.crypto?.randomUUID
          if (typeof randomUUID !== 'function') {
            throw new Error('Dashboard persistence cannot create a project identity without crypto.randomUUID')
          }
          return randomUUID.call(globalThis.crypto)
        }),
    })
  }

  initialize(defaultProjectSchema: JsonObject): Promise<CanonicalWorkingDraftV1> {
    if (this.#initializePromise) return this.#initializePromise
    if (this.#state !== 'created') return Promise.reject(new Error(`Dashboard persistence is ${this.#state}`))
    const fallback = requireFullProject(defaultProjectSchema)
    this.#state = 'initializing'
    this.#initializePromise = this.#initialize(fallback).then(
      draft => {
        this.#draft = draft
        this.#scope = { projectId: draft.projectId, branchId: draft.branchId }
        this.#mutationAttribution = createDashboardMutationAttribution({
          authority: this.#scope,
          isHumanActivityActive: this.#isHumanActivityActive,
        })
        if (this.#state !== 'disposing') {
          this.#accepting = true
          this.#state = 'ready'
        }
        return structuredClone(draft)
      },
      error => {
        if (this.#state !== 'disposing') this.#state = 'failed'
        throw error
      },
    )
    return this.#initializePromise
  }

  async #initialize(defaultProjectSchema: JsonObject): Promise<CanonicalWorkingDraftV1> {
    const markerInspection = this.#legacy.inspectCompatibilityMarker()
    if (markerInspection.diagnostic) {
      return (await migrateLegacyStorage({ legacy: this.#legacy, coordinator: this.#coordinator, now: this.#now }))
        .draft
    }

    const identity = (
      await this.#coordinator.ensureLegacyIdentity({ legacy: this.#legacy, marker: markerInspection.marker })
    ).identity
    const scope = { projectId: identity.projectId, branchId: identity.branchId }
    const indexedDbDraft = await this.#coordinator.readWorkingDraft(scope)
    const candidate = this.#legacy.readProjectCandidate()
    let draft: CanonicalWorkingDraftV1

    if (markerInspection.marker || candidate.status !== 'missing') {
      draft = (await migrateLegacyStorage({ legacy: this.#legacy, coordinator: this.#coordinator, now: this.#now }))
        .draft
    } else if (indexedDbDraft) {
      draft = (
        await this.#coordinator.bootstrapIndexedDbAuthority({
          ...scope,
          legacy: this.#legacy,
          migration: null,
          updatedAt: this.#now(),
        })
      ).draft
    } else {
      const activeDocument = createDashboardActiveDocument(defaultProjectSchema)
      const projectHash = await hashCanonicalJson(defaultProjectSchema, { crypto: this.#crypto })
      const updatedAt = this.#now()
      draft = (
        await this.#coordinator.bootstrapIndexedDbAuthority({
          ...scope,
          legacy: this.#legacy,
          migration: {
            ...scope,
            expectedDraftGeneration: 0,
            sourceDraftGeneration: 0,
            source: 'unknown',
            diagnostics: [{ code: 'empty-storage-default-project' }],
            activeDocument,
            projectSchema: defaultProjectSchema,
            projectHash,
            updatedAt,
          },
          updatedAt,
        })
      ).draft
    }
    await this.#refreshCompatibilitySnapshotBestEffort(draft)
    return draft
  }

  #assertReady(): void {
    if (!this.#accepting || this.#state !== 'ready' || !this.#scope || !this.#draft) {
      throw new Error(`Dashboard persistence is ${this.#state}`)
    }
  }

  #assertScope(value: Readonly<{ projectId: string; branchId: string }>, label: string): void {
    if (!this.#scope || value.projectId !== this.#scope.projectId || value.branchId !== this.#scope.branchId) {
      throw new Error(`${label} does not match the active Dashboard persistence scope`)
    }
  }

  getMutationAttribution(): DashboardMutationAttribution {
    this.#assertReady()
    if (!this.#mutationAttribution) throw new Error('Dashboard mutation attribution is unavailable')
    return this.#mutationAttribution
  }

  runAgentMutation<T>(callId: string, operation: () => T): T {
    return this.getMutationAttribution().runAgentMutation(callId, operation)
  }

  #cancelScheduledAutosave(): void {
    this.#scheduledAutosave = null
    if (this.#autosaveTimer) clearTimeout(this.#autosaveTimer)
    this.#autosaveTimer = null
  }

  #snapshotPendingAttribution(): PendingAttributionSnapshot {
    return Object.freeze({
      forceProvenanceInvalidation: this.#pendingUnknownSequence > 0,
      records: Object.freeze(
        [...this.#pendingAttribution.entries()].map(([slotKey, value]) =>
          Object.freeze({ slotKey, sequence: value.sequence, source: value.source }),
        ),
      ),
      unknownSequence: this.#pendingUnknownSequence,
    })
  }

  #consumePendingAttribution(snapshot: PendingAttributionSnapshot): void {
    for (const record of snapshot.records) {
      if (this.#pendingAttribution.get(record.slotKey)?.sequence === record.sequence) {
        this.#pendingAttribution.delete(record.slotKey)
      }
    }
    if (this.#pendingUnknownSequence === snapshot.unknownSequence) this.#pendingUnknownSequence = 0
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.#tail.then(operation)
    this.#tail = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  async #refreshCompatibilitySnapshotBestEffort(
    draft: CanonicalWorkingDraftV1,
  ): Promise<DashboardPersistenceWarning | null> {
    try {
      await this.#refreshCompatibilitySnapshot({ legacy: this.#legacy, draft, now: this.#now })
      this.#compatibilityWarning = null
      return null
    } catch (cause) {
      const warning = Object.freeze({
        code: 'compatibility-snapshot-refresh-failed' as const,
        draftGeneration: draft.draftGeneration,
        message: asError(cause).message,
        cause,
      })
      this.#compatibilityWarning = warning
      try {
        this.#onWarning(warning)
      } catch {
        // Observers cannot turn a durable canonical commit into a failed save.
      }
      return warning
    }
  }

  async #refreshCachedHeadAfterGenerationConflict(): Promise<void> {
    if (!this.#scope || !this.#draft) return
    try {
      const current = await this.#coordinator.readWorkingDraft(this.#scope)
      if (
        current &&
        current.projectId === this.#scope.projectId &&
        current.branchId === this.#scope.branchId &&
        current.draftGeneration >= this.#draft.draftGeneration
      ) {
        this.#draft = current
      }
    } catch {
      // Preserve the original generation conflict when the conservative head refresh also fails.
    }
  }

  async #withGenerationConflictRefresh<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (isDashboardStorageError(error) && error.code === DASHBOARD_STORAGE_ERROR_CODE.generationConflict) {
        await this.#refreshCachedHeadAfterGenerationConflict()
      }
      throw error
    }
  }

  #commit(input: DashboardPersistenceSaveInput): Promise<DashboardPersistenceSaveResult> {
    const projectSchema = requireFullProject(input.projectSchema)
    const activeDocument = input.activeDocument ? structuredClone(input.activeDocument) : null
    const attribution = this.#snapshotPendingAttribution()
    return this.#enqueue(async () => {
      if (!this.#scope || !this.#draft) throw new Error('Dashboard persistence was not initialized')
      const scope = this.#scope
      const expectedDraftGeneration = this.#draft.draftGeneration
      const nextDraftGeneration = expectedDraftGeneration + 1
      const updatedAt = this.#now()
      const provenance = attribution.records.flatMap(record =>
        createMutationProvenanceBatch({
          projectId: scope.projectId,
          branchId: scope.branchId,
          draftGeneration: nextDraftGeneration,
          slotKeys: [record.slotKey],
          source: record.source,
        }),
      )
      const result = await this.#withGenerationConflictRefresh(() =>
        this.#coordinator.commit({
          schemaVersion: 1,
          batchId: `dashboard:${input.commitKind}:${encodeURIComponent(scope.projectId)}:${encodeURIComponent(
            scope.branchId,
          )}:${expectedDraftGeneration}:${updatedAt}`,
          projectId: scope.projectId,
          branchId: scope.branchId,
          expectedDraftGeneration,
          activeDocument,
          projectSchema,
          commitKind: input.commitKind,
          updatedAt,
          operations: provenance.map(value => ({
            type: 'put' as const,
            store: 'mutationProvenance' as const,
            value: value as unknown as JsonObject,
          })),
          ...(attribution.forceProvenanceInvalidation ? { forceProvenanceInvalidation: true as const } : {}),
        }),
      )
      this.#draft = result.draft
      this.#consumePendingAttribution(attribution)
      const compatibilityWarning = await this.#refreshCompatibilitySnapshotBestEffort(result.draft)
      this.#backgroundAutosaveError = null
      return Object.freeze({ draft: structuredClone(result.draft), compatibilityWarning })
    })
  }

  readAgentPersistence(
    request: DashboardAgentPersistenceReadRequestV1,
  ): Promise<DashboardAgentPersistenceReadResultV1> {
    try {
      this.#assertReady()
      this.#assertScope(request, 'Dashboard Agent persistence read')
      return this.#enqueue(() => this.#coordinator.readAgentPersistence(request))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  commitAgentPersistence(batch: DashboardAgentPersistenceBatchV1): Promise<DashboardAgentPersistenceCommitResultV1> {
    try {
      this.#assertReady()
      this.#assertScope(batch, 'Dashboard Agent persistence commit')
      return this.#enqueue(() => this.#coordinator.commitAgentPersistence(batch))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  recordDurableAgentIntent(intent: ReceiptIntentV1): Promise<ReceiptIntentV1> {
    try {
      this.#assertReady()
      this.#assertScope(intent, 'Dashboard durable Agent intent')
      return this.#enqueue(() => recordCoordinatorDurableAgentIntent({ coordinator: this.#coordinator, intent }))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  commitDurableAgentBatch(batch: DurableAgentBatchV1): Promise<DashboardDurableAgentCommitResult> {
    try {
      this.#assertReady()
      this.#assertScope(batch, 'Dashboard durable Agent batch')
      const pendingAutosave = this.#startScheduledAutosave()
      return this.#enqueue(async () => {
        if (pendingAutosave) await pendingAutosave
        if (!this.#draft) throw new Error('Dashboard persistence was not initialized')
        const result = await this.#withGenerationConflictRefresh(() =>
          commitCoordinatorDurableAgentBatch({ coordinator: this.#coordinator, batch }),
        )
        this.#draft = result.draft
        const compatibilityWarning = await this.#refreshCompatibilitySnapshotBestEffort(result.draft)
        this.#backgroundAutosaveError = null
        return Object.freeze({ ...result, draft: structuredClone(result.draft), compatibilityWarning })
      })
    } catch (error) {
      return Promise.reject(error)
    }
  }

  runDurableAgentWrite<T>(operation: (session: DashboardDurableAgentWriteSession) => Promise<T>): Promise<T> {
    try {
      this.#assertReady()
      if (typeof operation !== 'function') throw new TypeError('Dashboard durable Agent write requires an operation')
      const pendingAutosave = this.#startScheduledAutosave()
      return this.#enqueue(async () => {
        if (pendingAutosave) await pendingAutosave
        if (!this.#draft) throw new Error('Dashboard persistence was not initialized')
        let committed = false
        const session: DashboardDurableAgentWriteSession = Object.freeze({
          draft: structuredClone(this.#draft),
          recordIntent: async (intent: ReceiptIntentV1) => {
            if (committed) throw new Error('Dashboard durable Agent write already committed')
            this.#assertScope(intent, 'Dashboard durable Agent intent')
            return recordCoordinatorDurableAgentIntent({ coordinator: this.#coordinator, intent })
          },
          readReceiptLineage: async (request: DashboardReceiptLineageReadRequest) => {
            if (committed) throw new Error('Dashboard durable Agent write already committed')
            this.#assertScope(request, 'Dashboard durable Agent lineage read')
            return this.#coordinator.readReceiptLineage(request)
          },
          readMutationProvenance: async (request: DashboardMutationProvenanceReadRequestV1) => {
            if (committed) throw new Error('Dashboard durable Agent write already committed')
            this.#assertScope(request, 'Dashboard mutation provenance read')
            return this.#coordinator.readMutationProvenance(request)
          },
          commitBatch: async (batch: DurableAgentBatchV1) => {
            if (committed) throw new Error('Dashboard durable Agent write can commit only once')
            this.#assertScope(batch, 'Dashboard durable Agent batch')
            if (!this.#draft || batch.expectedDraftGeneration !== this.#draft.draftGeneration) {
              throw new Error('Dashboard durable Agent batch does not match the serialized draft head')
            }
            const result = await this.#withGenerationConflictRefresh(() =>
              commitCoordinatorDurableAgentBatch({ coordinator: this.#coordinator, batch }),
            )
            committed = true
            this.#draft = result.draft
            const compatibilityWarning = await this.#refreshCompatibilitySnapshotBestEffort(result.draft)
            this.#backgroundAutosaveError = null
            return Object.freeze({ ...result, draft: structuredClone(result.draft), compatibilityWarning })
          },
        })
        return operation(session)
      })
    } catch (error) {
      return Promise.reject(error)
    }
  }

  recoverDurableAgentReceipt(
    request: Readonly<{
      projectId: string
      branchId: string
      callId: string
    }>,
  ): Promise<ReceiptRecoveryResult> {
    try {
      this.#assertReady()
      this.#assertScope(request, 'Dashboard durable Agent recovery')
      return this.#enqueue(() => recoverCoordinatorDurableAgentReceipt({ coordinator: this.#coordinator, ...request }))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  readDurableAgentReceiptLineage(request: DashboardReceiptLineageReadRequest): Promise<DashboardReceiptLineageResult> {
    try {
      this.#assertReady()
      this.#assertScope(request, 'Dashboard durable Agent lineage read')
      return this.#enqueue(() => this.#coordinator.readReceiptLineage(request))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  readCompensationRun(request: DashboardCompensationRunReadRequestV1): Promise<JsonObject | null> {
    try {
      this.#assertReady()
      this.#assertScope(request, 'Dashboard compensation run read')
      return this.#enqueue(() => this.#coordinator.readCompensationRun(request))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  readCompensationTargetClaim(request: DashboardCompensationTargetClaimReadRequestV1): Promise<JsonObject | null> {
    try {
      this.#assertReady()
      this.#assertScope(request, 'Dashboard compensation target claim read')
      return this.#enqueue(() => this.#coordinator.readCompensationTargetClaim(request))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  readMutationProvenance(
    request: DashboardMutationProvenanceReadRequestV1,
  ): Promise<ProjectPersistenceMutationProvenanceReadResultV1> {
    try {
      this.#assertReady()
      this.#assertScope(request, 'Dashboard mutation provenance read')
      return this.#enqueue(() => this.#coordinator.readMutationProvenance(request))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  commitCompensationRunState(input: DashboardCompensationRunStateInput): Promise<DashboardCompensationRunStateResult> {
    try {
      this.#assertReady()
      this.#assertScope(input, 'Dashboard compensation run state')
      const pendingAutosave = this.#startScheduledAutosave()
      return this.#enqueue(async () => {
        if (pendingAutosave) await pendingAutosave
        if (!this.#draft) throw new Error('Dashboard persistence was not initialized')
        const result = await this.#withGenerationConflictRefresh(() =>
          this.#coordinator.commitCompensationRunState({
            ...input,
            expectedDraftGeneration: this.#draft?.draftGeneration ?? 0,
            activeDocument: this.#draft?.activeDocument ?? null,
            projectSchema: this.#draft?.projectSchema ?? {},
          }),
        )
        this.#draft = result.draft
        const compatibilityWarning = await this.#refreshCompatibilitySnapshotBestEffort(result.draft)
        this.#backgroundAutosaveError = null
        return Object.freeze({ ...result, draft: structuredClone(result.draft), compatibilityWarning })
      })
    } catch (error) {
      return Promise.reject(error)
    }
  }

  save(input: DashboardPersistenceSaveInput): Promise<DashboardPersistenceSaveResult> {
    try {
      this.#assertReady()
      if (input.commitKind !== 'manual-save' && input.commitKind !== 'autosave') {
        throw new TypeError('Dashboard editor persistence only accepts manual-save or autosave commits')
      }
      if (input.commitKind === 'manual-save') this.#cancelScheduledAutosave()
      return this.#commit(input)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  scheduleAutosave(capture: () => DashboardPersistenceInput): void {
    this.#assertReady()
    if (typeof capture !== 'function') throw new TypeError('Dashboard autosave requires a project capture function')
    this.#scheduledAutosave = capture
    if (this.#autosaveTimer) clearTimeout(this.#autosaveTimer)
    this.#autosaveTimer = setTimeout(() => {
      this.#autosaveTimer = null
      this.#startScheduledAutosave()
    }, this.#autosaveDelayMs)
  }

  recordMutationAttribution(input: DashboardMutationAttributionInput): void {
    this.#assertReady()
    if (!input || (input.source !== 'human' && input.source !== 'external' && input.source !== 'unknown')) {
      throw new TypeError('Dashboard mutation attribution source is unsupported')
    }
    if (!Array.isArray(input.slotKeys) || input.slotKeys.some(slotKey => typeof slotKey !== 'string' || !slotKey)) {
      throw new TypeError('Dashboard mutation attribution slotKeys must be non-empty strings')
    }
    if (input.ambiguous !== undefined && input.ambiguous !== true) {
      throw new TypeError('Dashboard mutation attribution ambiguous flag must equal true')
    }
    this.#attributionSequence += 1
    const sequence = this.#attributionSequence
    if (input.ambiguous === true || (input.source === 'unknown' && input.slotKeys.length === 0)) {
      this.#pendingUnknownSequence = sequence
    }
    for (const slotKey of new Set(input.slotKeys)) {
      const current = this.#pendingAttribution.get(slotKey)
      const source = current && current.source !== input.source ? 'unknown' : input.source
      this.#pendingAttribution.set(slotKey, { sequence, source })
    }
  }

  #startScheduledAutosave(): Promise<DashboardPersistenceSaveResult> | null {
    const capture = this.#scheduledAutosave
    if (!capture) return null
    this.#scheduledAutosave = null
    if (this.#autosaveTimer) clearTimeout(this.#autosaveTimer)
    this.#autosaveTimer = null
    let task: Promise<DashboardPersistenceSaveResult>
    try {
      const input = capture()
      task = this.#commit({ ...input, commitKind: 'autosave' })
    } catch (error) {
      task = Promise.reject(error)
    }
    this.#backgroundAutosaves.add(task)
    void task
      .catch(error => {
        this.#backgroundAutosaveError = error
        try {
          this.#onError(error)
        } catch {
          // Background observers cannot replace the canonical persistence error.
        }
      })
      .finally(() => this.#backgroundAutosaves.delete(task))
    return task
  }

  async #flush(): Promise<void> {
    do {
      this.#startScheduledAutosave()
      await Promise.allSettled([...this.#backgroundAutosaves])
      await this.#tail
    } while (this.#scheduledAutosave || this.#backgroundAutosaves.size > 0)
    if (this.#scope) await this.#coordinator.flush(this.#scope)
    if (this.#backgroundAutosaveError) {
      const error = this.#backgroundAutosaveError
      this.#backgroundAutosaveError = null
      throw error
    }
  }

  async flush(): Promise<void> {
    if (this.#state !== 'ready') throw new Error(`Dashboard persistence is ${this.#state}`)
    await this.#flush()
  }

  async readWorkingDraft(): Promise<CanonicalWorkingDraftV1 | null> {
    this.#assertReady()
    await this.#tail
    if (!this.#scope) return null
    return this.#coordinator.readWorkingDraft(this.#scope)
  }

  getSnapshot(): DashboardPersistenceSnapshot {
    const warning = this.#compatibilityWarning
      ? {
          code: this.#compatibilityWarning.code,
          draftGeneration: this.#compatibilityWarning.draftGeneration,
          message: this.#compatibilityWarning.message,
        }
      : null
    const version = this.#draft?.projectSchema.version
    return Object.freeze({
      state: this.#state,
      projectId: this.#scope?.projectId ?? null,
      branchId: this.#scope?.branchId ?? null,
      draftGeneration: this.#draft?.draftGeneration ?? 0,
      projectHash: this.#draft?.projectHash ?? null,
      projectSchemaVersion: typeof version === 'string' ? version : null,
      activeDocument: this.#draft?.activeDocument ? structuredClone(this.#draft.activeDocument) : null,
      pendingAutosave:
        this.#scheduledAutosave !== null ||
        this.#backgroundAutosaves.size > 0 ||
        this.#pendingAttribution.size > 0 ||
        this.#pendingUnknownSequence > 0,
      compatibilityWarning: warning,
    })
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    this.#accepting = false
    this.#state = 'disposing'
    const initialization = this.#initializePromise
    this.#disposePromise = (async () => {
      try {
        if (initialization) {
          try {
            await initialization
          } catch {
            // Initialization already exposed its own failure; disposal still owns cleanup.
          }
        }
        await this.#flush()
      } finally {
        await this.#coordinator.dispose()
        this.#state = 'disposed'
      }
    })()
    return this.#disposePromise
  }
}

export const createDashboardPersistenceRuntime = (
  options: DashboardPersistenceRuntimeOptions,
): DashboardPersistenceRuntime => new DashboardPersistenceRuntime(options)

export interface DashboardPreviewWindowHandle {
  navigate(url: string): void
  showFailure(message: string): void
}

export type DashboardPreviewOpenResult = Readonly<{ status: 'opened' }> | Readonly<{ status: 'failed'; error: Error }>

export const openDashboardPreviewAfterSave = async (options: {
  readonly openWindow: () => DashboardPreviewWindowHandle | null
  readonly persist: () => Promise<unknown>
  readonly previewUrl: string
}): Promise<DashboardPreviewOpenResult> => {
  const previewWindow = options.openWindow()
  if (!previewWindow) {
    return Object.freeze({ status: 'failed', error: new Error('Preview window was blocked') })
  }
  try {
    await options.persist()
    previewWindow.navigate(options.previewUrl)
    return Object.freeze({ status: 'opened' })
  } catch (cause) {
    const error = asError(cause)
    previewWindow.showFailure('当前更改尚未保存，无法打开预览。')
    return Object.freeze({ status: 'failed', error })
  }
}
