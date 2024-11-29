import type { Designer } from '../designer'
import type { DocumentSchema } from '../document'

import { action, computed, observable } from 'mobx'
import { DOCUMENT_EVENT, Document } from '../document'
import type { Simulator } from '../simulator'
import { createEventBus, logger } from '../utils'

export interface ProjectSchema {
  version: string
  documents: DocumentSchema[]
  config?: Record<string, any>
  // TODO: 组件库
  // components: any[]
  // TODO: 插件附加
  [key: string]: any
}

const defaultSchema: ProjectSchema = {
  version: '0.0.1',
  documents: [],
}

export enum PROJECT_EVENT {
  RENDERER_READY = 'renderer:ready',
  SIMULATOR_READY = 'simulator:ready',
}

export class Project {
  private emitter = createEventBus('Project')

  private data: ProjectSchema = defaultSchema

  @observable.shallow accessor documents: Document[] = []

  private documentsMap = new Map<string, Document>()

  @computed get currentDocument() {
    return this.documents.find(document => document.open)
  }

  @observable private accessor _config: Record<string, any> | undefined

  @computed get config(): Record<string, any> | undefined {
    return this._config
  }

  set config(value: Record<string, any>) {
    this._config = value
  }

  private _simulator?: Simulator

  get simulator() {
    return this._simulator || null
  }

  constructor(
    readonly designer: Designer,
    schema?: ProjectSchema,
  ) {
    this.load(schema)
  }

  /**
   * load project schema
   * @param schema project schema
   * @param autoOpen auto open document, if type is string, will open document by id, if type is boolean, will open first document
   */
  load(schema?: ProjectSchema, autoOpen?: boolean | string) {
    this.unload()

    this.data = {
      ...defaultSchema,
      ...schema,
    }

    if (schema?.config) {
      this._config = schema.config
    }

    if (schema?.documents) {
      for (const document of schema.documents) {
        this.createDocument(document)
      }
    }

    if (autoOpen) {
      if (this.documents.length < 1) {
        return logger.warn('no document found, skip auto open')
      }

      if (typeof autoOpen === 'string') {
        this.open(autoOpen)
      } else if (typeof autoOpen === 'boolean') {
        this.open(this.documents[0].id)
      }
    }
  }

  @action
  unload() {
    if (this.documents.length < 1) {
      return
    }
    for (let i = this.documents.length - 1; i >= 0; i--) {
      this.documents[i].remove()
    }
  }

  getSchema(): ProjectSchema {
    return {
      ...this.data,
      documents: this.documents.map(document => document.export()),
    }
  }

  setSchema(schema: ProjectSchema) {
    this.load(schema)
  }

  @action
  createDocument(schema?: DocumentSchema) {
    const doc = new Document(this, schema)
    this.documents.push(doc)
    this.documentsMap.set(doc.id, doc)

    this.designer.postEvent(DOCUMENT_EVENT.ADD, doc)
    return doc
  }

  removeDocument(idOrDoc: string | Document) {
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
    this.documents.splice(index, 1)
    this.documentsMap.delete(document.id)
  }

  /**
   * open or create a document
   */
  open(idOrDoc?: string | Document | DocumentSchema) {
    if (!idOrDoc) {
      logger.warn('no doc param found, will create a new document')
      return this.createDocument().open()
    }

    if (typeof idOrDoc === 'string') {
      const got = this.documents.find(doc => doc.id === idOrDoc)
      return got?.open()
    }
    // if (isDocument(idOrDoc)) {
    // TODO
    if (idOrDoc instanceof Document) {
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
    for (const doc of this.documents) {
      if (doc !== curDoc) {
        doc.suspense()
      }
    }

    this.emitter.emit(DOCUMENT_EVENT.OPEN_CHANGE, curDoc)
  }

  getDocument(id: string) {
    return this.documents.find(doc => doc.id === id)
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
