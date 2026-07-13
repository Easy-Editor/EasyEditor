import type { Designer } from '../designer'
import { assertLifecycleMutationAllowed } from '../lifecycle/mutation-barrier'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import type { Advanced, ComponentMetadata, FieldConfig, NpmInfo, Snippet } from '../types'
import type { EventBus } from '../utils'
import {
  type ComponentMetaTransactionState,
  installComponentMetaTransactionOperations,
} from './component-meta-transaction'

export enum COMPONENT_META_EVENT {
  CHANGE = 'componentMeta:metadata.change',
}

const EMPTY_FIELDS = Object.freeze([]) as readonly FieldConfig[]
const EMPTY_SNIPPETS = Object.freeze([]) as readonly Snippet[]
const EMPTY_ADVANCED = Object.freeze({}) as Readonly<Advanced>

interface MetadataCloneContext {
  readonly clones: Map<object, unknown>
  readonly opaqueValues: WeakSet<object>
}

const isAdvancedViewPath = (path: readonly PropertyKey[]): boolean =>
  path.length === 3 && path[0] === 'configure' && path[1] === 'advanced' && path[2] === 'view'

const cloneMetadataValue = <T>(value: T, context: MetadataCloneContext, path: readonly PropertyKey[] = []): T => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value
  if (isAdvancedViewPath(path)) {
    context.opaqueValues.add(value as object)
    return value
  }
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
      throw new TypeError(`Component metadata cannot contain accessors at ${[...path, key].map(String).join('.')}`)
    }
    Reflect.defineProperty(clone, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      value: cloneMetadataValue(descriptor.value, context, [...path, key]),
      writable: true,
    })
  }
  return clone as T
}

const freezeMetadataValue = <T>(value: T, opaqueValues: WeakSet<object>, visited = new WeakSet<object>()): T => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value
  if (typeof value === 'function' || opaqueValues.has(value) || visited.has(value)) return value
  visited.add(value)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (descriptor && 'value' in descriptor) freezeMetadataValue(descriptor.value, opaqueValues, visited)
  }
  return Object.freeze(value)
}

const snapshotMetadata = (metadata: ComponentMetadata): Readonly<ComponentMetadata> => {
  if (!metadata || typeof metadata !== 'object') throw new TypeError('Component metadata must be a plain object')
  const prototype = Object.getPrototypeOf(metadata)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Component metadata must be a plain object')
  }
  const context: MetadataCloneContext = {
    clones: new Map(),
    opaqueValues: new WeakSet(),
  }
  return freezeMetadataValue(cloneMetadataValue(metadata, context), context.opaqueValues)
}

export class ComponentMeta {
  readonly isComponentMeta!: true

  #metadata!: Readonly<ComponentMetadata>

  #emitter: EventBus

  #disposeStarted = false

  #disposeCompleted = false

  get npm(): Readonly<NpmInfo> | undefined {
    return this.#metadata.npm
  }

  get componentName(): string {
    return this.#metadata.componentName
  }

  get isContainer(): boolean {
    return !!this.#metadata.configure?.component?.isContainer
  }

  get isMinimalRenderUnit(): boolean {
    return !!this.#metadata.configure?.component?.isMinimalRenderUnit
  }

  get descriptor(): string | undefined {
    return this.#metadata.configure?.component?.descriptor
  }

  get configure(): readonly FieldConfig[] {
    return this.#metadata.configure?.props || EMPTY_FIELDS
  }

  get title(): string {
    return this.#metadata.title || this.componentName
  }

  get icon(): string | undefined {
    return this.#metadata.icon
  }

  get advanced(): Readonly<Advanced> {
    return this.#metadata.configure?.advanced || EMPTY_ADVANCED
  }

  get snippets(): readonly Snippet[] {
    return this.#metadata.snippets || EMPTY_SNIPPETS
  }

  constructor(designer: Designer, metadata: ComponentMetadata) {
    Object.defineProperty(this, 'isComponentMeta', {
      configurable: false,
      enumerable: true,
      value: true,
      writable: false,
    })
    installLifecycleTeardownOperation(this, () => this.#disposeInternal())
    this.#emitter = designer.createEventBus('ComponentMeta')
    inheritEngineTeardownOwnership(this, this.#emitter)
    installComponentMetaTransactionOperations(this, {
      capture: () => this.#captureTransactionState(),
      replace: nextMetadata => this.#replaceMetadata(nextMetadata),
      restore: state => this.#restoreTransactionState(state),
    })
    this.#installMetadataSnapshot(snapshotMetadata(metadata), false)
  }

  getMetadata(): Readonly<ComponentMetadata> {
    return this.#metadata
  }

  onMetadataChange(fn: (metadata: Readonly<ComponentMetadata>) => void): () => void {
    this.#assertUsable('materials.componentMeta.onMetadataChange')
    return this.#emitter.on(COMPONENT_META_EVENT.CHANGE, fn)
  }

  dispose(): void {
    assertPublicLifecycleTeardownAllowed(this, 'materials.componentMeta.dispose')
    this.#disposeInternal()
  }

  #replaceMetadata(metadata: ComponentMetadata): void {
    this.#assertUsable('materials.componentMeta.replaceMetadata')
    if (metadata.componentName !== this.componentName) {
      throw new Error('Component metadata name is immutable; register a different component instead')
    }
    this.#installMetadataSnapshot(snapshotMetadata(metadata), true)
  }

  #installMetadataSnapshot(metadata: Readonly<ComponentMetadata>, emit: boolean): void {
    this.#metadata = metadata
    if (emit) this.#emitter.emit(COMPONENT_META_EVENT.CHANGE, metadata)
  }

  #disposeInternal(): void {
    if (this.#disposeCompleted) return
    this.#disposeStarted = true
    runInternalLifecycleTeardown(this.#emitter)
    this.#disposeCompleted = true
  }

  #captureTransactionState(): ComponentMetaTransactionState {
    return {
      disposeCompleted: this.#disposeCompleted,
      disposeStarted: this.#disposeStarted,
      metadata: this.#metadata,
    }
  }

  #restoreTransactionState(state: ComponentMetaTransactionState): void {
    this.#disposeCompleted = state.disposeCompleted
    this.#disposeStarted = state.disposeStarted
    this.#installMetadataSnapshot(state.metadata, true)
  }

  #assertUsable(origin: string): void {
    if (this.#disposeStarted) throw new Error(`Cannot ${origin} on a disposed component metadata instance`)
    assertLifecycleMutationAllowed(this, origin)
  }

  isRemoteMaterial(): boolean {
    try {
      return !!(this.npm && this.npm.package && this.npm.package !== 'builtin')
    } catch (error) {
      console.warn(`[ComponentMeta] Failed to check if component "${this.componentName}" is remote material:`, error)
      return false
    }
  }
}

export function isComponentMeta(obj: any): obj is ComponentMeta {
  return obj && obj.isComponentMeta === true
}
