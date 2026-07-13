/**
 * Resource Registry
 * 已加载资源注册表
 */

import { type ObservableMap, action, computed, observable } from 'mobx'
import { assertLifecycleMutationAllowed } from '../../lifecycle/mutation-barrier'
import {
  assertPublicLifecycleTeardownAllowed,
  installLifecycleTeardownOperation,
} from '../../lifecycle/teardown-boundary'
import type { ResourceType } from '../core/errors'

/** 已加载资源条目 */
export interface LoadedResource<T = unknown> {
  /** 资源类型 */
  readonly type: ResourceType
  /** 资源名称（包名） */
  readonly name: string
  /** 版本号 */
  readonly version: string
  /** UMD 全局变量名 */
  readonly globalName: string
  /** 资源数据；作为适配器拥有的不透明能力对象保留原始引用 */
  readonly data: T
  /** 加载完成时间 */
  readonly loadedAt: number
}

const assertNonEmptyString: (value: unknown, field: string) => asserts value is string = (value, field) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Resource ${field} must be a non-empty string`)
  }
}

const readResourceField = (resource: object, field: keyof LoadedResource): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(resource, field)
  if (!descriptor || !('value' in descriptor)) {
    throw new TypeError(`Resource ${field} must be an own data property`)
  }
  return descriptor.value
}

const snapshotResource = <T>(resource: LoadedResource<T>): LoadedResource<T> => {
  if (!resource || typeof resource !== 'object') {
    throw new TypeError('Resource must be an object')
  }

  const data = readResourceField(resource, 'data') as T
  const globalName = readResourceField(resource, 'globalName')
  const loadedAt = readResourceField(resource, 'loadedAt')
  const name = readResourceField(resource, 'name')
  const type = readResourceField(resource, 'type')
  const version = readResourceField(resource, 'version')
  if (type !== 'material' && type !== 'setter') {
    throw new TypeError('Resource type must be "material" or "setter"')
  }
  assertNonEmptyString(name, 'name')
  assertNonEmptyString(version, 'version')
  assertNonEmptyString(globalName, 'globalName')
  if (typeof loadedAt !== 'number' || !Number.isFinite(loadedAt) || loadedAt < 0) {
    throw new TypeError('Resource loadedAt must be a finite non-negative number')
  }

  // `data` deliberately remains the adapter-owned capability leaf. Only the
  // registry envelope is copied and frozen so callers cannot rewrite the
  // registry's identity or routing metadata through an input/output alias.
  return Object.freeze({ data, globalName, loadedAt, name, type, version })
}

/**
 * 资源注册表
 * 管理已加载的远程资源
 */
export class ResourceRegistry {
  /** 物料资源 */
  readonly #materials = observable.map<string, LoadedResource>(undefined, { deep: false })

  /** 设置器资源 */
  readonly #setters = observable.map<string, LoadedResource>(undefined, { deep: false })

  constructor() {
    installLifecycleTeardownOperation(
      this,
      action(() => this.#disposeInternal()),
    )
  }

  /**
   * 获取所有物料数量
   */
  @computed
  get materialCount(): number {
    return this.#materials.size
  }

  /**
   * 获取所有设置器数量
   */
  @computed
  get setterCount(): number {
    return this.#setters.size
  }

  /**
   * 注册资源
   */
  @action
  register<T>(resource: LoadedResource<T>): void {
    assertLifecycleMutationAllowed(this, 'remote.registry.register')
    const ownedResource = snapshotResource(resource)
    const map = this.#getMap(ownedResource.type)
    map.set(ownedResource.name, ownedResource as LoadedResource)
  }

  /**
   * 获取资源
   */
  get<T>(type: ResourceType, name: string): LoadedResource<T> | undefined {
    const map = this.#getMap(type)
    return map.get(name) as LoadedResource<T> | undefined
  }

  /**
   * 检查资源是否已加载
   */
  has(type: ResourceType, name: string): boolean {
    const map = this.#getMap(type)
    return map.has(name)
  }

  /**
   * 卸载资源
   */
  @action
  unload(type: ResourceType, name: string): boolean {
    assertLifecycleMutationAllowed(this, 'remote.registry.unload')
    const map = this.#getMap(type)
    return map.delete(name)
  }

  /**
   * 获取所有资源
   */
  getAll(type?: ResourceType): readonly LoadedResource[] {
    if (type === 'material') {
      return Object.freeze(Array.from(this.#materials.values()))
    }
    if (type === 'setter') {
      return Object.freeze(Array.from(this.#setters.values()))
    }
    if (type !== undefined) this.#getMap(type)
    return Object.freeze([...this.#materials.values(), ...this.#setters.values()])
  }

  /**
   * 获取所有物料名称
   */
  getMaterialNames(): readonly string[] {
    return Object.freeze(Array.from(this.#materials.keys()))
  }

  /**
   * 获取所有设置器名称
   */
  getSetterNames(): readonly string[] {
    return Object.freeze(Array.from(this.#setters.keys()))
  }

  /**
   * 清除指定类型的所有资源
   */
  @action
  clearType(type: ResourceType): void {
    assertLifecycleMutationAllowed(this, 'remote.registry.clearType')
    const map = this.#getMap(type)
    map.clear()
  }

  /**
   * 清除所有资源
   */
  @action
  clearAll(): void {
    assertLifecycleMutationAllowed(this, 'remote.registry.clearAll')
    this.#materials.clear()
    this.#setters.clear()
  }

  dispose(): void {
    assertPublicLifecycleTeardownAllowed(this, 'remote.registry.dispose')
    this.#disposeInternal()
  }

  #disposeInternal(): void {
    this.#materials.clear()
    this.#setters.clear()
  }

  /**
   * 获取资源映射
   */
  #getMap(type: ResourceType): ObservableMap<string, LoadedResource> {
    if (type === 'material') return this.#materials
    if (type === 'setter') return this.#setters
    throw new TypeError('Resource type must be "material" or "setter"')
  }
}
