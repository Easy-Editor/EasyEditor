/**
 * Remote Material Manager
 * 远程物料管理器
 */

import { materials } from '@easy-editor/core'
import NpmComponentLoader from './NpmComponentLoader'

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
  loaded: any
  metadata: any
  version: string
  globalName: string
}

class RemoteMaterialManager {
  private remoteComponents = new Map<string, CachedMaterial>()

  /**
   * 加载远程物料并注册到编辑器
   */
  async loadAndRegister(config: RemoteMaterialConfig) {
    const { package: packageName, version = 'latest', globalName, enabled = true } = config

    if (!enabled) {
      console.log(`[Skip] ${packageName} - disabled`)
      return
    }

    try {
      console.log(`[Loading Remote Material] ${packageName}@${version}`)

      // 1. 从 NPM/CDN 加载组件
      const loaded = await NpmComponentLoader.loadComponent({
        name: packageName,
        version,
        globalName,
      })

      const metadata = loaded.meta

      // 2. 注册到编辑器
      materials.createComponentMeta(metadata)

      // 3. 缓存（保存版本和 globalName 信息）
      this.remoteComponents.set(packageName, {
        loaded,
        metadata,
        version,
        globalName,
      })

      console.log(`[Registered] ${packageName}@${version}`, metadata)
    } catch (error) {
      console.error(`[Failed] ${packageName}@${version}:`, error)
      throw error
    }
  }

  /**
   * 批量加载远程物料
   */
  async loadMultiple(configs: RemoteMaterialConfig[]) {
    console.log(`[Batch Loading] ${configs.length} remote materials`)

    const results = await Promise.allSettled(configs.map(config => this.loadAndRegister(config)))

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    console.log(`[Batch Complete] Success: ${succeeded}, Failed: ${failed}`)

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
    return Array.from(this.remoteComponents.entries()).map(([name, data]) => ({
      name,
      metadata: data.metadata,
    }))
  }

  /**
   * 卸载远程物料
   */
  unload(packageName: string) {
    const data = this.remoteComponents.get(packageName)

    if (!data) {
      console.warn(`[Unload Failed] ${packageName} not found`)
      return false
    }

    try {
      const { metadata, version, globalName } = data
      const componentName = metadata.componentName

      // 1. 从 materials 中移除元数据
      materials.removeComponentMeta(componentName)

      // 2. 从全局变量中移除
      const global = window as any
      if (global.$EasyEditor?.materials?.[globalName]) {
        delete global.$EasyEditor.materials[globalName]
      }
      // 也尝试移除原始的 UMD 全局变量
      if (global[globalName]) {
        delete global[globalName]
      }

      // 3. 移除 script 标签（使用实际版本号）
      const scriptId = `npm-component-${packageName}@${version}`
      const script = document.getElementById(scriptId)
      if (script) {
        script.remove()
        console.log(`[Script Removed] ${scriptId}`)
      }

      // 4. 清除本地缓存
      this.remoteComponents.delete(packageName)
      NpmComponentLoader.clearCache(packageName, version)

      console.log(`[Unloaded] ${packageName}@${version} (${componentName})`)
      return true
    } catch (error) {
      console.error(`[Unload Error] ${packageName}:`, error)
      return false
    }
  }

  /**
   * 批量卸载远程物料
   */
  unloadMultiple(packages: string[]) {
    const results = packages.map(pkg => ({
      package: pkg,
      success: this.unload(pkg),
    }))

    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    console.log(`[Batch Unload] Success: ${succeeded}, Failed: ${failed}`)

    return {
      total: packages.length,
      succeeded,
      failed,
      results,
    }
  }
}

export default new RemoteMaterialManager()
