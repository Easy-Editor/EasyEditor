/**
 * Version Resolver
 * NPM 包版本解析器（浏览器特定实现）
 */

import { RemoteLoadError, RemoteLoadErrorType } from '@easy-editor/core'

/**
 * 版本解析器
 * 解析 NPM 包的版本号，支持 latest、stable 等标签
 */
export class VersionResolver {
  /** 版本缓存 */
  private cache = new Map<string, string>()

  /**
   * 解析版本号
   * @param packageName 包名
   * @param version 版本号或标签（如 latest、stable）
   * @returns 解析后的具体版本号
   */
  async resolve(packageName: string, version: string): Promise<string> {
    const cacheKey = `${packageName}@${version}`

    // 检查缓存
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return cached
    }

    // 如果是具体版本号，直接返回
    if (this.isConcreteVersion(version)) {
      this.cache.set(cacheKey, version)
      return version
    }

    // 对于 latest/stable 等标签，直接使用（CDN 支持）
    if (version === 'latest' || version === 'stable') {
      this.cache.set(cacheKey, version)
      return version
    }

    // 其他情况尝试从 npm registry 解析
    try {
      const resolved = await this.resolveFromRegistry(packageName, version)
      this.cache.set(cacheKey, resolved)
      return resolved
    } catch (error) {
      // 解析失败时回退到原始版本字符串
      console.warn(`[VersionResolver] Failed to resolve version, using "${version}" directly:`, error)
      this.cache.set(cacheKey, version)
      return version
    }
  }

  /**
   * 获取包的所有版本列表
   */
  async getVersionList(packageName: string): Promise<string[]> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${packageName}`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json()
      return Object.keys(data.versions || {}).reverse()
    } catch (error) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.NETWORK_ERROR,
        packageName,
        'material',
        `Failed to fetch version list: ${error instanceof Error ? error.message : String(error)}`,
        error,
      )
    }
  }

  /**
   * 清除缓存
   */
  clearCache(packageName?: string): void {
    if (packageName) {
      // 清除指定包的所有版本缓存
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${packageName}@`)) {
          this.cache.delete(key)
        }
      }
    } else {
      this.cache.clear()
    }
  }

  /**
   * 检查是否是具体版本号（如 1.0.0、1.0.0-beta.1）
   */
  private isConcreteVersion(version: string): boolean {
    return /^\d+\.\d+\.\d+/.test(version)
  }

  /**
   * 从 npm registry 解析版本
   */
  private async resolveFromRegistry(packageName: string, version: string): Promise<string> {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`)

    if (!response.ok) {
      if (response.status === 404) {
        throw RemoteLoadError.create(
          RemoteLoadErrorType.PACKAGE_NOT_FOUND,
          packageName,
          'material',
          `Package not found: ${packageName}`,
        )
      }
      throw RemoteLoadError.create(
        RemoteLoadErrorType.NETWORK_ERROR,
        packageName,
        'material',
        `HTTP ${response.status}: ${response.statusText}`,
      )
    }

    const data = await response.json()
    const distTags = data['dist-tags'] || {}
    const versions = Object.keys(data.versions || {})

    // 尝试从 dist-tags 获取
    if (distTags[version]) {
      return distTags[version]
    }

    // 回退到 latest
    return distTags.latest || versions[versions.length - 1] || version
  }
}

/** 导出单例 */
export const versionResolver = new VersionResolver()
