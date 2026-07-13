/**
 * Material Registry Implementation
 * 物料注册表实现
 */

import { action, computed, observable, runInAction } from 'mobx'
import type { Designer } from '../../designer'
import { assertLifecycleMutationAllowed, inheritLifecycleMutationGuard } from '../../lifecycle/mutation-barrier'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../../lifecycle/teardown-boundary'
import type { Component, ComponentMetadata } from '../../types'
import { ComponentMeta } from '../component-meta'
import {
  captureComponentMetaTransactionState,
  replaceComponentMetaMetadata,
  restoreComponentMetaTransactionState,
} from '../component-meta-transaction'
import { installMaterialRegistryTeardown } from './teardown'
import {
  type MaterialEntryTransactionState,
  type MaterialRegistryTransactionState,
  installMaterialRegistryTransactionOperations,
} from './transaction-boundary'
import {
  type IMaterialRegistry,
  type MaterialEntry,
  type MaterialRegistryEntrySnapshot,
  type MaterialRegistrySnapshot,
  MaterialSource,
  MaterialStatus,
  type RegisterOptions,
  type RegistryEvent,
  type RegistryEventListener,
  RegistryEventType,
  type UnloadOptions,
} from './types'

const COMPONENT_NAME_REGEX = /^[A-Za-z_$][A-Za-z0-9_$.@]*$/
const MAX_COMPONENT_NAME_LENGTH = 255

interface MutableMaterialEntry {
  component?: Component
  componentName: string
  extensions?: Map<string, unknown>
  lastAccessedAt: number
  loadedAt: number
  meta: ComponentMeta
  source: MaterialSource
  status: MaterialStatus
  usageCount: number
  version?: string
}

interface OwnedCloneContext {
  readonly clones: Map<object, unknown>
  readonly opaqueValues: WeakSet<object>
}

interface NormalizedRegisterOptions {
  readonly component?: Component
  readonly extensions?: Map<string, unknown>
  readonly override?: boolean
  readonly source?: MaterialSource
  readonly version?: string
}

type InternalRegistryEvent = Omit<RegistryEvent, 'entry' | 'error' | 'timestamp'> & {
  readonly entry?: MutableMaterialEntry
  readonly error?: Error
}

const cloneOwnedValue = <T>(value: T, context: OwnedCloneContext, path: readonly string[]): T => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value
  if (typeof value === 'function') return value
  if (context.clones.has(value)) return context.clones.get(value) as T

  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    context.opaqueValues.add(value)
    return value
  }

  const clone: unknown[] | Record<PropertyKey, unknown> = Array.isArray(value) ? [] : Object.create(prototype)
  context.clones.set(value, clone)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (!descriptor) continue
    if (!('value' in descriptor)) {
      throw new TypeError(`Material extension data cannot contain accessors at ${[...path, String(key)].join('.')}`)
    }
    Reflect.defineProperty(clone, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      value: cloneOwnedValue(descriptor.value, context, [...path, String(key)]),
      writable: true,
    })
  }
  return clone as T
}

const freezeOwnedValue = <T>(value: T, opaqueValues: WeakSet<object>, visited = new WeakSet<object>()): T => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value
  if (typeof value === 'function' || opaqueValues.has(value) || visited.has(value)) return value
  visited.add(value)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (descriptor && 'value' in descriptor) freezeOwnedValue(descriptor.value, opaqueValues, visited)
  }
  return Object.freeze(value)
}

const cloneExtensions = (extensions?: ReadonlyMap<string, unknown>): Map<string, unknown> | undefined => {
  if (extensions === undefined) return undefined
  if (!(extensions instanceof Map)) throw new TypeError('Material extensions must be provided as a Map')
  const context: OwnedCloneContext = { clones: new Map(), opaqueValues: new WeakSet() }
  const clone = new Map<string, unknown>()
  for (const [key, value] of Map.prototype.entries.call(extensions) as MapIterator<[string, unknown]>) {
    if (typeof key !== 'string' || key.length === 0)
      throw new TypeError('Material extension keys must be non-empty strings')
    clone.set(key, cloneOwnedValue(value, context, ['extensions', key]))
  }
  for (const [key, value] of clone) clone.set(key, freezeOwnedValue(value, context.opaqueValues))
  return clone
}

const readOwnDataProperty = (value: object, key: PropertyKey, context: string): unknown => {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !('value' in descriptor))
    throw new TypeError(`${context}.${String(key)} must be an own data property`)
  return descriptor.value
}

const readOptionalDataProperty = (value: object, key: PropertyKey, context: string): unknown => {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
  if (!descriptor) return undefined
  if (!('value' in descriptor)) throw new TypeError(`${context}.${String(key)} must be a data property`)
  return descriptor.value
}

const readComponentName = (metadata: ComponentMetadata): string => {
  if (!metadata || typeof metadata !== 'object') throw new TypeError('Component metadata must be a plain object')
  return readOwnDataProperty(metadata, 'componentName', 'metadata') as string
}

const normalizeRegisterOptions = (options: RegisterOptions): NormalizedRegisterOptions => {
  if (!options || typeof options !== 'object') throw new TypeError('Material register options must be an object')
  const component = readOptionalDataProperty(options, 'component', 'options') as Component | undefined
  const extensions = cloneExtensions(
    readOptionalDataProperty(options, 'extensions', 'options') as ReadonlyMap<string, unknown> | undefined,
  )
  const override = readOptionalDataProperty(options, 'override', 'options')
  const source = readOptionalDataProperty(options, 'source', 'options')
  const version = readOptionalDataProperty(options, 'version', 'options')
  if (override !== undefined && typeof override !== 'boolean') throw new TypeError('options.override must be a boolean')
  if (source !== undefined && !Object.values(MaterialSource).includes(source as MaterialSource)) {
    throw new TypeError('options.source must be a valid MaterialSource')
  }
  if (version !== undefined && (typeof version !== 'string' || version.length === 0)) {
    throw new TypeError('options.version must be a non-empty string')
  }
  return {
    component,
    extensions,
    override: override as boolean | undefined,
    source: source as MaterialSource | undefined,
    version: version as string | undefined,
  }
}

const createGeneratedMetadata = (
  componentName: string,
  generatedMetadata?: ComponentMetadata | null,
): ComponentMetadata => {
  if (!generatedMetadata) return { componentName }
  if (typeof generatedMetadata !== 'object') throw new TypeError('Generated component metadata must be an object')
  const descriptors = Object.getOwnPropertyDescriptors(generatedMetadata)
  Reflect.deleteProperty(descriptors, 'componentName')
  return Object.create(Object.getPrototypeOf(generatedMetadata), {
    ...descriptors,
    componentName: {
      configurable: true,
      enumerable: true,
      value: componentName,
      writable: true,
    },
  }) as ComponentMetadata
}

const snapshotEntry = (entry: MutableMaterialEntry): MaterialRegistryEntrySnapshot =>
  Object.freeze({
    componentLoaded: entry.component !== undefined,
    componentName: entry.componentName,
    extensionKeys: Object.freeze([...(entry.extensions?.keys() || [])].sort()),
    source: entry.source,
    status: entry.status,
    usageCount: entry.usageCount,
    version: entry.version,
  })

const snapshotError = (error?: Error): Readonly<Error> | undefined => {
  if (!error) return undefined
  const clone = new Error(error.message)
  clone.name = error.name
  clone.stack = error.stack
  return Object.freeze(clone)
}

const createEntryView = (entry: MutableMaterialEntry): MaterialEntry =>
  Object.freeze({
    component: entry.component,
    componentName: entry.componentName,
    extensions: entry.extensions ? new Map(entry.extensions) : undefined,
    lastAccessedAt: entry.lastAccessedAt,
    loadedAt: entry.loadedAt,
    meta: entry.meta,
    source: entry.source,
    status: entry.status,
    usageCount: entry.usageCount,
    version: entry.version,
  })

export class MaterialRegistry implements IMaterialRegistry {
  readonly #entries = observable.map<string, MutableMaterialEntry>(undefined, { deep: false })

  readonly #pendingEntries = observable.map<string, MutableMaterialEntry>(undefined, { deep: false })

  readonly #version = observable.box(0, { deep: false })

  readonly #listeners = new Set<RegistryEventListener>()

  readonly #pendingMetaTeardowns = new Set<ComponentMeta>()

  readonly #designer: Designer

  #disposeStarted = false

  #disposeCompleted = false

  #activeTransaction?: {
    readonly deferredMetaTeardowns: Set<ComponentMeta>
    readonly state: MaterialRegistryTransactionState
  }

  constructor(designer: Designer) {
    this.#designer = designer
    installLifecycleTeardownOperation(
      this,
      action(() => this.#disposeInternal()),
    )
    installMaterialRegistryTeardown(this, componentName => {
      const entry = this.#entries.get(componentName) || this.#pendingEntries.get(componentName)
      if (entry && entry.usageCount > 0) entry.usageCount--
    })
    installMaterialRegistryTransactionOperations(this, {
      begin: () => this.#beginTransaction(),
      commit: state => this.#commitTransaction(state),
      restore: state => this.#restoreTransaction(state),
    })
  }

  get version(): number {
    return this.#version.get()
  }

  #prepareMeta(meta: ComponentMeta): ComponentMeta {
    inheritLifecycleMutationGuard(this, meta)
    inheritEngineTeardownOwnership(this, meta)
    return meta
  }

  #teardownMeta(meta: ComponentMeta): void {
    if (this.#activeTransaction) this.#activeTransaction.deferredMetaTeardowns.add(meta)
    else {
      this.#pendingMetaTeardowns.add(meta)
      this.#flushPendingMetaTeardowns()
    }
  }

  #flushPendingMetaTeardowns(): void {
    const errors: unknown[] = []
    for (const meta of this.#pendingMetaTeardowns) {
      try {
        runInternalLifecycleTeardown(meta)
        this.#pendingMetaTeardowns.delete(meta)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, 'One or more component metadata instances failed to dispose')
  }

  #assertUsable(origin: string): void {
    if (this.#disposeStarted) throw new Error(`Cannot ${origin} on a disposed material registry`)
    assertLifecycleMutationAllowed(this, origin)
  }

  #validateComponentName(name: string): boolean {
    return (
      !!name && typeof name === 'string' && name.length <= MAX_COMPONENT_NAME_LENGTH && COMPONENT_NAME_REGEX.test(name)
    )
  }

  #emit(event: InternalRegistryEvent): void {
    const fullEvent: RegistryEvent = Object.freeze({
      componentName: event.componentName,
      entry: event.entry ? snapshotEntry(event.entry) : undefined,
      error: snapshotError(event.error),
      previousStatus: event.previousStatus,
      timestamp: Date.now(),
      type: event.type,
    })
    const deliver = () => {
      this.#listeners.forEach(listener => {
        try {
          listener(fullEvent)
        } catch (error) {
          console.error('[MaterialRegistry] Event listener error:', error)
        }
      })
    }
    if (!this.#designer.deferEvent(deliver)) deliver()
  }

  #createEntry(
    componentName: string,
    meta: ComponentMeta,
    options: NormalizedRegisterOptions = {},
  ): MutableMaterialEntry {
    const now = Date.now()
    return {
      component: options.component,
      componentName,
      extensions: options.extensions,
      lastAccessedAt: now,
      loadedAt: now,
      meta,
      source: options.source ?? MaterialSource.BUILTIN,
      status: options.component ? MaterialStatus.ACTIVE : MaterialStatus.REGISTERED,
      usageCount: 0,
      version: options.version,
    }
  }

  #bumpVersion(): void {
    this.#version.set(this.#version.get() + 1)
  }

  @action
  register(metadata: ComponentMetadata, options: RegisterOptions = {}): ComponentMeta {
    this.#assertUsable('materials.registry.register')
    const componentName = readComponentName(metadata)
    if (!this.#validateComponentName(componentName)) {
      console.warn(`[MaterialRegistry] Invalid component name: "${componentName}"`)
      throw new Error(`Invalid component name: "${componentName}"`)
    }

    const normalizedOptions = normalizeRegisterOptions(options)
    const nextExtensions = normalizedOptions.extensions
    let entry = this.#entries.get(componentName)
    let isNew = false

    if (entry) {
      if (normalizedOptions.override) {
        const previousMeta = entry.meta
        entry.meta = this.#prepareMeta(new ComponentMeta(this.#designer, metadata))
        this.#teardownMeta(previousMeta)
        entry.component = normalizedOptions.component
        entry.status = normalizedOptions.component ? MaterialStatus.ACTIVE : MaterialStatus.REGISTERED
      } else {
        replaceComponentMetaMetadata(entry.meta, metadata)
        if (normalizedOptions.component !== undefined) {
          entry.component = normalizedOptions.component
          entry.status = MaterialStatus.ACTIVE
        }
      }
      if (normalizedOptions.source !== undefined) entry.source = normalizedOptions.source
      if (normalizedOptions.version !== undefined) entry.version = normalizedOptions.version
      if (nextExtensions !== undefined) entry.extensions = nextExtensions
      entry.lastAccessedAt = Date.now()
    } else {
      const pendingEntry = this.#pendingEntries.get(componentName)
      if (pendingEntry) {
        replaceComponentMetaMetadata(pendingEntry.meta, metadata)
        pendingEntry.status = normalizedOptions.component ? MaterialStatus.ACTIVE : MaterialStatus.REGISTERED
        pendingEntry.component = normalizedOptions.component
        pendingEntry.source = normalizedOptions.source ?? MaterialSource.BUILTIN
        pendingEntry.version = normalizedOptions.version
        if (nextExtensions !== undefined) pendingEntry.extensions = nextExtensions
        pendingEntry.lastAccessedAt = Date.now()
        entry = pendingEntry
        this.#pendingEntries.delete(componentName)
      } else {
        const meta = this.#prepareMeta(new ComponentMeta(this.#designer, metadata))
        entry = this.#createEntry(componentName, meta, normalizedOptions)
      }
      isNew = true
      this.#entries.set(componentName, entry)
    }

    this.#bumpVersion()
    this.#emit({
      componentName,
      entry,
      type: isNew ? RegistryEventType.REGISTERED : RegistryEventType.UPDATED,
    })
    return entry.meta
  }

  @action
  async unload(componentName: string, options: UnloadOptions = {}): Promise<boolean> {
    this.#assertUsable('materials.registry.unload')
    const entry = this.#entries.get(componentName)
    if (!entry) {
      console.warn(`[MaterialRegistry] Component not found: "${componentName}"`)
      return false
    }
    if (!options.force && entry.usageCount > 0) {
      console.warn(`[MaterialRegistry] Cannot unload "${componentName}": ${entry.usageCount} instances in use`)
      return false
    }

    const previousStatus = entry.status
    entry.status = MaterialStatus.UNLOADING
    this.#emit({ componentName, entry, previousStatus, type: RegistryEventType.STATUS_CHANGED })
    this.#teardownMeta(entry.meta)
    this.#entries.delete(componentName)
    this.#bumpVersion()
    this.#emit({ componentName, type: RegistryEventType.UNLOADED })
    return true
  }

  get(componentName: string): MaterialEntry | undefined {
    const entry = this.#entries.get(componentName)
    return entry ? createEntryView(entry) : undefined
  }

  @action
  getOrCreate(componentName: string, generateMetadata?: () => ComponentMetadata | null): ComponentMeta {
    this.#assertUsable('materials.registry.getOrCreate')
    if (!this.#validateComponentName(componentName)) throw new Error(`Invalid component name: "${componentName}"`)
    const entry = this.#entries.get(componentName)
    if (entry) {
      entry.lastAccessedAt = Date.now()
      return entry.meta
    }
    const pendingEntry = this.#pendingEntries.get(componentName)
    if (pendingEntry) {
      pendingEntry.lastAccessedAt = Date.now()
      return pendingEntry.meta
    }

    const metadata = createGeneratedMetadata(componentName, generateMetadata?.())
    const meta = this.#prepareMeta(new ComponentMeta(this.#designer, metadata))
    const newEntry = this.#createEntry(componentName, meta, { source: MaterialSource.BUILTIN })
    newEntry.status = MaterialStatus.LOADING
    this.#pendingEntries.set(componentName, newEntry)
    this.#bumpVersion()
    return meta
  }

  has(componentName: string): boolean {
    return this.#entries.has(componentName)
  }

  @action
  incrementUsage(componentName: string): void {
    this.#assertUsable('materials.registry.incrementUsage')
    const entry = this.#entries.get(componentName) || this.#pendingEntries.get(componentName)
    if (entry) {
      entry.usageCount++
      this.#emit({ componentName, entry, type: RegistryEventType.USAGE_CHANGED })
    }
  }

  @action
  decrementUsage(componentName: string): void {
    this.#assertUsable('materials.registry.decrementUsage')
    const entry = this.#entries.get(componentName) || this.#pendingEntries.get(componentName)
    if (entry && entry.usageCount > 0) {
      entry.usageCount--
      this.#emit({ componentName, entry, type: RegistryEventType.USAGE_CHANGED })
    }
  }

  canUnload(componentName: string): boolean {
    const entry = this.#entries.get(componentName)
    return !!entry && entry.usageCount === 0
  }

  getUsageCount(componentName: string): number {
    return (this.#entries.get(componentName) || this.#pendingEntries.get(componentName))?.usageCount || 0
  }

  #captureEntryTransactionState(entry: MutableMaterialEntry): MaterialEntryTransactionState {
    return {
      component: entry.component,
      componentName: entry.componentName,
      extensions: entry.extensions ? new Map(entry.extensions) : undefined,
      lastAccessedAt: entry.lastAccessedAt,
      loadedAt: entry.loadedAt,
      meta: entry.meta,
      metaState: captureComponentMetaTransactionState(entry.meta),
      source: entry.source,
      status: entry.status,
      usageCount: entry.usageCount,
      version: entry.version,
    }
  }

  #beginTransaction(): MaterialRegistryTransactionState {
    this.#assertUsable('materials.registry.transaction.begin')
    if (this.#activeTransaction) throw new Error('A material registry transaction is already active')
    const state: MaterialRegistryTransactionState = {
      entries: new Map([...this.#entries].map(([key, entry]) => [key, this.#captureEntryTransactionState(entry)])),
      pendingEntries: new Map(
        [...this.#pendingEntries].map(([key, entry]) => [key, this.#captureEntryTransactionState(entry)]),
      ),
      token: {},
      version: this.#version.get(),
    }
    this.#activeTransaction = { deferredMetaTeardowns: new Set(), state }
    return state
  }

  #requireTransaction(state: MaterialRegistryTransactionState) {
    if (!this.#activeTransaction || this.#activeTransaction.state !== state) {
      throw new Error('The material registry transaction is no longer active')
    }
    return this.#activeTransaction
  }

  #commitTransaction(state: MaterialRegistryTransactionState): void {
    const transaction = this.#requireTransaction(state)
    const liveMetas = new Set([...this.#entries.values(), ...this.#pendingEntries.values()].map(entry => entry.meta))
    for (const meta of transaction.deferredMetaTeardowns) {
      if (!liveMetas.has(meta)) this.#pendingMetaTeardowns.add(meta)
    }
    this.#activeTransaction = undefined
    this.#flushPendingMetaTeardowns()
  }

  #restoreTransaction(state: MaterialRegistryTransactionState): void {
    this.#assertUsable('materials.registry.transaction.restore')
    this.#requireTransaction(state)
    runInAction(() => {
      const originalMetas = new Set(
        [...state.entries.values(), ...state.pendingEntries.values()].map(snapshot => snapshot.meta),
      )
      const currentMetas = new Set(
        [...this.#entries.values(), ...this.#pendingEntries.values()].map(entry => entry.meta),
      )
      for (const meta of currentMetas) {
        if (!originalMetas.has(meta)) this.#pendingMetaTeardowns.add(meta)
      }

      const restoreMap = (
        target: Map<string, MutableMaterialEntry>,
        snapshots: Map<string, MaterialEntryTransactionState>,
      ) => {
        target.clear()
        for (const [key, snapshot] of snapshots) {
          restoreComponentMetaTransactionState(snapshot.meta, snapshot.metaState)
          target.set(key, {
            component: snapshot.component,
            componentName: snapshot.componentName,
            extensions: snapshot.extensions ? new Map(snapshot.extensions) : undefined,
            lastAccessedAt: snapshot.lastAccessedAt,
            loadedAt: snapshot.loadedAt,
            meta: snapshot.meta,
            source: snapshot.source,
            status: snapshot.status,
            usageCount: snapshot.usageCount,
            version: snapshot.version,
          })
        }
      }
      restoreMap(this.#entries, state.entries)
      restoreMap(this.#pendingEntries, state.pendingEntries)
      this.#version.set(state.version)
      this.#activeTransaction = undefined
    })
    this.#flushPendingMetaTeardowns()
  }

  subscribe(listener: RegistryEventListener): () => void {
    this.#assertUsable('materials.registry.subscribe')
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getAll(): ReadonlyMap<string, MaterialEntry> {
    return new Map([...this.#entries].map(([key, entry]) => [key, createEntryView(entry)]))
  }

  getSnapshot(): MaterialRegistrySnapshot {
    const snapshotEntries = (entries: ReadonlyMap<string, MutableMaterialEntry>) =>
      Object.freeze(
        [...entries.values()]
          .sort((left, right) => left.componentName.localeCompare(right.componentName))
          .map(snapshotEntry),
      )
    return Object.freeze({
      entries: snapshotEntries(this.#entries),
      pendingEntries: snapshotEntries(this.#pendingEntries),
      version: this.#version.get(),
    })
  }

  getBySource(source: MaterialSource): readonly MaterialEntry[] {
    return Object.freeze([...this.#entries.values()].filter(entry => entry.source === source).map(createEntryView))
  }

  @action
  refresh(): void {
    this.#assertUsable('materials.registry.refresh')
    this.#bumpVersion()
  }

  @computed
  get componentMetasMap(): Record<string, ComponentMetadata> {
    this.#version.get()
    const result: Record<string, ComponentMetadata> = {}
    this.#entries.forEach((entry, key) => {
      result[key] = entry.meta.getMetadata() as ComponentMetadata
    })
    return Object.freeze(result)
  }

  @computed
  get componentsMap(): Record<string, unknown> {
    this.#version.get()
    const result: Record<string, unknown> = {}
    this.#entries.forEach((entry, key) => {
      const metadata = entry.meta.getMetadata()
      if (metadata.devMode === 'lowCode') result[key] = metadata.schema
      else {
        const view = entry.meta.advanced.view ?? entry.component
        if (view) result[key] = view
      }
    })
    return Object.freeze(result)
  }

  getComponentSnippets(): readonly unknown[] {
    const snippets: unknown[] = []
    this.#entries.forEach(entry => snippets.push(...entry.meta.snippets))
    return Object.freeze(snippets)
  }

  @action
  dispose(): void {
    assertPublicLifecycleTeardownAllowed(this, 'materials.registry.dispose')
    this.#disposeInternal()
  }

  #disposeInternal(): void {
    if (this.#disposeCompleted) return
    this.#disposeStarted = true
    this.#entries.forEach(entry => this.#pendingMetaTeardowns.add(entry.meta))
    this.#pendingEntries.forEach(entry => this.#pendingMetaTeardowns.add(entry.meta))
    this.#entries.clear()
    this.#pendingEntries.clear()
    this.#listeners.clear()
    this.#flushPendingMetaTeardowns()
    this.#disposeCompleted = true
  }
}
