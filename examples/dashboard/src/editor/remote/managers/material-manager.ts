/**
 * Material Manager
 * 物料管理器
 */

import { type Component, type ComponentMetadata, MaterialSource, materials } from '@easy-editor/core'
import { action, computed, observable, runInAction } from 'mobx'
import { type LoadedMaterial, materialLoader } from '../loaders'

/** 远程物料配置 */
export interface RemoteMaterialConfig {
  /** 包名 */
  package: string
  /** 版本 */
  version?: string
  /** UMD 全局变量名 */
  globalName: string
  /** 是否启用 */
  enabled?: boolean
}

/** 缓存的物料包信息 */
interface CachedMaterialPackage {
  version: string
  globalName: string
  meta: ComponentMetadata
  component?: Component
  hasComponent: boolean
}

/**
 * 远程物料管理器
 */
class MaterialManagerClass {
  /** 已加载的远程物料包 */
  @observable.shallow private accessor remoteMaterialPackages = new Map<string, CachedMaterialPackage>()

  /**
   * 获取已加载的远程物料数量
   */
  @computed
  get loadedCount(): number {
    return this.remoteMaterialPackages.size
  }

  /**
   * 获取已加载的远程组件映射（componentName -> Component）
   */
  @computed
  get remoteComponentsMap(): Record<string, Component> {
    const componentsMap: Record<string, Component> = {}

    for (const data of this.remoteMaterialPackages.values()) {
      const { component, meta } = data
      const componentName = meta?.componentName

      if (componentName && component) {
        componentsMap[componentName] = component
      }
    }

    return componentsMap
  }

  /**
   * 加载远程物料元数据并注册到编辑器
   */
  @action
  async loadMeta(config: RemoteMaterialConfig): Promise<void> {
    const { package: packageName, version = 'latest', globalName, enabled = true } = config

    if (!enabled) {
      return
    }

    try {
      // 1. 从 CDN 加载元数据
      const meta = await materialLoader.loadMeta({
        package: packageName,
        version,
        globalName,
      })

      // 2. 注册到物料系统
      materials.buildComponentMetasMap([meta])

      // 3. 缓存
      runInAction(() => {
        this.remoteMaterialPackages.set(packageName, {
          version,
          globalName,
          meta,
          hasComponent: false,
        })
      })

      console.log(`[MaterialManager] Meta registered: ${packageName}@${version}`)
    } catch (error) {
      console.error(`[MaterialManager] Failed to load meta: ${packageName}@${version}`, error)
      throw error
    }
  }

  /**
   * 批量加载远程物料元数据
   */
  @action
  async loadMetaMultiple(configs: RemoteMaterialConfig[]): Promise<{
    total: number
    succeeded: number
    failed: number
  }> {
    const results = await Promise.allSettled(configs.map(config => this.loadMeta(config)))

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    console.log(`[MaterialManager] Batch meta load: ${succeeded} success, ${failed} failed`)

    return {
      total: configs.length,
      succeeded,
      failed,
    }
  }

  /**
   * 加载完整物料（元数据 + 组件）
   */
  @action
  async loadFull(config: RemoteMaterialConfig): Promise<LoadedMaterial> {
    const { package: packageName, version = 'latest', globalName, enabled = true } = config

    if (!enabled) {
      throw new Error(`Material ${packageName} is disabled`)
    }

    try {
      // 1. 从 CDN 加载完整物料
      const loaded = await materialLoader.loadMaterial({
        package: packageName,
        version,
        globalName,
      })

      // 2. 注册到物料系统
      materials.buildComponentMetasMap([loaded.meta])

      // 3. 缓存（包含 component）
      runInAction(() => {
        this.remoteMaterialPackages.set(packageName, {
          version,
          globalName,
          meta: loaded.meta,
          component: loaded.component,
          hasComponent: true,
        })
      })

      console.log(`[MaterialManager] Full material registered: ${packageName}@${version}`)
      return loaded
    } catch (error) {
      console.error(`[MaterialManager] Failed to load full material: ${packageName}@${version}`, error)
      throw error
    }
  }

  /**
   * 为已加载元数据的物料添加组件代码
   */
  @action
  async addComponent(packageName: string): Promise<void> {
    const cached = this.remoteMaterialPackages.get(packageName)
    if (!cached) {
      throw new Error(`Material ${packageName} not found in cache`)
    }

    if (cached.hasComponent) {
      return // 已加载组件
    }

    try {
      const component = await materialLoader.addComponent({
        package: packageName,
        version: cached.version,
        globalName: cached.globalName,
      })

      // 将组件注册到 materials.registry，统一入口
      materials.createComponentMeta(cached.meta, {
        component,
        source: MaterialSource.REMOTE,
      })

      runInAction(() => {
        this.remoteMaterialPackages.set(packageName, {
          ...cached,
          component,
          hasComponent: true,
        })
      })

      console.log(`[MaterialManager] Component registered to materials: ${packageName}`)
    } catch (error) {
      console.error(`[MaterialManager] Failed to add component: ${packageName}`, error)
      throw error
    }
  }

  /**
   * 批量加载完整物料（元数据 + 组件）
   */
  @action
  async loadMaterialMultiple(configs: RemoteMaterialConfig[]): Promise<{
    total: number
    succeeded: number
    failed: number
    results: PromiseSettledResult<LoadedMaterial>[]
  }> {
    const results = await Promise.allSettled(configs.map(config => this.loadFull(config)))

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    console.log(`[MaterialManager] Batch full load: ${succeeded} success, ${failed} failed`)

    return {
      total: configs.length,
      succeeded,
      failed,
      results,
    }
  }

  /**
   * 获取已加载的远程物料包列表
   */
  getLoadedPackages(): Array<{
    name: string
    version: string
    componentName: string
    hasComponent: boolean
  }> {
    return Array.from(this.remoteMaterialPackages.entries()).map(([name, data]) => ({
      name,
      version: data.version,
      componentName: data.meta.componentName,
      hasComponent: data.hasComponent,
    }))
  }

  /**
   * 获取已加载的远程物料列表（兼容旧 API）
   */
  getLoadedMaterials(): Array<{
    name: string
    version: string
    metadata: ComponentMetadata
  }> {
    return Array.from(this.remoteMaterialPackages.entries()).map(([name, data]) => ({
      name,
      version: data.version,
      metadata: data.meta,
    }))
  }

  /**
   * 检查物料是否已加载
   */
  isLoaded(packageName: string): boolean {
    return this.remoteMaterialPackages.has(packageName)
  }

  /**
   * 检查物料组件是否已加载
   */
  hasComponent(packageName: string): boolean {
    return this.remoteMaterialPackages.get(packageName)?.hasComponent ?? false
  }

  /**
   * 获取物料信息
   */
  getPackageInfo(packageName: string): CachedMaterialPackage | undefined {
    return this.remoteMaterialPackages.get(packageName)
  }
}

/** 导出单例 */
export const materialManager = new MaterialManagerClass()

/** 导出类（便于测试） */
export { MaterialManagerClass }
