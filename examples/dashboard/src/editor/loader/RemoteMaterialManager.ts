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

class RemoteMaterialManager {
  private remoteComponents = new Map<string, any>()

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

      // 3. 缓存
      this.remoteComponents.set(packageName, { loaded, metadata })

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
    if (this.remoteComponents.has(packageName)) {
      // TODO: 从 materials 中移除
      this.remoteComponents.delete(packageName)
      NpmComponentLoader.clearCache(packageName)
      console.log(`[Unloaded] ${packageName}`)
    }
  }
}

export default new RemoteMaterialManager()
