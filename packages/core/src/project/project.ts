import type { Designer } from '../designer'
import type { DocumentSchema } from '../document'
import type { ComponentsMap } from '../meta'
import type { Simulator } from '../simulator'

import { action, computed, observable } from 'mobx'
import { DOCUMENT_EVENT, Document, isDocument } from '../document'
import { isLowCodeComponentType, isProCodeComponentType } from '../meta'
import { TRANSFORM_STAGE } from '../types'
import { createEventBus, logger } from '../utils'

export interface ProjectSchema {
  version: string
  documents: DocumentSchema[]
  config?: Record<string, any>

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

  import(schema: ProjectSchema) {
    this.load(schema)
  }

  export(stage: TRANSFORM_STAGE = TRANSFORM_STAGE.SAVE): ProjectSchema {
    return {
      ...this.data,
      componentsMap: this.getComponentsMap(),
      documents: this.documents.filter(doc => !doc.isBlank()).map(doc => doc.export(stage) || {}),
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
              // eItem.package === item.package &&
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
    this.unload()

    this.data = {
      ...defaultSchema,
      ...schema,
    }
    this._config = schema?.config ?? this.config

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

  @action
  createDocument(schema?: DocumentSchema) {
    const doc = new Document(this, schema)
    this.documents.push(doc)
    this.documentsMap.set(doc.id, doc)

    this.designer.postEvent(DOCUMENT_EVENT.ADD, doc)
    return doc
  }

  @action
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

  getDocument(id: string) {
    return this.documents.find(doc => doc.id === id)
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
    for (const doc of this.documents) {
      if (doc !== curDoc) {
        doc.suspense()
      }
    }

    this.emitter.emit(DOCUMENT_EVENT.OPEN_CHANGE, curDoc)
  }

  closeOthers(opened: Document) {
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
