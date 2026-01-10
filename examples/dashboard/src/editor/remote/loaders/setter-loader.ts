/**
 * Setter Loader
 * 设置器加载器
 */

import {
  type LoadOptions,
  type SetterInfo,
  RemoteLoadError,
  RemoteLoadErrorType,
  loadingState,
  resourceRegistry,
} from '@easy-editor/core'
import { scriptLoader } from './script-loader'
import { versionResolver } from './version-resolver'

/** 加载结果 */
export interface LoadedSetters {
  /** 设置器映射 */
  setterMap: Record<string, unknown>
  /** 自定义字段渲染器 */
  customFieldItem?: unknown
  /** 其他导出 */
  [key: string]: unknown
}

/**
 * 设置器加载器
 * 负责从 CDN 加载设置器包
 */
export class SetterLoader {
  /** 设置器缓存 */
  private cache = new Map<string, LoadedSetters>()

  /** 正在加载的 Promise（防止重复请求） */
  private loadingPromises = new Map<string, Promise<LoadedSetters>>()

  /** 已加载的 CSS */
  private loadedCSS = new Set<string>()

  /**
   * 加载设置器包
   */
  async loadSetters(info: SetterInfo, options?: LoadOptions): Promise<LoadedSetters> {
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
    loadingState.startLoading(cacheKey, 'setter', packageName)

    // 创建加载 Promise
    const loadPromise = this.doLoadSetters(packageName, version, globalName, cacheKey, options)
    this.loadingPromises.set(cacheKey, loadPromise)

    try {
      const result = await loadPromise
      this.cache.set(cacheKey, result)

      // 注册到资源注册表
      resourceRegistry.register({
        type: 'setter',
        name: packageName,
        version,
        globalName,
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
   * 预加载多个设置器包
   */
  async preload(setters: SetterInfo[], options?: LoadOptions): Promise<LoadedSetters[]> {
    return Promise.all(setters.map(s => this.loadSetters(s, options)))
  }

  /**
   * 清除缓存
   */
  clearCache(name?: string, version?: string): void {
    if (name && version) {
      const key = `${name}@${version}`
      this.cache.delete(key)
      this.loadedCSS.delete(key)
    } else {
      this.cache.clear()
      this.loadedCSS.clear()
    }
  }

  /**
   * 执行设置器加载
   */
  private async doLoadSetters(
    name: string,
    version: string,
    globalName: string,
    cacheKey: string,
    options?: LoadOptions,
  ): Promise<LoadedSetters> {
    // 解析版本号
    loadingState.updateProgress(cacheKey, 10)
    const resolvedVersion = await versionResolver.resolve(name, version)

    // 创建加载上下文
    const context = scriptLoader.createContext(cacheKey)

    // 1. 加载 CSS（如果需要）
    if (options?.loadCSS !== false) {
      loadingState.updateProgress(cacheKey, 20)
      await this.loadCSS(name, resolvedVersion, context)
    }

    // 2. 加载 JS
    loadingState.updateProgress(cacheKey, 40)
    await scriptLoader.loadWithFallback(name, resolvedVersion, 'dist/index.min.js', context, 'setter', options)

    // 3. 从全局变量获取设置器
    loadingState.updateProgress(cacheKey, 80)
    const global = window as unknown as Record<string, unknown>
    const setterExports = global[globalName] as LoadedSetters | undefined

    if (!setterExports) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        'setter',
        `UMD export not found: window.${globalName}`,
      )
    }

    // 4. 注册到全局
    this.registerToGlobal(globalName, setterExports)

    loadingState.updateProgress(cacheKey, 100)
    console.log(`[SetterLoader] Loaded: ${cacheKey}`, setterExports)
    return setterExports
  }

  /**
   * 加载 CSS
   */
  private async loadCSS(name: string, version: string, context: { cdnIndex: number }): Promise<void> {
    const cssKey = `${name}@${version}`

    // 检查是否已加载
    if (this.loadedCSS.has(cssKey)) {
      return
    }

    try {
      await scriptLoader.loadCSS(name, version, 'dist/styles.css', context as any, 'setter')
      this.loadedCSS.add(cssKey)
    } catch (error) {
      // CSS 加载失败不阻塞
      console.warn(`[SetterLoader] CSS load failed (non-blocking):`, error)
    }
  }

  /**
   * 注册到全局变量
   */
  private registerToGlobal(globalName: string, data: LoadedSetters): void {
    const global = window as unknown as Record<string, unknown>
    const easyEditor = (global.$EasyEditor || {}) as Record<string, unknown>
    const setters = (easyEditor.setters || {}) as Record<string, unknown>

    setters[globalName] = {
      ...(setters[globalName] as Record<string, unknown>),
      ...data,
    }

    easyEditor.setters = setters
    global.$EasyEditor = easyEditor
  }
}

/** 导出单例 */
export const setterLoader = new SetterLoader()
