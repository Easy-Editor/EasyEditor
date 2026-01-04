import { action, computed } from 'mobx'
import type { Designer } from '../designer'
import type { Component, ComponentMetadata, Editor } from '../types'
import { type ComponentMeta, isComponentMeta } from './component-meta'
import { MaterialRegistry, MaterialSource, type RegisterOptions } from './registry'

export class Materials {
  /** 物料注册表（新架构核心） */
  private _registry: MaterialRegistry | null = null

  get designer() {
    return this.editor.get<Designer>('designer')!
  }

  /** 获取物料注册表 */
  get registry(): MaterialRegistry {
    if (!this._registry) {
      this._registry = new MaterialRegistry(this.designer)
    }
    return this._registry
  }

  /** 获取版本号（用于缓存失效） */
  get version(): number {
    return this.registry.version
  }

  constructor(readonly editor: Editor) {}

  /**
   * 批量构建组件元数据
   */
  buildComponentMetasMap = (metas: ComponentMetadata[]) => {
    for (const meta of metas) {
      this.createComponentMeta(meta)
    }
  }

  /**
   * 创建或更新组件元数据
   */
  @action
  createComponentMeta(data: ComponentMetadata, options?: RegisterOptions): ComponentMeta | null {
    const key = data.componentName
    if (!key) {
      return null
    }
    return this.registry.register(data, {
      source: MaterialSource.BUILTIN,
      ...options,
    })
  }

  /**
   * 移除组件元数据
   * @deprecated 推荐使用 registry.unload() 并检查使用情况
   */
  @action
  removeComponentMeta(componentName: string): boolean {
    if (!componentName) {
      return false
    }

    const entry = this.registry.get(componentName)
    if (!entry) {
      return false
    }

    // 警告：如果有使用中的实例
    if (entry.usageCount > 0) {
      console.warn(
        `[Materials] Removing "${componentName}" with ${entry.usageCount} instances in use. ` +
          'This may cause rendering errors. Consider using registry.unload() with force option.',
      )
    }

    // 同步卸载（不等待）
    this.registry.unload(componentName, { force: true })
    return true
  }

  /**
   * 获取组件元数据（带懒加载）
   */
  getComponentMeta(componentName: string, generateMetadata?: () => ComponentMetadata | null): ComponentMeta {
    return this.registry.getOrCreate(componentName, generateMetadata)
  }

  /**
   * 获取所有代码片段
   */
  getComponentSnippets() {
    return this.registry.getComponentSnippets()
  }

  /**
   * 获取组件元数据映射（Map）
   */
  getComponentMetasMap(): Map<string, ComponentMeta> {
    const map = new Map<string, ComponentMeta>()
    this.registry.getAll().forEach((entry, key) => {
      map.set(key, entry.meta)
    })
    return map
  }

  /**
   * 组件元数据映射（Record）
   */
  @computed
  get componentMetasMap(): Record<string, ComponentMetadata> {
    return this.registry.componentMetasMap
  }

  /**
   * 组件实现映射
   */
  @computed
  get componentsMap(): { [key: string]: Component } {
    return this.registry.componentsMap as { [key: string]: Component }
  }

  /**
   * 刷新映射，触发依赖更新
   */
  refreshComponentMetasMap() {
    this.registry.refresh()
  }

  /**
   * 增加组件使用计数
   */
  incrementUsage(componentName: string): void {
    this.registry.incrementUsage(componentName)
  }

  /**
   * 减少组件使用计数
   */
  decrementUsage(componentName: string): void {
    this.registry.decrementUsage(componentName)
  }

  /**
   * 检查组件是否可以安全卸载
   */
  canUnload(componentName: string): boolean {
    return this.registry.canUnload(componentName)
  }

  /**
   * 检查是否为 ComponentMeta
   */
  isComponentMeta(obj: unknown) {
    return isComponentMeta(obj)
  }

  /**
   * 销毁 Materials 实例
   */
  dispose() {
    this._registry?.dispose()
    this._registry = null
  }
}
