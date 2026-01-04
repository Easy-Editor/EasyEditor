/**
 * Remote Material Manager
 * 远程物料管理器（使用 CdnLoader）
 */

import { type Component, materials, MaterialSource } from '@easy-editor/core'
import { action, computed, observable, runInAction } from 'mobx'
import { cdnLoader, type CdnLoadError } from './cdn-loader'

export interface RemoteMaterialConfig {
  /** 包名 */
  package: string
  /** 物料版本 */
  version?: string
  /** UMD 暴露的全局变量名 */
  globalName: string
  /** 是否启用 */
  enabled?: boolean
}

interface CachedMaterial {
  version: string
  globalName: string
  metadata?: {
    componentName: string
    [key: string]: unknown
  }
  component?: Component
}

class RemoteMaterialManagerClass {
  /**
   * 已加载的远程物料
   */
  @observable.shallow private accessor remoteMaterials: Map<string, CachedMaterial> = new Map()

  /**
   * 获取已加载的远程组件映射
   */
  @computed
  get remoteComponentsMap() {
    const componentsMap: Record<string, Component> = {}

    for (const [, data] of this.remoteMaterials.entries()) {
      const { component, metadata } = data
      const componentName = metadata?.componentName

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
  async loadMetaAndRegister(config: RemoteMaterialConfig) {
    const { package: packageName, version = 'latest', globalName, enabled = true } = config

    if (!enabled) {
      return
    }

    try {
      // 1. 从 CDN 加载元数据（不加载组件代码）
      const loadedMeta = await cdnLoader.loadMeta({
        name: packageName,
        version,
        globalName,
      })

      // 2. 注册到编辑器（标记为远程物料）
      materials.createComponentMeta(loadedMeta, {
        source: MaterialSource.REMOTE,
        version,
      })

      // 3. 缓存
      runInAction(() => {
        this.remoteMaterials.set(packageName, {
          metadata: loadedMeta,
          version,
          globalName,
        })
      })

      console.log(`[RemoteMaterial] Meta registered: ${packageName}@${version}`)
    } catch (error) {
      const cdnError = error as CdnLoadError
      console.error(`[RemoteMaterial] Meta failed: ${packageName}@${version}`, cdnError.toUserMessage?.() || error)
      throw error
    }
  }

  /**
   * 添加组件代码（元数据已加载的情况下，只加载组件代码）
   */
  @action
  async loadComponent(config: RemoteMaterialConfig) {
    const { package: packageName, version = 'latest', globalName } = config

    try {
      // 1. 加载组件代码
      const component = await cdnLoader.addComponent({
        name: packageName,
        version,
        globalName,
      })

      // 2. 更新缓存中的组件
      runInAction(() => {
        const cached = this.remoteMaterials.get(packageName)
        if (cached) {
          this.remoteMaterials.set(packageName, {
            ...cached,
            component,
          })
        }
      })

      console.log(`[RemoteMaterial] Component loaded: ${packageName}@${version}`)
    } catch (error) {
      const cdnError = error as CdnLoadError
      console.error(`[RemoteMaterial] Component failed: ${packageName}@${version}`, cdnError.toUserMessage?.() || error)
      throw error
    }
  }

  /**
   * 加载远程物料并注册到编辑器（完整加载：元数据 + 组件代码）
   */
  @action
  async loadMaterialAndRegister(config: RemoteMaterialConfig) {
    const { package: packageName, version = 'latest', globalName, enabled = true } = config

    if (!enabled) {
      return
    }

    try {
      // 1. 从 CDN 加载物料（完整加载）
      const loaded = await cdnLoader.loadMaterial({
        name: packageName,
        version,
        globalName,
      })

      const { meta: metadata, component } = loaded

      // 2. 注册到编辑器（标记为远程物料）
      materials.createComponentMeta(metadata, {
        source: MaterialSource.REMOTE,
        version,
        component,
      })

      // 3. 缓存
      runInAction(() => {
        this.remoteMaterials.set(packageName, {
          version,
          globalName,
          metadata,
          component,
        })
      })

      console.log(`[RemoteMaterial] Registered: ${packageName}@${version}`)
    } catch (error) {
      const cdnError = error as CdnLoadError
      console.error(`[RemoteMaterial] Failed: ${packageName}@${version}`, cdnError.toUserMessage?.() || error)
      throw error
    }
  }

  /**
   * 批量加载远程物料元数据（轻量，用于初次加载）
   */
  @action
  async loadMetaMultiple(configs: RemoteMaterialConfig[]) {
    const results = await Promise.allSettled(configs.map(config => this.loadMetaAndRegister(config)))

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    console.log(`[RemoteMaterial] Batch meta complete: ${succeeded} success, ${failed} failed`)

    return {
      total: configs.length,
      succeeded,
      failed,
      results,
    }
  }

  /**
   * 批量加载远程物料（完整加载：元数据 + 组件代码）
   */
  async loadMaterialMultiple(configs: RemoteMaterialConfig[]) {
    const results = await Promise.allSettled(configs.map(config => this.loadMaterialAndRegister(config)))

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    console.log(`[RemoteMaterial] Batch complete: ${succeeded} success, ${failed} failed`)

    return {
      total: configs.length,
      succeeded,
      failed,
      results,
    }
  }

  /**
   * 获取已加载的远程物料列表
   */
  getLoadedMaterials() {
    return Array.from(this.remoteMaterials.entries()).map(([name, data]) => ({
      name,
      metadata: data.metadata,
    }))
  }

  /**
   * 卸载远程物料（安全卸载，检查使用情况）
   */
  @action
  async unload(packageName: string, options?: { force?: boolean }) {
    const data = this.remoteMaterials.get(packageName)

    if (!data) {
      console.warn(`[RemoteMaterial] Unload failed: ${packageName} not found`)
      return false
    }

    try {
      const { metadata, version, globalName } = data
      const componentName = metadata?.componentName

      if (!componentName) {
        console.warn(`[RemoteMaterial] Unload failed: no componentName for ${packageName}`)
        return false
      }

      // 1. 使用新的 registry 安全卸载机制
      const canUnload = materials.canUnload(componentName)
      if (!canUnload && !options?.force) {
        console.warn(
          `[RemoteMaterial] Cannot unload ${packageName}: component "${componentName}" is in use. ` +
            'Use force: true to unload anyway.',
        )
        return false
      }

      // 2. 从 materials 中移除元数据
      await materials.registry.unload(componentName, { force: options?.force })

      // 3. 从全局变量中清理
      const global = window as Record<string, unknown>
      const easyEditor = global.$EasyEditor as Record<string, Record<string, unknown>> | undefined
      if (easyEditor?.materials?.[globalName]) {
        delete easyEditor.materials[globalName]
      }
      // 清理原始 UMD 全局变量
      if (global[globalName]) {
        delete global[globalName]
      }
      if (global[`${globalName}Meta`]) {
        delete global[`${globalName}Meta`]
      }
      if (global[`${globalName}Component`]) {
        delete global[`${globalName}Component`]
      }

      // 4. 移除 script 标签
      const scriptIds = [
        `cdn-material-${packageName}@${version}-index`,
        `cdn-material-${packageName}@${version}-meta`,
        `cdn-material-${packageName}@${version}-component`,
      ]
      for (const scriptId of scriptIds) {
        const script = document.getElementById(scriptId)
        if (script) {
          script.remove()
        }
      }

      // 5. 清除 CDN 加载器缓存
      cdnLoader.clearCache(packageName, version)

      // 6. 清除本地缓存
      this.remoteMaterials.delete(packageName)

      console.log(`[RemoteMaterial] Unloaded: ${packageName}@${version} (${componentName})`)
      return true
    } catch (error) {
      console.error(`[RemoteMaterial] Unload error: ${packageName}`, error)
      return false
    }
  }

  /**
   * 批量卸载远程物料
   */
  async unloadMultiple(packages: string[], options?: { force?: boolean }) {
    const results = await Promise.all(
      packages.map(async pkg => ({
        package: pkg,
        success: await this.unload(pkg, options),
      })),
    )

    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    console.log(`[RemoteMaterial] Batch unload: ${succeeded} success, ${failed} failed`)

    return {
      total: packages.length,
      succeeded,
      failed,
      results,
    }
  }

  /**
   * 检查物料是否可以安全卸载
   */
  canUnload(packageName: string): boolean {
    const data = this.remoteMaterials.get(packageName)
    if (!data?.metadata?.componentName) {
      return false
    }
    return materials.canUnload(data.metadata.componentName)
  }

  /**
   * 获取物料使用情况
   */
  getUsageInfo(packageName: string) {
    const data = this.remoteMaterials.get(packageName)
    if (!data?.metadata?.componentName) {
      return null
    }
    const entry = materials.registry.get(data.metadata.componentName)
    return entry
      ? {
          usageCount: entry.usageCount,
          status: entry.status,
          canUnload: entry.usageCount === 0,
        }
      : null
  }
}

// 导出单例
export const remoteMaterialManager = new RemoteMaterialManagerClass()

// 导出类，便于测试
export { RemoteMaterialManagerClass }
