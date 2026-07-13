import { action, computed, intercept, observable, observe, runInAction } from 'mobx'
import type { Designer } from '../designer'
import { DOCUMENT_EVENT, Document, isDocument } from '../document'
import { SchemaValidator } from '../schema'
import type { Simulator } from '../simulator'
import { resolveTrustPolicy } from '../trust'
import { type ComponentsMap, type ProjectSchema, type RootSchema, TRANSFORM_STAGE } from '../types'
import { type EventBus, createLogger, isLowCodeComponentType, isProCodeComponentType } from '../utils'

const logger = createLogger('Project')

export enum PROJECT_EVENT {
  RENDERER_READY = 'renderer:ready',
  SIMULATOR_READY = 'simulator:ready',
}

export interface DocumentMutationBoundary {
  allowMutations(): void
  seal(): void
  release(): void
}

interface ActiveDocumentMutationBoundary {
  readonly document: Document
  readonly token: object
  mutationsAllowed: boolean
}

export class Project {
  private emitter: EventBus

  private data: ProjectSchema = {
    version: '0.0.1',
    componentsMap: [],
    componentsTree: [],
  }

  @observable.shallow accessor documents: Document[] = []

  private documentsMap = new Map<string, Document>()

  private documentMutationBoundary?: ActiveDocumentMutationBoundary

  private documentsMutationDisposer: () => void = () => {}

  @computed
  get currentDocument() {
    return this.documents.find(document => document.active)
  }

  @observable private accessor _config: Record<string, any> | undefined

  @computed
  get config(): Record<string, any> | undefined {
    return this._config
  }

  set config(value: Record<string, any>) {
    this._config = value
  }

  private _simulator?: Simulator

  private readonly schemaValidator: SchemaValidator

  get simulator() {
    return this._simulator || null
  }

  constructor(
    readonly designer: Designer,
    schema?: ProjectSchema,
  ) {
    this.emitter = designer.createEventBus('Project')
    this.schemaValidator =
      this.designer.get('schemaValidator') || new SchemaValidator(resolveTrustPolicy('legacyTrusted'))
    this.trackDocumentCollectionMutations()
    intercept(this, 'documents', change => {
      this.assertProjectMutationAllowed()
      return change
    })
    observe(this, 'documents', () => {
      this.trackDocumentCollectionMutations()
    })
    this.load(schema)
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
    // Validation and normalization must complete before the current project is
    // unloaded. A rejected schema therefore has no observable side effects.
    const preparedSchema = schema ? this.schemaValidator.prepare(schema) : undefined

    this.unload()

    this.data = {
      ...this.data,
      ...preparedSchema,
    }
    this._config = preparedSchema?.config ?? this.config

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
    this.assertProjectMutationAllowed()
    const failures: unknown[] = []
    const simulator = this._simulator as (Simulator & { dispose?: () => void | Promise<void> }) | undefined
    let simulatorDisposed = true
    try {
      if (simulator?.dispose) {
        await simulator.dispose()
      } else {
        simulator?.purge()
      }
    } catch (error) {
      simulatorDisposed = false
      failures.push(error)
    }

    for (const document of [...this.documents].reverse()) {
      try {
        document.remove()
      } catch (error) {
        failures.push(error)
        try {
          document.purge()
        } catch (purgeError) {
          failures.push(purgeError)
        }
        this.removeDocument(document)
      }
    }

    runInAction(() => {
      if (simulatorDisposed) {
        this._simulator = undefined
      }
      this.documents = []
      this.documentsMap.clear()
      this.data = {
        version: '0.0.1',
        componentsMap: [],
        componentsTree: [],
      }
      this._config = undefined
      this.isRendererReady = false
      this.emitter.dispose()
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

    this.documents.splice(index, 1)
    this.documentsMap.delete(document.id)
  }

  getDocument(id: string) {
    return this.documents.find(doc => doc.id === id)
  }

  /** Internal guard that prevents ambient hooks from mutating another document. */
  beginDocumentMutationBoundary(document: Document): DocumentMutationBoundary {
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
    const boundary = this.documentMutationBoundary
    if (boundary && (boundary.document !== document || !boundary.mutationsAllowed)) {
      throw new Error(`Document mutation is blocked while document "${boundary.document.id}" is isolated`)
    }
  }

  /** Internal guard for project document identity and lifecycle changes. */
  assertProjectMutationAllowed(): void {
    const boundary = this.documentMutationBoundary
    if (boundary) {
      throw new Error(`Project mutation is blocked while document "${boundary.document.id}" is isolated`)
    }
  }

  /** Internal guard for operations that detach, purge, open, or close a document. */
  assertDocumentLifecycleMutationAllowed(document: Document): void {
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
    if (key === 'config') {
      this._config = value as Record<string, any>
    }

    Object.assign(this.data, { [key]: value })
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

  private isRendererReady = false

  setRendererReady(renderer: any) {
    this.isRendererReady = true
    this.emitter.emit(PROJECT_EVENT.RENDERER_READY, renderer)
  }

  mountSimulator(simulator: Simulator) {
    this._simulator = simulator
    this.emitter.emit(PROJECT_EVENT.SIMULATOR_READY, simulator)
  }

  onSimulatorReady(listener: (simulator: Simulator) => void): () => void {
    if (this._simulator) {
      listener(this._simulator)
    }

    this.emitter.on(PROJECT_EVENT.SIMULATOR_READY, listener)
    return () => {
      this.emitter.off(PROJECT_EVENT.SIMULATOR_READY, listener)
    }
  }

  /**
   * use to wait for renderer ready and then do initial work
   */
  onRendererReady(listener: () => void): () => void {
    if (this.isRendererReady) {
      listener()
    }

    this.emitter.on(PROJECT_EVENT.RENDERER_READY, listener)
    return () => {
      this.emitter.off(PROJECT_EVENT.RENDERER_READY, listener)
    }
  }

  onDocumentAdd(listener: (document: Document) => void) {
    const dispose = this.designer.onEvent(DOCUMENT_EVENT.ADD, listener)

    return () => {
      dispose()
    }
  }

  onDocumentRemove(listener: (id: string) => void) {
    const dispose = this.designer.onEvent(DOCUMENT_EVENT.REMOVE, listener)

    return () => {
      dispose()
    }
  }

  onCurrentDocumentChange(listener: (document: Document) => void) {
    const dispose = this.designer.onEvent(DOCUMENT_EVENT.OPEN_CHANGE, listener)

    return () => {
      dispose()
    }
  }
}
