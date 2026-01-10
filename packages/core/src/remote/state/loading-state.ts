/**
 * Loading State Manager
 * 远程资源加载状态管理器
 */

import { action, computed, observable } from 'mobx'
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

/**
 * 加载状态管理器
 * 使用 MobX 管理远程资源的加载状态
 */
export class LoadingStateManager {
  /** 资源状态映射 */
  @observable.shallow private accessor states = new Map<string, ResourceState>()

  /** 状态变化监听器 */
  private listeners = new Set<StateChangeListener>()

  /**
   * 是否有资源正在加载
   */
  @computed
  get isLoading(): boolean {
    for (const state of this.states.values()) {
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
    return Array.from(this.states.values()).filter(s => s.status === LoadingStatus.LOADING)
  }

  /**
   * 获取所有错误
   */
  @computed
  get errors(): ResourceState[] {
    return Array.from(this.states.values()).filter(s => s.status === LoadingStatus.ERROR)
  }

  /**
   * 获取所有已加载的资源
   */
  @computed
  get loadedResources(): ResourceState[] {
    return Array.from(this.states.values()).filter(s => s.status === LoadingStatus.LOADED)
  }

  /**
   * 获取指定类型的加载状态
   */
  isTypeLoading(type: ResourceType): boolean {
    for (const state of this.states.values()) {
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
    return this.states.get(key)
  }

  /**
   * 更新资源状态
   */
  @action
  updateState(key: string, state: Partial<ResourceState>): void {
    const existing = this.states.get(key)
    if (existing) {
      this.states.set(key, { ...existing, ...state })
    } else {
      this.states.set(key, {
        type: 'material',
        name: key,
        status: LoadingStatus.IDLE,
        ...state,
      } as ResourceState)
    }
    this.notifyListeners()
  }

  /**
   * 开始加载资源
   */
  @action
  startLoading(key: string, type: ResourceType, name: string): void {
    this.states.set(key, {
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
    const state = this.states.get(key)
    if (state) {
      this.states.set(key, { ...state, progress: Math.min(100, Math.max(0, progress)) })
      this.notifyListeners()
    }
  }

  /**
   * 标记加载完成
   */
  @action
  markLoaded(key: string): void {
    const state = this.states.get(key)
    if (state) {
      this.states.set(key, {
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
    const state = this.states.get(key)
    if (state) {
      this.states.set(key, {
        ...state,
        status: LoadingStatus.ERROR,
        error,
      })
      this.notifyListeners()
    }
  }

  /**
   * 清除资源状态
   */
  @action
  clearState(key: string): void {
    this.states.delete(key)
    this.notifyListeners()
  }

  /**
   * 清除所有状态
   */
  @action
  clearAll(): void {
    this.states.clear()
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
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 等待条件满足
   */
  private waitFor(condition: () => boolean, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // 如果条件已满足，直接返回
      if (condition()) {
        resolve()
        return
      }

      const timeoutId = setTimeout(() => {
        unsubscribe()
        reject(new Error(`Wait timeout after ${timeout}ms`))
      }, timeout)

      const unsubscribe = this.subscribe(() => {
        if (condition()) {
          clearTimeout(timeoutId)
          unsubscribe()
          resolve()
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
        listener(this.states)
      } catch (error) {
        console.error('[LoadingStateManager] Listener error:', error)
      }
    }
  }
}

/** 导出单例 */
export const loadingState = new LoadingStateManager()
