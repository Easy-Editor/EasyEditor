/**
 * Remote Material Manager
 * 远程物料管理器
 */

import { Component, materials } from '@easy-editor/core'
import { action, computed, observable, runInAction } from 'mobx'
import NpmMaterialLoader from './NpmMaterialLoader'

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
  metadata?: any
  component?: Component
}

class RemoteMaterialManager {
  /**
   * 已加载的远程物料
   */
  @observable.shallow private accessor remoteMaterials: Map<string, CachedMaterial> = new Map()

  /**
   * 获取已加载的远程组件映射
   */
  @computed
  get remoteComponentsMap() {
    const componentsMap: Record<string, any> = {}

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
      // 1. 从 NPM/CDN 加载元数据（不加载组件代码）
      const loadedMeta = await NpmMaterialLoader.loadMeta({
        name: packageName,
        version,
        globalName,
      })

      const metadata = loadedMeta

      // 2. 注册到编辑器（只注册元数据，不注册组件）
      materials.createComponentMeta(metadata)

      // 3. 缓存（保存版本和 globalName 信息，但不包含 component）
      // 使用 runInAction 包装异步操作后的状态修改
      runInAction(() => {
        this.remoteMaterials.set(packageName, {
          metadata,
          version,
          globalName,
        })
      })

      console.log(`[Meta Registered] ${packageName}@${version}`, metadata)
    } catch (error) {
      console.error(`[Meta Failed] ${packageName}@${version}:`, error)
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
      const component = await NpmMaterialLoader.addComponent({
        name: packageName,
        version,
        globalName,
      })

      // 2. 更新缓存中的组件（重新设置以触发 MobX 响应式更新）
      // 使用 runInAction 包装异步操作后的状态修改
      runInAction(() => {
        const cached = this.remoteMaterials.get(packageName)
        if (cached) {
          this.remoteMaterials.set(packageName, {
            ...cached,
            component,
          })
        }
      })

      // 3. 更新 ComponentMeta 的 advanced.view，使 componentsMap 能访问到组件
      // const componentMeta = materials.getComponentMeta(
      //   cached.metadata.componentName
      // );
      // if (componentMeta) {
      //   const currentMeta = componentMeta.getMetadata();
      //   componentMeta.setMetadata({
      //     ...currentMeta,
      //     configure: {
      //       ...currentMeta.configure,
      //       advanced: {
      //         ...currentMeta.configure?.advanced,
      //         view: component, // 设置组件到 advanced.view
      //       },
      //     },
      //   });

      //   // 触发 componentsMap 更新
      //   materials.refreshComponentMetasMap();
      // }

      console.log(`[Component Loaded] ${packageName}@${version}`)
    } catch (error) {
      console.error(`[Component Failed] ${packageName}@${version}:`, error)
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
      // 1. 从 NPM/CDN 加载物料（完整加载）
      const loaded = await NpmMaterialLoader.loadMaterial({
        name: packageName,
        version,
        globalName,
      })

      const { meta: metadata, component } = loaded

      // 2. 注册到编辑器
      // const componentMeta = materials.createComponentMeta(metadata);

      // 3. 设置组件到 advanced.view（使 componentsMap 能访问到组件）
      // if (componentMeta && loaded.component) {
      //   const currentMeta = componentMeta.getMetadata();
      //   componentMeta.setMetadata({
      //     ...currentMeta,
      //     configure: {
      //       ...currentMeta.configure,
      //       advanced: {
      //         ...currentMeta.configure?.advanced,
      //         view: loaded.component, // 设置组件到 advanced.view
      //       },
      //     },
      //   });

      //   // 触发 componentsMap 更新
      //   materials.refreshComponentMetasMap();
      // }

      // 4. 缓存（保存版本和 globalName 信息）
      // 使用 runInAction 包装异步操作后的状态修改
      runInAction(() => {
        this.remoteMaterials.set(packageName, {
          version,
          globalName,
          metadata,
          component,
        })
      })

      console.log(`[Registered] ${packageName}@${version}`, metadata)
    } catch (error) {
      console.error(`[Failed] ${packageName}@${version}:`, error)
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

    console.log(`[Batch Meta Complete] Success: ${succeeded}, Failed: ${failed}`)

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
    return Array.from(this.remoteMaterials.entries()).map(([name, data]) => ({
      name,
      metadata: data.metadata,
    }))
  }

  /**
   * 卸载远程物料
   */
  @action
  unload(packageName: string) {
    const data = this.remoteMaterials.get(packageName)

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
      this.remoteMaterials.delete(packageName)
      NpmMaterialLoader.clearCache(packageName, version)

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
