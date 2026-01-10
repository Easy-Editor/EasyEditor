/**
 * Material Loader
 * 物料加载器
 */

import {
  type Component,
  type ComponentMetadata,
  type LoadOptions,
  type MaterialInfo,
  RemoteLoadError,
  RemoteLoadErrorType,
  loadingState,
  resourceRegistry,
} from '@easy-editor/core'
import { scriptLoader } from './script-loader'
import { versionResolver } from './version-resolver'

/** 加载结果 */
export interface LoadedMaterial {
  component: Component
  meta: ComponentMetadata
}

/**
 * 物料加载器
 * 负责从 CDN 加载物料组件和元数据
 */
export class MaterialLoader {
  /** 完整物料缓存 */
  private cache = new Map<string, LoadedMaterial>()

  /** 元数据缓存 */
  private metaCache = new Map<string, ComponentMetadata>()

  /** 正在加载的 Promise（防止重复请求） */
  private loadingPromises = new Map<string, Promise<LoadedMaterial>>()

  /** 元数据加载 Promise */
  private metaLoadingPromises = new Map<string, Promise<ComponentMetadata>>()

  /**
   * 加载完整物料（元数据 + 组件）
   */
  async loadMaterial(info: MaterialInfo, options?: LoadOptions): Promise<LoadedMaterial> {
    const { package: packageName, version = 'latest', globalName } = info
    const cacheKey = `${packageName}@${version}`

    // 检查缓存
    if (options?.useCache !== false && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }

    // 检查是否正在加载
    if (this.loadingPromises.has(cacheKey)) {
      return this.loadingPromises.get(cacheKey)!
    }

    // 更新加载状态
    loadingState.startLoading(cacheKey, 'material', packageName)

    // 创建加载 Promise
    const loadPromise = this.doLoadMaterial(packageName, version, globalName!, cacheKey, options)
    this.loadingPromises.set(cacheKey, loadPromise)

    try {
      const result = await loadPromise
      this.cache.set(cacheKey, result)

      // 注册到资源注册表
      resourceRegistry.register({
        type: 'material',
        name: packageName,
        version,
        globalName: globalName!,
        data: result,
        loadedAt: Date.now(),
      })

      // 更新加载状态
      loadingState.markLoaded(cacheKey)

      return result
    } catch (error) {
      loadingState.markError(cacheKey, error as Error)
      throw error
    } finally {
      this.loadingPromises.delete(cacheKey)
    }
  }

  /**
   * 仅加载元数据
   */
  async loadMeta(info: MaterialInfo, options?: LoadOptions): Promise<ComponentMetadata> {
    const { package: packageName, version = 'latest', globalName } = info
    const cacheKey = `${packageName}@${version}`

    // 检查缓存
    if (options?.useCache !== false && this.metaCache.has(cacheKey)) {
      return this.metaCache.get(cacheKey)!
    }

    // 检查是否正在加载
    if (this.metaLoadingPromises.has(cacheKey)) {
      return this.metaLoadingPromises.get(cacheKey)!
    }

    // 更新加载状态
    loadingState.startLoading(`${cacheKey}-meta`, 'material', packageName)

    // 创建加载 Promise
    const loadPromise = this.doLoadMeta(packageName, version, globalName!, cacheKey, options)
    this.metaLoadingPromises.set(cacheKey, loadPromise)

    try {
      const result = await loadPromise
      this.metaCache.set(cacheKey, result)
      loadingState.markLoaded(`${cacheKey}-meta`)
      return result
    } catch (error) {
      loadingState.markError(`${cacheKey}-meta`, error as Error)
      throw error
    } finally {
      this.metaLoadingPromises.delete(cacheKey)
    }
  }

  /**
   * 添加组件代码（元数据已加载的情况下）
   */
  async addComponent(info: MaterialInfo, options?: LoadOptions): Promise<Component> {
    const { package: packageName, version = 'latest', globalName } = info

    if (!globalName) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.METADATA_INVALID,
        packageName,
        'material',
        'globalName is required for addComponent',
      )
    }

    const cacheKey = `${packageName}@${version}`

    // 检查是否已完整加载
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!.component
    }

    // 解析版本号
    const resolvedVersion = await versionResolver.resolve(packageName, version)

    // 创建加载上下文
    const context = scriptLoader.createContext(`${cacheKey}-component`)

    // 加载 component.min.js
    await scriptLoader.loadWithFallback(
      packageName,
      resolvedVersion,
      'dist/component.min.js',
      context,
      'material',
      options,
    )

    // 从全局变量获取组件
    const global = window as unknown as Record<string, unknown>
    const componentExports = global[`${globalName}Component`] as Record<string, unknown> | undefined

    if (!componentExports) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        'material',
        `Component UMD export not found: window.${globalName}Component`,
      )
    }

    const defaultExport = componentExports.default as Record<string, unknown> | undefined
    const component = (componentExports.component || defaultExport?.component || defaultExport) as Component | undefined

    if (!component) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        'material',
        `Component not found in window.${globalName}Component`,
      )
    }

    // 如果元数据已加载，合并到缓存
    const meta = this.metaCache.get(cacheKey)
    if (meta) {
      const result: LoadedMaterial = { component, meta }
      this.cache.set(cacheKey, result)
      this.registerToGlobal(globalName, result)
    }

    console.log(`[MaterialLoader] Component added: ${cacheKey}`)
    return component
  }

  /**
   * 预加载多个物料
   */
  async preload(materials: MaterialInfo[], options?: LoadOptions): Promise<LoadedMaterial[]> {
    return Promise.all(materials.map(m => this.loadMaterial(m, options)))
  }

  /**
   * 清除缓存
   */
  clearCache(name?: string, version?: string): void {
    if (name && version) {
      const key = `${name}@${version}`
      this.cache.delete(key)
      this.metaCache.delete(key)
    } else {
      this.cache.clear()
      this.metaCache.clear()
    }
  }

  /**
   * 执行完整物料加载
   */
  private async doLoadMaterial(
    name: string,
    version: string,
    globalName: string,
    cacheKey: string,
    options?: LoadOptions,
  ): Promise<LoadedMaterial> {
    // 解析版本号
    loadingState.updateProgress(cacheKey, 10)
    const resolvedVersion = await versionResolver.resolve(name, version)

    // 创建加载上下文
    const context = scriptLoader.createContext(cacheKey)

    // 加载完整的 index.min.js
    loadingState.updateProgress(cacheKey, 30)
    await scriptLoader.loadWithFallback(name, resolvedVersion, 'dist/index.min.js', context, 'material', options)

    // 从全局变量获取物料
    loadingState.updateProgress(cacheKey, 80)
    const global = window as unknown as Record<string, unknown>
    const materialExports = global[globalName] as Record<string, unknown> | undefined

    if (!materialExports) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        'material',
        `UMD export not found: window.${globalName}`,
      )
    }

    // 提取 meta 和 component
    const defaultExport = materialExports.default as Record<string, unknown> | undefined
    const meta = (materialExports.meta || defaultExport?.meta) as ComponentMetadata | undefined
    const component = (materialExports.component || defaultExport?.component) as Component | undefined

    if (!meta?.componentName) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.METADATA_INVALID,
        globalName,
        'material',
        'Invalid metadata: missing componentName',
      )
    }

    if (!component) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        'material',
        `Component not found in window.${globalName}`,
      )
    }

    const result: LoadedMaterial = { component, meta }
    this.registerToGlobal(globalName, result)

    loadingState.updateProgress(cacheKey, 100)
    console.log(`[MaterialLoader] Loaded: ${cacheKey}`, result)
    return result
  }

  /**
   * 执行元数据加载
   */
  private async doLoadMeta(
    name: string,
    version: string,
    globalName: string,
    cacheKey: string,
    options?: LoadOptions,
  ): Promise<ComponentMetadata> {
    // 解析版本号
    const resolvedVersion = await versionResolver.resolve(name, version)

    // 创建加载上下文
    const context = scriptLoader.createContext(`${cacheKey}-meta`)

    // 加载 meta.min.js
    await scriptLoader.loadWithFallback(name, resolvedVersion, 'dist/meta.min.js', context, 'material', options)

    // 从全局变量获取元数据
    const global = window as unknown as Record<string, unknown>
    const metaExports = global[`${globalName}Meta`] as Record<string, unknown> | undefined

    if (!metaExports) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        'material',
        `UMD meta export not found: window.${globalName}Meta`,
      )
    }

    const defaultExport = metaExports.default as Record<string, unknown> | undefined
    const meta = (metaExports.meta || defaultExport?.meta || defaultExport) as ComponentMetadata | undefined

    if (!meta?.componentName) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.METADATA_INVALID,
        globalName,
        'material',
        'Invalid metadata: missing componentName',
      )
    }

    this.registerToGlobal(globalName, { meta })

    console.log(`[MaterialLoader] Meta loaded: ${cacheKey}`, meta)
    return meta
  }

  /**
   * 注册到全局变量
   */
  private registerToGlobal(globalName: string, data: Partial<LoadedMaterial>): void {
    const global = window as unknown as Record<string, unknown>
    const easyEditor = (global.$EasyEditor || {}) as Record<string, unknown>
    const materials = (easyEditor.materials || {}) as Record<string, unknown>

    materials[globalName] = {
      ...(materials[globalName] as Record<string, unknown>),
      ...data,
    }

    easyEditor.materials = materials
    global.$EasyEditor = easyEditor
  }
}

/** 导出单例 */
export const materialLoader = new MaterialLoader()
