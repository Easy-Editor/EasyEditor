import { action, computed, intercept, observable, observe, runInAction } from 'mobx'
import type { Designer } from '../designer'
import { DOCUMENT_EVENT, Document, isDocument } from '../document'
import {
  purgeDocumentDuringTeardown,
  removeDocumentDuringTeardown,
  retireDocumentDuringTeardown,
} from '../document/teardown'
import { assertLifecycleMutationAllowed, inheritLifecycleMutationGuard } from '../lifecycle/mutation-barrier'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import { SchemaValidator } from '../schema'
import { createEmptyProjectSchema } from '../schema/schema-migration'
import { Simulator } from '../simulator'
import { type TrustPolicy, resolveTrustPolicy } from '../trust'
import { type ComponentsMap, type ProjectSchema, type RootSchema, TRANSFORM_STAGE } from '../types'
import { type EventBus, createLogger, isLowCodeComponentType, isProCodeComponentType } from '../utils'
import { type DocumentMutationBoundary, installDocumentMutationBoundary } from './document-mutation-boundary'
import {
  assertProjectMutationAuthority,
  installProjectMutationAuthority,
  withProjectMutationAuthority,
  withProjectTeardownAuthority,
} from './mutation-authority'

const logger = createLogger('Project')

const cloneProjectDataValue = <T>(value: T, visited = new Map<object, unknown>()): T => {
  if (!value || typeof value !== 'object') return value
  if (visited.has(value)) return visited.get(value) as T

  if (Array.isArray(value)) {
    const clone: unknown[] = []
    visited.set(value, clone)
    value.forEach(item => clone.push(cloneProjectDataValue(item, visited)))
    return clone as T
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Restricted project data only supports plain objects and arrays')
  }

  const clone = Object.create(prototype) as Record<string, unknown>
  visited.set(value, clone)
  Object.entries(value).forEach(([key, child]) => {
    clone[key] = cloneProjectDataValue(child, visited)
  })
  return clone as T
}

const deepFreezeProjectData = <T>(value: T, visited = new Set<object>()): T => {
  if (!value || typeof value !== 'object' || visited.has(value)) return value
  visited.add(value)
  Object.values(value).forEach(child => deepFreezeProjectData(child, visited))
  return Object.freeze(value)
}

export enum PROJECT_EVENT {
  RENDERER_READY = 'renderer:ready',
  SIMULATOR_READY = 'simulator:ready',
}

interface ActiveDocumentMutationBoundary {
  readonly document: Document
  readonly token: object
  mutationsAllowed: boolean
}

interface LegacySimulatorLifecycle {
  dispose?: () => void | Promise<void>
  purge?: () => void | Promise<void>
}

export class Project {
  private emitter: EventBus

  private data: ProjectSchema = createEmptyProjectSchema()

  @observable.shallow accessor documents: Document[] = []

  private documentsMap = new Map<string, Document>()

  private documentMutationBoundary?: ActiveDocumentMutationBoundary

  private documentsMutationDisposer: () => void = () => {}

  @computed
  get currentDocument() {
    return this.documents.find(document => document.active)
  }

  @observable.ref private accessor _config: Record<string, any> | undefined

  @computed
  get config(): Record<string, any> | undefined {
    return this._config
  }

  set config(value: Record<string, any>) {
    this.assertProjectMutationAllowed()
    this._config = this.protectProjectDataValue(value, true)
  }

  private _simulator?: Simulator

  private readonly schemaValidator: SchemaValidator

  private readonly trustPolicy: TrustPolicy

  allowsDirectModelMutation(): boolean {
    return this.trustPolicy.allowDirectModelMutation === true
  }

  get simulator() {
    return this._simulator || null
  }

  constructor(
    readonly designer: Designer,
    schema?: ProjectSchema,
  ) {
    installLifecycleTeardownOperation(this, () => this.#disposeInternal())
    inheritEngineTeardownOwnership(this.designer, this)
    this.emitter = designer.createEventBus('Project')
    inheritEngineTeardownOwnership(this, this.emitter)
    this.trustPolicy = this.designer.editor.get<TrustPolicy>('trustPolicy') || resolveTrustPolicy('legacyTrusted')
    installProjectMutationAuthority(this, this.trustPolicy)
    installDocumentMutationBoundary(this, document => this.#beginDocumentMutationBoundary(document))
    this.schemaValidator = this.designer.get('schemaValidator') || new SchemaValidator(this.trustPolicy)
    this.trackDocumentCollectionMutations()
    intercept(this, 'documents', change => {
      this.assertProjectMutationAllowed()
      return change
    })
    observe(this, 'documents', () => {
      this.trackDocumentCollectionMutations()
    })
    withProjectMutationAuthority(this, () => this.load(schema))
  }

  private trackDocumentCollectionMutations(): void {
    this.documentsMutationDisposer()
    this.documentsMutationDisposer = intercept(this.documents, change => {
      this.assertProjectMutationAllowed()
      return change
    })
  }

  import(schema: ProjectSchema) {
    this.load(schema)
  }

  export(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE): ProjectSchema {
    return {
      ...this.data,
      componentsMap: this.getComponentsMap(),
      componentsTree: this.documents.filter(doc => !doc.isBlank()).map(doc => doc.export(stage) || {}),
    }
  }

  private getComponentsMap() {
    return this.documents.reduce<ComponentsMap>((componentsMap: ComponentsMap, curDoc: Document): ComponentsMap => {
      const curComponentsMap = curDoc.getComponentsMap()
      if (Array.isArray(curComponentsMap)) {
        curComponentsMap.forEach(item => {
          const found = componentsMap.find(eItem => {
            if (
              isProCodeComponentType(eItem) &&
              isProCodeComponentType(item) &&
              eItem.package === item.package &&
              eItem.version === item.version &&
              eItem.componentName === item.componentName
            ) {
              return true
            } else if (isLowCodeComponentType(eItem) && eItem.componentName === item.componentName) {
              return true
            }
            return false
          })
          if (found) return
          componentsMap.push(item)
        })
      }
      return componentsMap
    }, [] as ComponentsMap)
  }

  /**
   * load project schema
   * @param schema project schema
   * @param autoOpen auto open document, if type is string, will open document by id, if type is boolean, will open first document
   */
  @action
  load(schema?: ProjectSchema, autoOpen?: boolean | string) {
    this.assertProjectMutationAllowed()
    // Validation, migration, and normalization must complete before the
    // current project is unloaded. A rejected schema therefore has no
    // observable side effects.
    const preparedSchema = schema === undefined ? createEmptyProjectSchema() : this.schemaValidator.prepare(schema)

    this.unload()

    // Loading is replacement, not a merge. Reusing the previous data object
    // would leak stale config, metadata, or extension fields into the new
    // project.
    this.data = this.protectProjectDataValue(preparedSchema)
    this._config = this.data.config

    // perf: 在 open 的时候才创建 document
    // if (schema?.documents) {
    //   for (const document of schema.documents) {
    //     this.createDocument(document)
    //   }
    // }

    if (autoOpen) {
      if (autoOpen === true) {
        // auto open first document or open a blank page
        const documentInstances = this.data.componentsTree.map(data => this.createDocument(data))
        documentInstances[0]?.open()
      } else {
        // auto open should be string of fileName
        this.open(autoOpen)
      }
    }
  }

  @action
  unload() {
    this.assertProjectMutationAllowed()
    if (this.documents.length < 1) {
      return
    }
    for (let i = this.documents.length - 1; i >= 0; i--) {
      this.documents[i].remove()
    }
  }

  async dispose() {
    assertPublicLifecycleTeardownAllowed(this, 'project.dispose')
    this.assertProjectMutationAllowed()
    await this.#disposeInternal()
  }

  async #disposeInternal(): Promise<void> {
    const failures: unknown[] = []
    const simulator: unknown = this._simulator
    const legacySimulator = simulator as LegacySimulatorLifecycle | undefined
    let simulatorDisposed = true
    try {
      if (simulator instanceof Simulator) {
        await runInternalLifecycleTeardown<[], void | Promise<void>>(simulator)
      } else if (legacySimulator?.dispose) {
        await legacySimulator.dispose()
      } else {
        await legacySimulator?.purge?.()
      }
    } catch (error) {
      simulatorDisposed = false
      failures.push(error)
    }

    runInAction(() => {
      withProjectTeardownAuthority(this, () => {
        for (const document of [...this.documents].reverse()) {
          try {
            removeDocumentDuringTeardown(document)
          } catch (error) {
            failures.push(error)
            try {
              purgeDocumentDuringTeardown(document)
            } catch (purgeError) {
              failures.push(purgeError)
            }
            this.internalUnlinkDocument(document)
            retireDocumentDuringTeardown(document)
          }
        }

        if (simulatorDisposed) {
          this._simulator = undefined
        }
        this.documents = []
        this.documentsMap.clear()
        this.data = this.protectProjectDataValue(createEmptyProjectSchema())
        this._config = undefined
        this.isRendererReady = false
        runInternalLifecycleTeardown(this.emitter)
      })
    })
    if (failures.length) {
      throw new AggregateError(failures, 'Project disposal completed with errors')
    }
  }

  @action
  createDocument(schema?: RootSchema) {
    this.assertProjectMutationAllowed()
    const preparedSchema = schema ? (this.schemaValidator.prepareNode(schema, '$.document') as RootSchema) : undefined
    const doc = new Document(this, preparedSchema)
    this.documents.push(doc)
    this.documentsMap.set(doc.id, doc)

    this.designer.postEvent(DOCUMENT_EVENT.ADD, doc)
    return doc
  }

  @action
  removeDocument(idOrDoc: string | Document) {
    this.assertProjectMutationAllowed()
    let document: Document | undefined
    if (typeof idOrDoc === 'string') {
      document = this.documents.find(document => document.id === idOrDoc)
    } else {
      document = idOrDoc
    }

    if (!document) {
      return logger.warn('document not found', idOrDoc)
    }

    const index = this.documents.indexOf(document)
    if (index < 0) {
      return logger.warn('document not found', idOrDoc)
    }

    document.remove()
  }

  /** @internal Document.remove owns teardown; this method only unlinks project identity. */
  @action
  internalUnlinkDocument(document: Document) {
    this.assertProjectMutationAllowed()
    const index = this.documents.indexOf(document)
    if (index < 0) {
      return logger.warn('document not found', document)
    }

    this.documents.splice(index, 1)
    this.documentsMap.delete(document.id)
  }

  getDocument(id: string) {
    return this.documents.find(doc => doc.id === id)
  }

  /** Internal guard that prevents ambient hooks from mutating another document. */
  #beginDocumentMutationBoundary(document: Document): DocumentMutationBoundary {
    if (this.documentMutationBoundary) {
      throw new Error('A document mutation boundary is already active')
    }
    if (this.getDocument(document.id) !== document) {
      throw new Error('The document mutation boundary requires a project-owned document')
    }
    const token = {}
    this.documentMutationBoundary = { document, mutationsAllowed: false, token }
    const requireActiveBoundary = (): ActiveDocumentMutationBoundary => {
      const boundary = this.documentMutationBoundary
      if (!boundary || boundary.token !== token) {
        throw new Error('The document mutation boundary is no longer active')
      }
      return boundary
    }
    return {
      allowMutations: () => {
        requireActiveBoundary().mutationsAllowed = true
      },
      release: () => {
        if (this.documentMutationBoundary?.token === token) this.documentMutationBoundary = undefined
      },
      seal: () => {
        requireActiveBoundary().mutationsAllowed = false
      },
    }
  }

  assertDocumentMutationAllowed(document: Document): void {
    assertLifecycleMutationAllowed(document, 'document.mutation')
    assertProjectMutationAuthority(this, 'document.mutation')
    const boundary = this.documentMutationBoundary
    if (boundary && (boundary.document !== document || !boundary.mutationsAllowed)) {
      throw new Error(`Document mutation is blocked while document "${boundary.document.id}" is isolated`)
    }
  }

  /** Internal liveness check for generation-owned history/listener state. */
  assertDocumentGenerationActive(document: Document): void {
    assertLifecycleMutationAllowed(document, 'document.generation')
  }

  /** Internal guard for project document identity and lifecycle changes. */
  assertProjectMutationAllowed(): void {
    assertProjectMutationAuthority(this, 'project.mutation')
    const boundary = this.documentMutationBoundary
    if (boundary) {
      throw new Error(`Project mutation is blocked while document "${boundary.document.id}" is isolated`)
    }
  }

  /** Internal guard for operations that detach, purge, open, or close a document. */
  assertDocumentLifecycleMutationAllowed(document: Document): void {
    assertLifecycleMutationAllowed(document, 'document.lifecycle')
    assertProjectMutationAuthority(this, 'document.lifecycle')
    const boundary = this.documentMutationBoundary
    if (boundary) {
      throw new Error(
        `Document "${document.id}" lifecycle mutation is blocked while document "${boundary.document.id}" is isolated`,
      )
    }
  }

  getDocumentByFileName(fileName: string) {
    return this.documents.find(doc => doc.fileName === fileName)
  }

  prepareDocumentSchema(schema: RootSchema): RootSchema {
    return this.schemaValidator.prepareNode(schema, '$.document') as RootSchema
  }

  /**
   * open or create a document
   */
  open(idOrDoc?: string | Document | RootSchema) {
    this.assertProjectMutationAllowed()
    if (!idOrDoc) {
      const got = this.documents.find(item => item.isBlank())
      if (got) {
        return got.open()
      }
      return this.createDocument().open()
    }

    if (typeof idOrDoc === 'string' || typeof idOrDoc === 'number') {
      const got = this.documents.find(item => item.fileName === String(idOrDoc) || String(item.id) === String(idOrDoc))
      if (got) {
        return got.open()
      }

      const data = this.data.componentsTree.find(data => data.fileName === String(idOrDoc))
      if (data) {
        const doc = this.createDocument(data)
        return doc.open()
      }

      return null
    }
    if (isDocument(idOrDoc)) {
      return idOrDoc.open()
    }

    const newDoc = this.createDocument(idOrDoc)
    return newDoc.open()
  }

  /**
   * suspense other documents
   * @param curDoc current active document
   */
  checkExclusive(curDoc: Document) {
    this.assertProjectMutationAllowed()
    for (const doc of this.documents) {
      if (doc !== curDoc) {
        doc.suspense()
      }
    }

    this.emitter.emit(DOCUMENT_EVENT.OPEN_CHANGE, curDoc)
  }

  closeOthers(opened: Document) {
    this.assertProjectMutationAllowed()
    this.documents.forEach(doc => {
      if (doc !== opened) {
        doc.close()
      }
    })
  }

  /**
   * set extra data, available for plugins
   */
  set<T extends keyof ProjectSchema>(key: T, value: ProjectSchema[T]): void
  set(key: string, value: unknown): void
  set(key: string, value: unknown): void {
    this.assertProjectMutationAllowed()
    const protectedValue = this.protectProjectDataValue(value, true)
    if (key === 'config') {
      this._config = protectedValue as Record<string, any>
    }

    this.data = this.protectProjectDataValue({ ...this.data, [key]: protectedValue })
  }

  /**
   * get extra data, available for plugins
   */
  get<T extends keyof ProjectSchema>(key: T): ProjectSchema[T]
  get<T>(key: string): T
  get(key: string): unknown
  get(key: string): any {
    if (key === 'config') {
      return this._config
    }

    return Reflect.get(this.data, key)
  }

  private protectProjectDataValue<T>(value: T, clone = false): T {
    if (this.allowsDirectModelMutation()) return value
    return deepFreezeProjectData(clone ? cloneProjectDataValue(value) : value)
  }

  private isRendererReady = false

  setRendererReady(renderer: any) {
    this.assertProjectMutationAllowed()
    this.isRendererReady = true
    this.emitter.emit(PROJECT_EVENT.RENDERER_READY, renderer)
  }

  mountSimulator(simulator: Simulator) {
    this.assertProjectMutationAllowed()
    assertLifecycleMutationAllowed(simulator, 'project.mountSimulator.target')
    if (this._simulator && this._simulator !== simulator) {
      const currentSimulator: unknown = this._simulator
      if (currentSimulator instanceof Simulator) runInternalLifecycleTeardown(currentSimulator)
      else (currentSimulator as LegacySimulatorLifecycle).dispose?.()
    }
    inheritLifecycleMutationGuard(this, simulator)
    if (simulator instanceof Simulator) inheritEngineTeardownOwnership(this, simulator)
    this._simulator = simulator
    this.emitter.emit(PROJECT_EVENT.SIMULATOR_READY, simulator)
  }

  onSimulatorReady(listener: (simulator: Simulator) => void): () => void {
    assertLifecycleMutationAllowed(this, 'project.onSimulatorReady')
    if (this._simulator) {
      listener(this._simulator)
    }

    return this.emitter.on(PROJECT_EVENT.SIMULATOR_READY, listener)
  }

  /**
   * use to wait for renderer ready and then do initial work
   */
  onRendererReady(listener: () => void): () => void {
    assertLifecycleMutationAllowed(this, 'project.onRendererReady')
    if (this.isRendererReady) {
      listener()
    }

    return this.emitter.on(PROJECT_EVENT.RENDERER_READY, listener)
  }

  onDocumentAdd(listener: (document: Document) => void) {
    assertLifecycleMutationAllowed(this, 'project.onDocumentAdd')
    const dispose = this.designer.onEvent(DOCUMENT_EVENT.ADD, listener)

    return () => {
      dispose()
    }
  }

  onDocumentRemove(listener: (id: string) => void) {
    assertLifecycleMutationAllowed(this, 'project.onDocumentRemove')
    const dispose = this.designer.onEvent(DOCUMENT_EVENT.REMOVE, listener)

    return () => {
      dispose()
    }
  }

  onCurrentDocumentChange(listener: (document: Document) => void) {
    assertLifecycleMutationAllowed(this, 'project.onCurrentDocumentChange')
    const dispose = this.designer.onEvent(DOCUMENT_EVENT.OPEN_CHANGE, listener)

    return () => {
      dispose()
    }
  }
}
