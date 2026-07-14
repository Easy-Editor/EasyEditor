import { action, computed } from 'mobx'
import type { Designer } from '../designer'
import { assertLifecycleMutationAllowed, inheritLifecycleMutationGuard } from '../lifecycle/mutation-barrier'
import { lockPrototypeAccessors, lockReadonlyProperties } from '../lifecycle/readonly-properties'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import type { Component, ComponentMetadata, Editor } from '../types'
import { type ComponentMeta, isComponentMeta } from './component-meta'
import { MaterialRegistry, MaterialSource, type RegisterOptions } from './registry'
import { releaseMaterialRegistryUsageDuringTeardown } from './registry/teardown'
import {
  beginMaterialRegistryTransaction,
  commitMaterialRegistryTransaction,
  restoreMaterialRegistryTransaction,
} from './registry/transaction-boundary'
import { installMaterialsTeardown } from './teardown'
import { installMaterialsTransactionOperations } from './transaction-boundary'

export class Materials {
  /** 物料注册表（新架构核心） */
  #registry: MaterialRegistry | null = null

  get designer() {
    return this.editor.get<Designer>('designer')!
  }

  /** 获取物料注册表 */
  get registry(): MaterialRegistry {
    if (!this.#registry) {
      assertLifecycleMutationAllowed(this, 'materials.registry.create')
      this.#registry = new MaterialRegistry(this.designer)
    }
    inheritLifecycleMutationGuard(this, this.#registry)
    inheritEngineTeardownOwnership(this, this.#registry)
    return this.#registry
  }

  /** 获取版本号（用于缓存失效） */
  get version(): number {
    return this.registry.version
  }

  constructor(readonly editor: Editor) {
    lockReadonlyProperties(this, ['editor'])
    lockPrototypeAccessors(this, ['designer', 'registry', 'version'])
    installLifecycleTeardownOperation(this, () => this.#disposeInternal())
    installMaterialsTeardown(this, componentName => {
      if (this.#registry) releaseMaterialRegistryUsageDuringTeardown(this.#registry, componentName)
    })
    installMaterialsTransactionOperations(this, {
      begin: () => beginMaterialRegistryTransaction(this.registry),
      commit: state => commitMaterialRegistryTransaction(this.registry, state),
      restore: state => restoreMaterialRegistryTransaction(this.registry, state),
    })
  }

  /**
   * 批量构建组件元数据
   */
  buildComponentMetasMap = (metas: ComponentMetadata[]) => {
    assertLifecycleMutationAllowed(this, 'materials.buildComponentMetasMap')
    for (const meta of metas) {
      this.createComponentMeta(meta)
    }
  }

  /**
   * 创建或更新组件元数据
   */
  @action
  createComponentMeta(data: ComponentMetadata, options?: RegisterOptions): ComponentMeta | null {
    assertLifecycleMutationAllowed(this, 'materials.createComponentMeta')
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
    assertLifecycleMutationAllowed(this, 'materials.removeComponentMeta')
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
        `[Materials] Removing "${componentName}" with ${entry.usageCount} instances in use. This may cause rendering errors. Consider using registry.unload() with force option.`,
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
    if (generateMetadata) assertLifecycleMutationAllowed(this, 'materials.getComponentMeta.generate')
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
    assertLifecycleMutationAllowed(this, 'materials.refreshComponentMetasMap')
    this.registry.refresh()
  }

  /**
   * 增加组件使用计数
   */
  incrementUsage(componentName: string): void {
    assertLifecycleMutationAllowed(this, 'materials.incrementUsage')
    this.registry.incrementUsage(componentName)
  }

  /**
   * 减少组件使用计数
   */
  decrementUsage(componentName: string): void {
    assertLifecycleMutationAllowed(this, 'materials.decrementUsage')
    this.registry.decrementUsage(componentName)
  }

  /**
   * 检查组件是否可以安全卸载
   */
  canUnload(componentName: string): boolean {
    return this.registry.canUnload(componentName)
  }

  getUsageCount(componentName: string): number {
    return this.registry.getUsageCount(componentName)
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
    assertPublicLifecycleTeardownAllowed(this, 'materials.dispose')
    this.#disposeInternal()
  }

  #disposeInternal(): void {
    if (this.#registry) runInternalLifecycleTeardown(this.#registry)
    this.#registry = null
  }
}
