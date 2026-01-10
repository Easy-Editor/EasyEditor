/**
 * Setter Manager
 * 设置器管理器
 */

import { setters } from '@easy-editor/core'
import { action, computed, observable, runInAction } from 'mobx'
import { type LoadedSetters, setterLoader } from '../loaders'

/** 远程设置器配置 */
export interface RemoteSetterConfig {
  /** 包名 */
  package: string
  /** 版本 */
  version?: string
  /** UMD 全局变量名 */
  globalName: string
  /** 是否启用 */
  enabled?: boolean
}

/** 缓存的设置器包信息 */
interface CachedSetterPackage {
  version: string
  globalName: string
  setterMap: Record<string, unknown>
  customFieldItem?: unknown
}

/**
 * 远程设置器管理器
 */
class SetterManagerClass {
  /** 已加载的远程设置器包 */
  @observable.shallow private accessor remoteSetterPackages = new Map<string, CachedSetterPackage>()

  /**
   * 获取已加载的远程设置器数量
   */
  @computed
  get loadedCount(): number {
    return this.remoteSetterPackages.size
  }

  /**
   * 获取已加载的远程设置器映射
   */
  @computed
  get remoteSettersMap(): Record<string, unknown> {
    const allSetters: Record<string, unknown> = {}

    for (const data of this.remoteSetterPackages.values()) {
      if (data.setterMap) {
        Object.assign(allSetters, data.setterMap)
      }
    }

    return allSetters
  }

  /**
   * 加载远程设置器包并注册到编辑器
   */
  @action
  async load(config: RemoteSetterConfig): Promise<void> {
    const { package: packageName, version = 'latest', globalName, enabled = true } = config

    if (!enabled) {
      return
    }

    try {
      // 1. 从 CDN 加载设置器包
      const loaded = await setterLoader.loadSetters({
        package: packageName,
        version,
        globalName,
      })

      // 2. 注册到 setters 系统
      if (loaded.setterMap) {
        setters.registerSetter(loaded.setterMap as Record<string, unknown>)
        console.log(`[SetterManager] Registered setters:`, Object.keys(loaded.setterMap))
      }

      // 3. 缓存
      runInAction(() => {
        this.remoteSetterPackages.set(packageName, {
          version,
          globalName,
          setterMap: loaded.setterMap || {},
          customFieldItem: loaded.customFieldItem,
        })
      })

      console.log(`[SetterManager] Registered: ${packageName}@${version}`)
    } catch (error) {
      console.error(`[SetterManager] Failed: ${packageName}@${version}`, error)
      throw error
    }
  }

  /**
   * 批量加载远程设置器包
   */
  @action
  async loadMultiple(configs: RemoteSetterConfig[]): Promise<{
    total: number
    succeeded: number
    failed: number
  }> {
    const results = await Promise.allSettled(configs.map(config => this.load(config)))

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    console.log(`[SetterManager] Batch complete: ${succeeded} success, ${failed} failed`)

    return {
      total: configs.length,
      succeeded,
      failed,
    }
  }

  /**
   * 获取已加载的远程设置器包列表
   */
  getLoadedPackages(): Array<{
    name: string
    version: string
    setterCount: number
    setterNames: string[]
  }> {
    return Array.from(this.remoteSetterPackages.entries()).map(([name, data]) => ({
      name,
      version: data.version,
      setterCount: Object.keys(data.setterMap).length,
      setterNames: Object.keys(data.setterMap),
    }))
  }

  /**
   * 获取特定包的 customFieldItem
   */
  getCustomFieldItem(packageName: string): unknown {
    return this.remoteSetterPackages.get(packageName)?.customFieldItem
  }

  /**
   * 检查设置器包是否已加载
   */
  isLoaded(packageName: string): boolean {
    return this.remoteSetterPackages.has(packageName)
  }

  /**
   * 获取设置器包信息
   */
  getPackageInfo(packageName: string): CachedSetterPackage | undefined {
    return this.remoteSetterPackages.get(packageName)
  }
}

/** 导出单例 */
export const setterManager = new SetterManagerClass()

/** 导出类（便于测试） */
export { SetterManagerClass }
