/**
 * Loading State Manager
 * 远程资源加载状态管理器
 */

import { action, computed, observable } from 'mobx'
import { assertLifecycleMutationAllowed } from '../../lifecycle/mutation-barrier'
import { lockReadonlyProperties } from '../../lifecycle/readonly-properties'
import {
  assertPublicLifecycleTeardownAllowed,
  installLifecycleTeardownOperation,
} from '../../lifecycle/teardown-boundary'
import type { ResourceType } from '../core/errors'
import { LoadingStatus } from '../core/types'

// 重新导出 LoadingStatus 以保持向后兼容
export { LoadingStatus }

/** 资源状态条目 */
export interface ResourceState {
  /** 资源类型 */
  type: ResourceType
  /** 资源名称（包名） */
  name: string
  /** 加载状态 */
  status: LoadingStatus
  /** 进度百分比 (0-100) */
  progress?: number
  /** 错误信息 */
  error?: Error
  /** 加载完成时间 */
  loadedAt?: number
}

/** 状态变化监听器 */
export type StateChangeListener = (states: Map<string, ResourceState>) => void

const cloneErrorCause = (cause: unknown, visited = new WeakMap<object, unknown>()): unknown => {
  if (!cause || typeof cause !== 'object') return cause
  const existing = visited.get(cause)
  if (existing !== undefined) return existing
  if (cause instanceof Error) return cloneResourceError(cause, visited)
  if (Array.isArray(cause)) {
    const clone: unknown[] = []
    visited.set(cause, clone)
    cause.forEach(item => clone.push(cloneErrorCause(item, visited)))
    return Object.freeze(clone)
  }
  const prototype = Object.getPrototypeOf(cause)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const clone = Object.create(prototype) as Record<PropertyKey, unknown>
  visited.set(cause, clone)
  for (const key of Reflect.ownKeys(cause)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(cause, key)
    if (descriptor && 'value' in descriptor) clone[key] = cloneErrorCause(descriptor.value, visited)
  }
  return Object.freeze(clone)
}

const readErrorDataProperty = (error: Error, property: PropertyKey): unknown => {
  let current: object | null = error
  while (current) {
    const descriptor = Reflect.getOwnPropertyDescriptor(current, property)
    if (descriptor) return 'value' in descriptor ? descriptor.value : undefined
    current = Reflect.getPrototypeOf(current)
  }
  return undefined
}

const cloneResourceError = (error: Error, visited = new WeakMap<object, unknown>()): Error => {
  const existing = visited.get(error)
  if (existing instanceof Error) return existing
  const message = readErrorDataProperty(error, 'message')
  const clone = new Error(typeof message === 'string' ? message : 'Unknown loading error')
  visited.set(error, clone)
  const causeDescriptor = Reflect.getOwnPropertyDescriptor(error, 'cause')
  if (causeDescriptor && 'value' in causeDescriptor) {
    Object.defineProperty(clone, 'cause', {
      configurable: true,
      value: cloneErrorCause(causeDescriptor.value, visited),
      writable: true,
    })
  }
  const name = readErrorDataProperty(error, 'name')
  const stack = readErrorDataProperty(error, 'stack')
  clone.name = typeof name === 'string' ? name : 'Error'
  if (typeof stack === 'string') clone.stack = stack
  return Object.freeze(clone)
}

const normalizeResourceState = (state: ResourceState): ResourceState => ({
  ...state,
  ...(state.error ? { error: cloneResourceError(state.error) } : null),
})

const snapshotResourceState = (state: ResourceState): ResourceState => Object.freeze(normalizeResourceState(state))

/**
 * 加载状态管理器
 * 使用 MobX 管理远程资源的加载状态
 */
export class LoadingStateManager {
  /** 资源状态映射 */
  @observable.shallow accessor #states = new Map<string, ResourceState>()

  /** 状态变化监听器 */
  private listeners = new Set<StateChangeListener>()

  /** 等待任务的取消器，确保销毁时不会遗留定时器 */
  private waitCancels = new Set<() => void>()

  constructor() {
    lockReadonlyProperties(this, ['listeners', 'waitCancels'])
    installLifecycleTeardownOperation(
      this,
      action(() => this.#disposeInternal()),
    )
  }

  /**
   * 是否有资源正在加载
   */
  @computed
  get isLoading(): boolean {
    for (const state of this.#states.values()) {
      if (state.status === LoadingStatus.LOADING) {
        return true
      }
    }
    return false
  }

  /**
   * 获取所有正在加载的资源
   */
  @computed
  get loadingResources(): ResourceState[] {
    return Array.from(this.#states.values(), snapshotResourceState).filter(s => s.status === LoadingStatus.LOADING)
  }

  /**
   * 获取所有错误
   */
  @computed
  get errors(): ResourceState[] {
    return Array.from(this.#states.values(), snapshotResourceState).filter(s => s.status === LoadingStatus.ERROR)
  }

  /**
   * 获取所有已加载的资源
   */
  @computed
  get loadedResources(): ResourceState[] {
    return Array.from(this.#states.values(), snapshotResourceState).filter(s => s.status === LoadingStatus.LOADED)
  }

  /**
   * 获取指定类型的加载状态
   */
  isTypeLoading(type: ResourceType): boolean {
    for (const state of this.#states.values()) {
      if (state.type === type && state.status === LoadingStatus.LOADING) {
        return true
      }
    }
    return false
  }

  /**
   * 获取资源状态
   */
  getState(key: string): ResourceState | undefined {
    const state = this.#states.get(key)
    return state ? snapshotResourceState(state) : undefined
  }

  /**
   * 更新资源状态
   */
  @action
  updateState(key: string, state: Partial<ResourceState>): void {
    assertLifecycleMutationAllowed(this, 'remote.loadingState.updateState')
    const existing = this.#states.get(key)
    if (existing) {
      this.#states.set(key, normalizeResourceState({ ...existing, ...state }))
    } else {
      this.#states.set(
        key,
        normalizeResourceState({
          type: 'material',
          name: key,
          status: LoadingStatus.IDLE,
          ...state,
        } as ResourceState),
      )
    }
    this.notifyListeners()
  }

  /**
   * 开始加载资源
   */
  @action
  startLoading(key: string, type: ResourceType, name: string): void {
    assertLifecycleMutationAllowed(this, 'remote.loadingState.startLoading')
    this.#states.set(key, {
      type,
      name,
      status: LoadingStatus.LOADING,
      progress: 0,
    })
    this.notifyListeners()
  }

  /**
   * 更新加载进度
   */
  @action
  updateProgress(key: string, progress: number): void {
    assertLifecycleMutationAllowed(this, 'remote.loadingState.updateProgress')
    const state = this.#states.get(key)
    if (state) {
      this.#states.set(key, { ...state, progress: Math.min(100, Math.max(0, progress)) })
      this.notifyListeners()
    }
  }

  /**
   * 标记加载完成
   */
  @action
  markLoaded(key: string): void {
    assertLifecycleMutationAllowed(this, 'remote.loadingState.markLoaded')
    const state = this.#states.get(key)
    if (state) {
      this.#states.set(key, {
        ...state,
        status: LoadingStatus.LOADED,
        progress: 100,
        loadedAt: Date.now(),
      })
      this.notifyListeners()
    }
  }

  /**
   * 标记加载错误
   */
  @action
  markError(key: string, error: Error): void {
    assertLifecycleMutationAllowed(this, 'remote.loadingState.markError')
    const state = this.#states.get(key)
    if (state) {
      this.#states.set(key, {
        ...state,
        status: LoadingStatus.ERROR,
        error: cloneResourceError(error),
      })
      this.notifyListeners()
    }
  }

  /**
   * 清除资源状态
   */
  @action
  clearState(key: string): void {
    assertLifecycleMutationAllowed(this, 'remote.loadingState.clearState')
    this.#states.delete(key)
    this.notifyListeners()
  }

  /**
   * 清除所有状态
   */
  @action
  clearAll(): void {
    assertLifecycleMutationAllowed(this, 'remote.loadingState.clearAll')
    this.#states.clear()
    this.notifyListeners()
  }

  /**
   * 等待所有资源加载完成
   */
  async waitForAll(timeout = 30000): Promise<void> {
    return this.waitFor(() => !this.isLoading, timeout)
  }

  /**
   * 等待指定类型资源加载完成
   */
  async waitForType(type: ResourceType, timeout = 30000): Promise<void> {
    return this.waitFor(() => !this.isTypeLoading(type), timeout)
  }

  /**
   * 订阅状态变化
   */
  subscribe(listener: StateChangeListener): () => void {
    assertLifecycleMutationAllowed(this, 'remote.loadingState.subscribe')
    const registration: StateChangeListener = states => listener(states)
    this.listeners.add(registration)
    return () => {
      this.listeners.delete(registration)
    }
  }

  /**
   * 等待条件满足
   */
  private waitFor(condition: () => boolean, timeout: number): Promise<void> {
    assertLifecycleMutationAllowed(this, 'remote.loadingState.wait')
    return new Promise((resolve, reject) => {
      // 如果条件已满足，直接返回
      if (condition()) {
        resolve()
        return
      }

      let settled = false
      let unsubscribe = () => {}
      const finish = (error?: Error) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeoutId)
        unsubscribe()
        this.waitCancels.delete(cancel)
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }
      const cancel = () => finish(new Error('Loading state manager disposed'))
      const timeoutId = setTimeout(() => finish(new Error(`Wait timeout after ${timeout}ms`)), timeout)
      this.waitCancels.add(cancel)

      unsubscribe = this.subscribe(() => {
        if (condition()) {
          finish()
        }
      })
    })
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(new Map(Array.from(this.#states, ([key, state]) => [key, snapshotResourceState(state)])))
      } catch (error) {
        console.error('[LoadingStateManager] Listener error:', error)
      }
    }
  }

  @action
  dispose(): void {
    assertPublicLifecycleTeardownAllowed(this, 'remote.loadingState.dispose')
    this.#disposeInternal()
  }

  #disposeInternal(): void {
    for (const cancel of [...this.waitCancels]) {
      cancel()
    }
    this.waitCancels.clear()
    this.listeners.clear()
    this.#states.clear()
  }
}
