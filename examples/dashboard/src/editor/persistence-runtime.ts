import {
  type CanonicalActiveDocumentV1,
  type CanonicalWorkingDraftV1,
  DASHBOARD_STORAGE_ERROR_CODE,
  type DashboardAgentPersistenceBatchV1,
  type DashboardAgentPersistenceCommitResultV1,
  type DashboardAgentPersistenceReadRequestV1,
  type DashboardAgentPersistenceReadResultV1,
  type DashboardStorageBackend,
  IndexedDbDashboardStorageBackend,
  type JsonObject,
  type LegacyStorageAdapter,
  ProjectPersistenceCoordinator,
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

export interface DashboardDurableAgentCommitResult extends DurableAgentCommitResultV1 {
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
  readonly onError?: (error: unknown) => void
  readonly onWarning?: (warning: DashboardPersistenceWarning) => void
  /** Narrow deterministic test seam; production uses the verified compatibility Bridge. */
  readonly refreshCompatibilitySnapshot?: CompatibilitySnapshotWriter
}

type DashboardPersistenceScope = Readonly<{ projectId: string; branchId: string }>

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

  #cancelScheduledAutosave(): void {
    this.#scheduledAutosave = null
    if (this.#autosaveTimer) clearTimeout(this.#autosaveTimer)
    this.#autosaveTimer = null
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
    return this.#enqueue(async () => {
      if (!this.#scope || !this.#draft) throw new Error('Dashboard persistence was not initialized')
      const scope = this.#scope
      const expectedDraftGeneration = this.#draft.draftGeneration
      const updatedAt = this.#now()
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
          operations: [],
        }),
      )
      this.#draft = result.draft
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
      this.#cancelScheduledAutosave()
      return this.#enqueue(async () => {
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

  #startScheduledAutosave(): Promise<DashboardPersistenceSaveResult> | null {
    const capture = this.#scheduledAutosave
    if (!capture) return null
    this.#scheduledAutosave = null
    if (this.#autosaveTimer) clearTimeout(this.#autosaveTimer)
    this.#autosaveTimer = null
    const task = Promise.resolve().then(() => {
      const input = capture()
      return this.#commit({ ...input, commitKind: 'autosave' })
    })
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
      pendingAutosave: this.#scheduledAutosave !== null || this.#backgroundAutosaves.size > 0,
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
