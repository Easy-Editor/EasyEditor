/**
 * CDN Material Loader
 * 从 CDN 动态加载物料组件（修复并发问题）
 */

import type { Component, ComponentMetadata } from '@easy-editor/core'

/** 加载错误类型 */
export enum CdnLoadErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  PACKAGE_NOT_FOUND = 'PACKAGE_NOT_FOUND',
  VERSION_NOT_FOUND = 'VERSION_NOT_FOUND',
  SCRIPT_LOAD_FAILED = 'SCRIPT_LOAD_FAILED',
  GLOBAL_NOT_FOUND = 'GLOBAL_NOT_FOUND',
  METADATA_INVALID = 'METADATA_INVALID',
  CDN_ALL_FAILED = 'CDN_ALL_FAILED',
  TIMEOUT = 'TIMEOUT',
}

/** CDN 加载错误 */
export class CdnLoadError extends Error {
  constructor(
    public type: CdnLoadErrorType,
    public packageName: string,
    message: string,
    public originalError?: unknown,
  ) {
    super(message)
    this.name = 'CdnLoadError'
  }

  toUserMessage(): string {
    const messages: Record<CdnLoadErrorType, string> = {
      [CdnLoadErrorType.NETWORK_ERROR]: '网络连接失败，请检查您的网络设置',
      [CdnLoadErrorType.PACKAGE_NOT_FOUND]: `物料包 "${this.packageName}" 不存在`,
      [CdnLoadErrorType.VERSION_NOT_FOUND]: '指定的版本不存在',
      [CdnLoadErrorType.SCRIPT_LOAD_FAILED]: '物料脚本加载失败',
      [CdnLoadErrorType.GLOBAL_NOT_FOUND]: '物料格式不正确',
      [CdnLoadErrorType.METADATA_INVALID]: '物料元数据格式错误',
      [CdnLoadErrorType.CDN_ALL_FAILED]: '所有 CDN 加载失败',
      [CdnLoadErrorType.TIMEOUT]: '加载超时',
    }
    return messages[this.type] || `加载失败: ${this.message}`
  }
}

/** 物料信息 */
export interface MaterialInfo {
  /** NPM 包名 */
  name: string
  /** 版本号 */
  version?: string
  /** UMD 全局变量名 */
  globalName: string
}

/** 加载结果 */
export interface LoadedMaterial {
  component: Component
  meta: ComponentMetadata
}

/** 加载选项 */
export interface LoadOptions {
  /** 超时时间（毫秒） */
  timeout?: number
  /** 是否使用缓存 */
  useCache?: boolean
}

/** 加载上下文（每个请求独立） */
interface LoadContext {
  /** 请求 ID */
  requestId: string
  /** 当前 CDN 索引 */
  cdnIndex: number
  /** 已尝试的 CDN */
  triedCdns: Set<string>
  /** 中止控制器 */
  abortController: AbortController
}

/** CDN 提供商 */
const CDN_PROVIDERS = ['https://unpkg.com', 'https://cdn.jsdelivr.net/npm', 'https://fastly.jsdelivr.net/npm']

/** 默认超时时间 */
const DEFAULT_TIMEOUT = 30000

/**
 * CDN 物料加载器
 * 解决了并发加载时 CDN 索引互相干扰的问题
 */
class CdnMaterialLoader {
  /** 完整物料缓存 */
  private cache = new Map<string, LoadedMaterial>()

  /** 元数据缓存 */
  private metaCache = new Map<string, ComponentMetadata>()

  /** 正在加载的 Promise（防止重复请求） */
  private loadingPromises = new Map<string, Promise<LoadedMaterial>>()

  /** 元数据加载 Promise */
  private metaLoadingPromises = new Map<string, Promise<ComponentMetadata>>()

  /** 版本解析缓存 */
  private versionCache = new Map<string, string>()

  /**
   * 加载完整物料（元数据 + 组件）
   */
  async loadMaterial(info: MaterialInfo, options?: LoadOptions): Promise<LoadedMaterial> {
    const { name, version = 'latest', globalName } = info
    const cacheKey = `${name}@${version}`

    // 检查缓存
    if (options?.useCache !== false && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }

    // 检查是否正在加载
    if (this.loadingPromises.has(cacheKey)) {
      return this.loadingPromises.get(cacheKey)!
    }

    // 创建加载上下文
    const context = this.createContext(cacheKey)

    // 创建加载 Promise
    const loadPromise = this.doLoadMaterial(name, version, globalName, cacheKey, context, options)
    this.loadingPromises.set(cacheKey, loadPromise)

    try {
      const result = await loadPromise
      this.cache.set(cacheKey, result)
      return result
    } finally {
      this.loadingPromises.delete(cacheKey)
    }
  }

  /**
   * 仅加载元数据
   */
  async loadMeta(info: MaterialInfo, options?: LoadOptions): Promise<ComponentMetadata> {
    const { name, version = 'latest', globalName } = info
    const cacheKey = `${name}@${version}`

    // 检查缓存
    if (options?.useCache !== false && this.metaCache.has(cacheKey)) {
      return this.metaCache.get(cacheKey)!
    }

    // 检查是否正在加载
    if (this.metaLoadingPromises.has(cacheKey)) {
      return this.metaLoadingPromises.get(cacheKey)!
    }

    // 创建加载上下文
    const context = this.createContext(cacheKey)

    // 创建加载 Promise
    const loadPromise = this.doLoadMeta(name, version, globalName, cacheKey, context, options)
    this.metaLoadingPromises.set(cacheKey, loadPromise)

    try {
      const result = await loadPromise
      this.metaCache.set(cacheKey, result)
      return result
    } finally {
      this.metaLoadingPromises.delete(cacheKey)
    }
  }

  /**
   * 创建加载上下文（每个请求独立）
   */
  private createContext(requestId: string): LoadContext {
    return {
      requestId,
      cdnIndex: 0,
      triedCdns: new Set(),
      abortController: new AbortController(),
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
    context: LoadContext,
    options?: LoadOptions,
  ): Promise<LoadedMaterial> {
    // 解析版本号
    const resolvedVersion = await this.resolveVersion(name, version)

    // 加载完整的 index.min.js
    const url = this.buildCdnUrl(name, resolvedVersion, 'dist/index.min.js', context.cdnIndex)
    await this.loadScriptWithFallback(url, `${cacheKey}-index`, context, options)

    // 从全局变量获取物料
    const global = window as Record<string, unknown>
    const materialExports = global[globalName] as Record<string, unknown> | undefined

    if (!materialExports) {
      throw new CdnLoadError(
        CdnLoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        `UMD export not found: window.${globalName}`,
      )
    }

    // 提取 meta 和 component
    const defaultExport = materialExports.default as Record<string, unknown> | undefined
    const meta = (materialExports.meta || defaultExport?.meta) as ComponentMetadata | undefined
    const component = (materialExports.component || defaultExport?.component) as Component | undefined

    if (!meta?.componentName) {
      throw new CdnLoadError(CdnLoadErrorType.METADATA_INVALID, globalName, 'Invalid metadata: missing componentName')
    }

    if (!component) {
      throw new CdnLoadError(
        CdnLoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        `Component not found in window.${globalName}`,
      )
    }

    const result: LoadedMaterial = { component, meta }
    this.registerToGlobal(globalName, result)

    console.log(`[CdnLoader] Loaded ${cacheKey}`, result)
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
    context: LoadContext,
    options?: LoadOptions,
  ): Promise<ComponentMetadata> {
    // 解析版本号
    const resolvedVersion = await this.resolveVersion(name, version)

    // 加载 meta.min.js
    const url = this.buildCdnUrl(name, resolvedVersion, 'dist/meta.min.js', context.cdnIndex)
    await this.loadScriptWithFallback(url, `${cacheKey}-meta`, context, options)

    // 从全局变量获取元数据
    const global = window as Record<string, unknown>
    const metaExports = global[`${globalName}Meta`] as Record<string, unknown> | undefined

    if (!metaExports) {
      throw new CdnLoadError(
        CdnLoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        `UMD meta export not found: window.${globalName}Meta`,
      )
    }

    const defaultExport = metaExports.default as Record<string, unknown> | undefined
    const meta = (metaExports.meta || defaultExport?.meta || defaultExport) as ComponentMetadata | undefined

    if (!meta?.componentName) {
      throw new CdnLoadError(CdnLoadErrorType.METADATA_INVALID, globalName, 'Invalid metadata: missing componentName')
    }

    this.registerToGlobal(globalName, { meta })

    console.log(`[CdnLoader] Meta loaded ${cacheKey}`, meta)
    return meta
  }

  /**
   * 解析版本号
   */
  private async resolveVersion(name: string, version: string): Promise<string> {
    const cacheKey = `${name}@${version}`

    // 检查缓存
    if (this.versionCache.has(cacheKey)) {
      return this.versionCache.get(cacheKey)!
    }

    // 如果是具体版本号，直接返回
    if (/^\d+\.\d+\.\d+/.test(version)) {
      this.versionCache.set(cacheKey, version)
      return version
    }

    try {
      const response = await fetch(`https://registry.npmjs.org/${name}`)

      if (!response.ok) {
        if (response.status === 404) {
          throw new CdnLoadError(CdnLoadErrorType.PACKAGE_NOT_FOUND, name, `Package not found`)
        }
        throw new CdnLoadError(CdnLoadErrorType.NETWORK_ERROR, name, `HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      const distTags = data['dist-tags'] || {}
      const versions = Object.keys(data.versions || {})

      let resolved: string
      if (version === 'latest') {
        resolved = distTags.latest || versions[versions.length - 1]
      } else if (version === 'stable') {
        resolved = distTags.stable || distTags.latest || versions[versions.length - 1]
      } else if (distTags[version]) {
        resolved = distTags[version]
      } else {
        resolved = distTags.latest || versions[versions.length - 1]
      }

      this.versionCache.set(cacheKey, resolved)
      return resolved
    } catch (error) {
      if (error instanceof CdnLoadError) throw error
      throw new CdnLoadError(
        CdnLoadErrorType.NETWORK_ERROR,
        name,
        `Failed to resolve version: ${error instanceof Error ? error.message : String(error)}`,
        error,
      )
    }
  }

  /**
   * 构建 CDN URL
   */
  private buildCdnUrl(name: string, version: string, file: string, cdnIndex: number): string {
    const cdn = CDN_PROVIDERS[cdnIndex] || CDN_PROVIDERS[0]
    return `${cdn}/${name}@${version}/${file}`
  }

  /**
   * 加载脚本（带 CDN 降级，解决并发问题的关键）
   */
  private async loadScriptWithFallback(
    url: string,
    id: string,
    context: LoadContext,
    options?: LoadOptions,
  ): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT

    // 记录已尝试的 CDN
    const currentCdn = CDN_PROVIDERS[context.cdnIndex]
    context.triedCdns.add(currentCdn)

    try {
      await this.loadScript(url, id, timeout, context.abortController.signal)
    } catch (error) {
      // 检查是否还有未尝试的 CDN
      const nextCdnIndex = context.cdnIndex + 1

      if (nextCdnIndex < CDN_PROVIDERS.length) {
        console.warn(`[CdnLoader] Fallback to CDN ${nextCdnIndex}: ${CDN_PROVIDERS[nextCdnIndex]}`)

        // 更新上下文中的 CDN 索引（不影响其他请求）
        context.cdnIndex = nextCdnIndex

        // 构建新 URL 并重试
        const newUrl = url.replace(currentCdn, CDN_PROVIDERS[nextCdnIndex])
        return this.loadScriptWithFallback(newUrl, id, context, options)
      }

      // 所有 CDN 都失败
      throw new CdnLoadError(CdnLoadErrorType.CDN_ALL_FAILED, id, `All CDN providers failed for: ${id}`)
    }
  }

  /**
   * 加载单个脚本
   */
  private loadScript(url: string, id: string, timeout: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      // 检查是否已加载
      const existingScript = document.getElementById(`cdn-material-${id}`)
      if (existingScript) {
        resolve()
        return
      }

      // 超时处理
      const timeoutId = setTimeout(() => {
        script.remove()
        reject(new CdnLoadError(CdnLoadErrorType.TIMEOUT, id, `Load timeout: ${url}`))
      }, timeout)

      // 中止处理
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeoutId)
          script.remove()
          reject(new CdnLoadError(CdnLoadErrorType.NETWORK_ERROR, id, 'Load aborted'))
        })
      }

      const script = document.createElement('script')
      script.src = url
      script.id = `cdn-material-${id}`
      script.async = true
      script.crossOrigin = 'anonymous'

      script.onload = () => {
        clearTimeout(timeoutId)
        console.log(`[CdnLoader] Script loaded: ${url}`)
        resolve()
      }

      script.onerror = () => {
        clearTimeout(timeoutId)
        script.remove()
        reject(new CdnLoadError(CdnLoadErrorType.SCRIPT_LOAD_FAILED, id, `Failed to load script: ${url}`))
      }

      document.head.appendChild(script)
    })
  }

  /**
   * 注册到全局（兼容旧代码）
   */
  private registerToGlobal(globalName: string, data: Partial<LoadedMaterial>) {
    const global = window as Record<string, unknown>
    const easyEditor = (global.$EasyEditor || {}) as Record<string, unknown>
    const materials = (easyEditor.materials || {}) as Record<string, unknown>

    materials[globalName] = {
      ...(materials[globalName] as Record<string, unknown>),
      ...data,
    }

    easyEditor.materials = materials
    global.$EasyEditor = easyEditor
  }

  /**
   * 获取版本列表
   */
  async getVersionList(name: string): Promise<string[]> {
    const response = await fetch(`https://registry.npmjs.org/${name}`)
    const data = await response.json()
    return Object.keys(data.versions || {}).reverse()
  }

  /**
   * 清除缓存
   */
  clearCache(name?: string, version?: string) {
    if (name && version) {
      const key = `${name}@${version}`
      this.cache.delete(key)
      this.metaCache.delete(key)
      this.versionCache.delete(key)
    } else {
      this.cache.clear()
      this.metaCache.clear()
      this.versionCache.clear()
    }
  }

  /**
   * 预加载多个物料
   */
  async preload(materials: MaterialInfo[], options?: LoadOptions): Promise<LoadedMaterial[]> {
    return Promise.all(materials.map(m => this.loadMaterial(m, options)))
  }

  /**
   * 添加组件代码（元数据已加载的情况下，只加载组件代码）
   * 用于懒加载场景：先加载 meta，渲染时再加载 component
   */
  async addComponent(info: MaterialInfo, options?: LoadOptions): Promise<Component> {
    const { name, version = 'latest', globalName } = info
    const cacheKey = `${name}@${version}`

    // 检查是否已完整加载
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!.component
    }

    // 创建加载上下文
    const context = this.createContext(`${cacheKey}-component`)

    // 解析版本号
    const resolvedVersion = await this.resolveVersion(name, version)

    // 加载 component.min.js
    const url = this.buildCdnUrl(name, resolvedVersion, 'dist/component.min.js', context.cdnIndex)
    await this.loadScriptWithFallback(url, `${cacheKey}-component`, context, options)

    // 从全局变量获取组件
    const global = window as Record<string, unknown>
    const componentExports = global[`${globalName}Component`] as Record<string, unknown> | undefined

    if (!componentExports) {
      throw new CdnLoadError(
        CdnLoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        `Component UMD export not found: window.${globalName}Component`,
      )
    }

    const defaultExport = componentExports.default as Record<string, unknown> | undefined
    const component = (componentExports.component || defaultExport?.component || defaultExport) as Component | undefined

    if (!component) {
      throw new CdnLoadError(
        CdnLoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
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

    console.log(`[CdnLoader] Component added ${cacheKey}`)
    return component
  }

  /**
   * 中止指定加载
   */
  abort(cacheKey: string) {
    // 通过 loadingPromises 找到对应的上下文并中止
    // 注意：当前实现中上下文是局部的，需要额外的映射来支持中止
    console.warn(`[CdnLoader] Abort requested for ${cacheKey}`)
  }
}

/** 导出单例 */
export const cdnLoader = new CdnMaterialLoader()
export default cdnLoader
