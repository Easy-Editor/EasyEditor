/**
 * Material Registry Implementation
 * 物料注册表实现
 */

import { action, computed, observable } from 'mobx'
import type { Designer } from '../../designer'
import type { ComponentMetadata } from '../../types'
import { ComponentMeta } from '../component-meta'
import {
  type IMaterialRegistry,
  type MaterialEntry,
  MaterialSource,
  MaterialStatus,
  type RegisterOptions,
  type RegistryEvent,
  RegistryEventType,
  type RegistryEventListener,
  type UnloadOptions,
} from './types'

/** 组件名称验证正则 */
const COMPONENT_NAME_REGEX = /^[A-Za-z_$][A-Za-z0-9_$.]*$/

/** 最大组件名称长度 */
const MAX_COMPONENT_NAME_LENGTH = 255

/**
 * 物料注册表
 * 统一管理所有物料的注册、卸载、状态追踪
 */
export class MaterialRegistry implements IMaterialRegistry {
  /** 物料条目映射 */
  @observable.shallow private accessor entries = new Map<string, MaterialEntry>()

  /** 待激活物料（懒加载时创建的占位） */
  @observable.shallow private accessor pendingEntries = new Map<string, MaterialEntry>()

  /** 版本号（用于触发依赖更新） */
  @observable private accessor _version = 0

  /** 事件监听器 */
  private listeners = new Set<RegistryEventListener>()

  /** 是否已销毁 */
  private disposed = false

  constructor(private readonly designer: Designer) {}

  /** 获取版本号 */
  get version(): number {
    return this._version
  }

  /**
   * 验证组件名称
   */
  private validateComponentName(name: string): boolean {
    if (!name || typeof name !== 'string') {
      return false
    }
    if (name.length > MAX_COMPONENT_NAME_LENGTH) {
      return false
    }
    return COMPONENT_NAME_REGEX.test(name)
  }

  /**
   * 发送事件
   */
  private emit(event: Omit<RegistryEvent, 'timestamp'>): void {
    const fullEvent: RegistryEvent = {
      ...event,
      timestamp: Date.now(),
    }
    this.listeners.forEach(listener => {
      try {
        listener(fullEvent)
      } catch (error) {
        console.error('[MaterialRegistry] Event listener error:', error)
      }
    })
  }

  /**
   * 创建物料条目
   */
  private createEntry(componentName: string, meta: ComponentMeta, options: RegisterOptions = {}): MaterialEntry {
    return {
      componentName,
      status: options.component ? MaterialStatus.ACTIVE : MaterialStatus.REGISTERED,
      source: options.source ?? MaterialSource.BUILTIN,
      meta,
      component: options.component,
      version: options.version,
      loadedAt: Date.now(),
      lastAccessedAt: Date.now(),
      usageCount: 0,
    }
  }

  @action
  register(metadata: ComponentMetadata, options: RegisterOptions = {}): ComponentMeta {
    const componentName = metadata.componentName

    if (!this.validateComponentName(componentName)) {
      console.warn(`[MaterialRegistry] Invalid component name: "${componentName}"`)
      throw new Error(`Invalid component name: "${componentName}"`)
    }

    let entry = this.entries.get(componentName)
    let isNew = false

    if (entry) {
      // 已存在：更新元数据
      if (!options.override) {
        entry.meta.setMetadata(metadata)
        entry.lastAccessedAt = Date.now()
        if (options.component) {
          entry.component = options.component
          entry.status = MaterialStatus.ACTIVE
        }
      } else {
        // 覆盖模式：创建新的 ComponentMeta
        entry.meta = new ComponentMeta(this.designer, metadata)
        entry.component = options.component
        entry.status = options.component ? MaterialStatus.ACTIVE : MaterialStatus.REGISTERED
        entry.lastAccessedAt = Date.now()
      }
    } else {
      // 检查是否在 pending 中
      const pendingEntry = this.pendingEntries.get(componentName)
      if (pendingEntry) {
        // 激活 pending 条目
        pendingEntry.meta.setMetadata(metadata)
        pendingEntry.status = options.component ? MaterialStatus.ACTIVE : MaterialStatus.REGISTERED
        pendingEntry.component = options.component
        pendingEntry.source = options.source ?? MaterialSource.BUILTIN
        pendingEntry.version = options.version
        pendingEntry.lastAccessedAt = Date.now()

        entry = pendingEntry
        this.pendingEntries.delete(componentName)
        isNew = true
      } else {
        // 全新创建
        const meta = new ComponentMeta(this.designer, metadata)
        entry = this.createEntry(componentName, meta, options)
        isNew = true
      }
      this.entries.set(componentName, entry)
    }

    // 发送事件
    this.emit({
      type: isNew ? RegistryEventType.REGISTERED : RegistryEventType.UPDATED,
      componentName,
      entry,
    })

    return entry.meta
  }

  @action
  async unload(componentName: string, options: UnloadOptions = {}): Promise<boolean> {
    const entry = this.entries.get(componentName)

    if (!entry) {
      console.warn(`[MaterialRegistry] Component not found: "${componentName}"`)
      return false
    }

    // 检查使用情况
    if (!options.force && entry.usageCount > 0) {
      console.warn(`[MaterialRegistry] Cannot unload "${componentName}": ${entry.usageCount} instances in use`)
      return false
    }

    // 更新状态为卸载中
    entry.status = MaterialStatus.UNLOADING
    this.emit({
      type: RegistryEventType.STATUS_CHANGED,
      componentName,
      entry,
      previousStatus: MaterialStatus.ACTIVE,
    })

    // 清理 ComponentMeta
    if (entry.meta.dispose) {
      entry.meta.dispose()
    }

    // 从映射中移除
    this.entries.delete(componentName)

    // 发送卸载事件
    this.emit({
      type: RegistryEventType.UNLOADED,
      componentName,
    })

    // 刷新版本
    this.refresh()

    return true
  }

  get(componentName: string): MaterialEntry | undefined {
    const entry = this.entries.get(componentName)
    if (entry) {
      entry.lastAccessedAt = Date.now()
    }
    return entry
  }

  @action
  getOrCreate(componentName: string, generateMetadata?: () => ComponentMetadata | null): ComponentMeta {
    // 优先从活跃条目获取
    const entry = this.entries.get(componentName)
    if (entry) {
      entry.lastAccessedAt = Date.now()
      return entry.meta
    }

    // 检查 pending 条目
    const pendingEntry = this.pendingEntries.get(componentName)
    if (pendingEntry) {
      pendingEntry.lastAccessedAt = Date.now()
      return pendingEntry.meta
    }

    // 创建 pending 条目（懒加载占位）
    const metadata: ComponentMetadata = {
      componentName,
      ...(generateMetadata ? generateMetadata() : null),
    }
    const meta = new ComponentMeta(this.designer, metadata)
    const newEntry = this.createEntry(componentName, meta, {
      source: MaterialSource.BUILTIN,
    })
    newEntry.status = MaterialStatus.LOADING

    this.pendingEntries.set(componentName, newEntry)

    return meta
  }

  has(componentName: string): boolean {
    return this.entries.has(componentName)
  }

  @action
  incrementUsage(componentName: string): void {
    const entry = this.entries.get(componentName) || this.pendingEntries.get(componentName)
    if (entry) {
      entry.usageCount++
      this.emit({
        type: RegistryEventType.USAGE_CHANGED,
        componentName,
        entry,
      })
    }
  }

  @action
  decrementUsage(componentName: string): void {
    const entry = this.entries.get(componentName) || this.pendingEntries.get(componentName)
    if (entry && entry.usageCount > 0) {
      entry.usageCount--
      this.emit({
        type: RegistryEventType.USAGE_CHANGED,
        componentName,
        entry,
      })
    }
  }

  canUnload(componentName: string): boolean {
    const entry = this.entries.get(componentName)
    if (!entry) {
      return false
    }
    return entry.usageCount === 0
  }

  subscribe(listener: RegistryEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getAll(): Map<string, MaterialEntry> {
    return new Map(this.entries)
  }

  getBySource(source: MaterialSource): MaterialEntry[] {
    const result: MaterialEntry[] = []
    this.entries.forEach(entry => {
      if (entry.source === source) {
        result.push(entry)
      }
    })
    return result
  }

  @action
  refresh(): void {
    this._version++
    // 触发 MobX 响应式更新
    this.entries = new Map(this.entries)
  }

  /** 获取所有组件元数据映射 */
  @computed
  get componentMetasMap(): Record<string, ComponentMetadata> {
    const maps: Record<string, ComponentMetadata> = {}
    this.entries.forEach((entry, key) => {
      maps[key] = entry.meta.getMetadata()
    })
    return maps
  }

  /** 获取所有组件映射 */
  @computed
  get componentsMap(): Record<string, unknown> {
    const maps: Record<string, unknown> = {}
    this.entries.forEach((entry, key) => {
      const metadata = entry.meta.getMetadata()
      if (metadata.devMode === 'lowCode') {
        maps[key] = metadata.schema
      } else {
        const view = entry.meta.advanced?.view ?? entry.component
        if (view) {
          maps[key] = view
        }
      }
    })
    return maps
  }

  /** 获取所有代码片段 */
  getComponentSnippets() {
    const snippets: unknown[] = []
    this.entries.forEach(entry => {
      const metaSnippets = entry.meta.snippets
      if (metaSnippets) {
        snippets.push(...metaSnippets)
      }
    })
    return snippets
  }

  @action
  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true

    // 清理所有 ComponentMeta
    this.entries.forEach(entry => {
      if (entry.meta.dispose) {
        entry.meta.dispose()
      }
    })
    this.pendingEntries.forEach(entry => {
      if (entry.meta.dispose) {
        entry.meta.dispose()
      }
    })

    // 清空映射
    this.entries.clear()
    this.pendingEntries.clear()
    this.listeners.clear()
  }
}
