import type { Designer } from '../designer'
import { assertLifecycleMutationAllowed } from '../lifecycle/mutation-barrier'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import type { ComponentMetadata, NpmInfo } from '../types'
import type { EventBus } from '../utils'
import {
  type ComponentMetaTransactionState,
  installComponentMetaTransactionOperations,
} from './component-meta-transaction'

export enum COMPONENT_META_EVENT {
  CHANGE = 'componentMeta:metadata.change',
}

const cloneMetadataValue = <T>(value: T, visited = new Map<object, unknown>()): T => {
  if (!value || typeof value !== 'object') return value
  if (visited.has(value)) return visited.get(value) as T
  if (Array.isArray(value)) {
    const clone: unknown[] = []
    visited.set(value, clone)
    value.forEach(item => clone.push(cloneMetadataValue(item, visited)))
    return clone as T
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value
  const clone = Object.create(prototype) as Record<PropertyKey, unknown>
  visited.set(value, clone)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (!descriptor) continue
    if ('value' in descriptor) descriptor.value = cloneMetadataValue(descriptor.value, visited)
    Reflect.defineProperty(clone, key, descriptor)
  }
  return clone as T
}

export class ComponentMeta {
  readonly isComponentMeta = true

  private _npm?: NpmInfo

  private emitter: EventBus

  private disposeStarted = false

  private disposeCompleted = false

  get npm() {
    return this._npm
  }

  set npm(_npm: any) {
    this.setNpm(_npm)
  }

  private _componentName?: string

  get componentName(): string {
    return this._componentName!
  }

  private _isContainer?: boolean

  get isContainer() {
    return this._isContainer!
  }

  private _isMinimalRenderUnit?: boolean

  get isMinimalRenderUnit(): boolean {
    return this._isMinimalRenderUnit || false
  }

  private _descriptor?: string

  get descriptor() {
    return this._descriptor
  }

  private _metadata?: ComponentMetadata

  get configure() {
    return this._metadata?.configure?.props || []
  }

  private _title?: string

  get title(): string {
    return this._title || this.componentName
  }

  get icon() {
    return this._metadata?.icon
  }

  get advanced() {
    return this._metadata?.configure?.advanced || {}
  }

  get snippets() {
    return this._metadata?.snippets || []
  }

  constructor(
    readonly designer: Designer,
    metadata: ComponentMetadata,
  ) {
    installLifecycleTeardownOperation(this, () => this.#disposeInternal())
    this.emitter = designer.createEventBus('ComponentMeta')
    inheritEngineTeardownOwnership(this, this.emitter)
    installComponentMetaTransactionOperations(this, {
      capture: () => this.#captureTransactionState(),
      restore: state => this.#restoreTransactionState(state),
    })
    this.parseMetadata(metadata)
  }

  setNpm(info: NpmInfo) {
    this.assertUsable('materials.componentMeta.setNpm')
    if (!this._npm) {
      this._npm = info
    }
  }

  private parseMetadata(metadata: ComponentMetadata) {
    const { componentName, npm } = metadata
    this._metadata = metadata
    this._npm = npm || this._npm
    this._componentName = componentName

    const { title, configure = {} } = this._metadata
    if (title) {
      this._title = title
    }

    const { component } = configure
    if (component) {
      this._isContainer = !!component.isContainer
      this._descriptor = component.descriptor
      this._isMinimalRenderUnit = component.isMinimalRenderUnit
    } else {
      this._isContainer = false
    }

    this.emitter.emit(COMPONENT_META_EVENT.CHANGE)
  }

  refreshMetadata() {
    this.assertUsable('materials.componentMeta.refreshMetadata')
    this.parseMetadata(this.getMetadata())
  }

  setMetadata(metadata: ComponentMetadata) {
    this.assertUsable('materials.componentMeta.setMetadata')
    this.parseMetadata(metadata)
  }

  getMetadata() {
    return this._metadata!
  }

  onMetadataChange(fn: (args: any) => void) {
    this.assertUsable('materials.componentMeta.onMetadataChange')
    return this.emitter.on(COMPONENT_META_EVENT.CHANGE, fn)
  }

  /**
   * 销毁 ComponentMeta，清理事件监听器
   */
  dispose() {
    assertPublicLifecycleTeardownAllowed(this, 'materials.componentMeta.dispose')
    this.#disposeInternal()
  }

  #disposeInternal() {
    if (this.disposeCompleted) return
    this.disposeStarted = true
    runInternalLifecycleTeardown(this.emitter)
    this.disposeCompleted = true
  }

  #captureTransactionState(): ComponentMetaTransactionState {
    return {
      componentName: this._componentName,
      descriptor: this._descriptor,
      disposeCompleted: this.disposeCompleted,
      disposeStarted: this.disposeStarted,
      isContainer: this._isContainer,
      isMinimalRenderUnit: this._isMinimalRenderUnit,
      metadata: this._metadata ? cloneMetadataValue(this._metadata) : undefined,
      npm: this._npm ? cloneMetadataValue(this._npm) : undefined,
      title: this._title,
    }
  }

  #restoreTransactionState(state: ComponentMetaTransactionState): void {
    this._componentName = state.componentName
    this._descriptor = state.descriptor
    this.disposeCompleted = state.disposeCompleted
    this.disposeStarted = state.disposeStarted
    this._isContainer = state.isContainer
    this._isMinimalRenderUnit = state.isMinimalRenderUnit
    this._metadata = state.metadata ? cloneMetadataValue(state.metadata) : undefined
    this._npm = state.npm ? cloneMetadataValue(state.npm) : undefined
    this._title = state.title
    this.emitter.emit(COMPONENT_META_EVENT.CHANGE)
  }

  private assertUsable(origin: string): void {
    if (this.disposeStarted) throw new Error(`Cannot ${origin} on a disposed component metadata instance`)
    assertLifecycleMutationAllowed(this, origin)
  }

  /**
   * 判断当前节点是否为远程物料组件
   * 远程物料是指通过 CDN 或 NPM 动态加载的组件，而非内置组件
   * @returns boolean 是否为远程物料
   */
  isRemoteMaterial() {
    try {
      return !!(this.npm && this.npm.package && this.npm.package !== 'builtin')
    } catch (error) {
      console.warn(`[ComponentMeta] Failed to check if component "${this.componentName}" is remote material:`, error)
      return false
    }
  }
}

export function isComponentMeta(obj: any): obj is ComponentMeta {
  return obj && obj.isComponentMeta
}
