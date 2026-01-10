/**
 * Script Loader
 * 动态脚本和样式加载器（浏览器特定实现）
 */

import { DEFAULT_TIMEOUT, RemoteLoadError, RemoteLoadErrorType, type ResourceType } from '@easy-editor/core'
import { type CdnProviderManager, cdnProviderManager } from './cdn-provider'

/** 加载上下文（每个请求独立） */
export interface LoadContext {
  /** 请求 ID */
  requestId: string
  /** 当前 CDN 索引 */
  cdnIndex: number
  /** 已尝试的 CDN */
  triedCdns: Set<string>
  /** 中止控制器 */
  abortController: AbortController
}

/** 脚本加载选项 */
export interface ScriptLoadOptions {
  /** 超时时间（毫秒） */
  timeout?: number
  /** 跨域设置 */
  crossOrigin?: string
  /** 是否异步加载 */
  async?: boolean
}

/**
 * 脚本加载器
 * 负责动态加载 JS 脚本和 CSS 样式，支持 CDN 降级
 */
export class ScriptLoader {
  /** 已加载的脚本 ID */
  private loadedScripts = new Set<string>()

  /** 已加载的 CSS ID */
  private loadedCSS = new Set<string>()

  constructor(private cdnManager: CdnProviderManager = cdnProviderManager) {}

  /**
   * 创建加载上下文
   */
  createContext(requestId: string): LoadContext {
    return {
      requestId,
      cdnIndex: 0,
      triedCdns: new Set(),
      abortController: new AbortController(),
    }
  }

  /**
   * 加载脚本（带 CDN 降级）
   */
  async loadWithFallback(
    pkg: string,
    version: string,
    file: string,
    context: LoadContext,
    resourceType: ResourceType,
    options?: ScriptLoadOptions,
  ): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT
    const provider = this.cdnManager.getProvider(context.cdnIndex)

    if (!provider) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.CDN_ALL_FAILED,
        pkg,
        resourceType,
        `All CDN providers failed for: ${pkg}@${version}/${file}`,
      )
    }

    // 记录已尝试的 CDN
    context.triedCdns.add(provider.name)

    const url = this.cdnManager.buildUrl(pkg, version, file, context.cdnIndex)
    const scriptId = `${pkg}@${version}-${file.replace(/[/.]/g, '-')}`

    try {
      await this.loadScript(url, scriptId, timeout, resourceType, context.abortController.signal)
    } catch (error) {
      // 检查是否还有未尝试的 CDN
      const nextCdnIndex = context.cdnIndex + 1
      if (nextCdnIndex < this.cdnManager.getProviderCount()) {
        const nextProvider = this.cdnManager.getProvider(nextCdnIndex)
        console.warn(`[ScriptLoader] Fallback to CDN: ${nextProvider?.name}`)

        // 更新上下文中的 CDN 索引
        context.cdnIndex = nextCdnIndex

        // 重试
        return this.loadWithFallback(pkg, version, file, context, resourceType, options)
      }

      // 所有 CDN 都失败
      throw RemoteLoadError.create(
        RemoteLoadErrorType.CDN_ALL_FAILED,
        pkg,
        resourceType,
        `All CDN providers failed for: ${pkg}@${version}/${file}`,
        error,
      )
    }
  }

  /**
   * 加载 CSS
   */
  async loadCSS(
    pkg: string,
    version: string,
    file: string,
    context: LoadContext,
    resourceType: ResourceType,
  ): Promise<void> {
    const cssKey = `${pkg}@${version}-${file.replace(/[/.]/g, '-')}`

    // 检查是否已加载
    if (this.loadedCSS.has(cssKey)) {
      return
    }

    const url = this.cdnManager.buildUrl(pkg, version, file, context.cdnIndex)

    return new Promise((resolve, reject) => {
      // 检查 DOM 中是否已存在
      const existingLink = document.getElementById(`cdn-css-${cssKey}`)
      if (existingLink) {
        this.loadedCSS.add(cssKey)
        resolve()
        return
      }

      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = url
      link.id = `cdn-css-${cssKey}`

      link.onload = () => {
        this.loadedCSS.add(cssKey)
        console.log(`[ScriptLoader] CSS loaded: ${url}`)
        resolve()
      }

      link.onerror = () => {
        // CSS 加载失败不阻塞，只警告
        console.warn(`[ScriptLoader] CSS load failed (non-blocking): ${url}`)
        resolve()
      }

      document.head.appendChild(link)
    })
  }

  /**
   * 检查脚本是否已加载
   */
  isLoaded(id: string): boolean {
    return this.loadedScripts.has(id)
  }

  /**
   * 检查 CSS 是否已加载
   */
  isCSSLoaded(id: string): boolean {
    return this.loadedCSS.has(id)
  }

  /**
   * 加载单个脚本
   */
  private loadScript(
    url: string,
    id: string,
    timeout: number,
    resourceType: ResourceType,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // 检查是否已加载
      if (this.loadedScripts.has(id)) {
        resolve()
        return
      }

      const existingScript = document.getElementById(`cdn-script-${id}`)
      if (existingScript) {
        this.loadedScripts.add(id)
        resolve()
        return
      }

      // 超时处理
      const timeoutId = setTimeout(() => {
        script.remove()
        reject(RemoteLoadError.create(RemoteLoadErrorType.TIMEOUT, id, resourceType, `Load timeout: ${url}`))
      }, timeout)

      // 中止处理
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeoutId)
          script.remove()
          reject(RemoteLoadError.create(RemoteLoadErrorType.NETWORK_ERROR, id, resourceType, 'Load aborted'))
        })
      }

      const script = document.createElement('script')
      script.src = url
      script.id = `cdn-script-${id}`
      script.async = true
      script.crossOrigin = 'anonymous'

      script.onload = () => {
        clearTimeout(timeoutId)
        this.loadedScripts.add(id)
        console.log(`[ScriptLoader] Script loaded: ${url}`)
        resolve()
      }

      script.onerror = () => {
        clearTimeout(timeoutId)
        script.remove()
        reject(
          RemoteLoadError.create(
            RemoteLoadErrorType.SCRIPT_LOAD_FAILED,
            id,
            resourceType,
            `Failed to load script: ${url}`,
          ),
        )
      }

      document.head.appendChild(script)
    })
  }

  /**
   * 清除加载记录（用于测试或重新加载）
   */
  clearLoadedRecords(): void {
    this.loadedScripts.clear()
    this.loadedCSS.clear()
  }
}

/** 导出单例 */
export const scriptLoader = new ScriptLoader()
