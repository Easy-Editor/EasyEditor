/**
 * CDN Provider Manager
 * CDN 提供商管理器（浏览器特定实现）
 */

/** CDN 提供商配置 */
export interface CdnProvider {
  /** 提供商名称 */
  name: string
  /** 基础 URL */
  baseUrl: string
  /** 优先级（数字越小优先级越高） */
  priority: number
}

/** 默认 CDN 提供商列表 */
export const DEFAULT_CDN_PROVIDERS: CdnProvider[] = [
  { name: 'unpkg', baseUrl: 'https://unpkg.com', priority: 1 },
  { name: 'jsdelivr', baseUrl: 'https://cdn.jsdelivr.net/npm', priority: 2 },
  { name: 'fastly', baseUrl: 'https://fastly.jsdelivr.net/npm', priority: 3 },
]

/**
 * CDN 提供商管理器
 * 管理多个 CDN 提供商，支持优先级排序和自定义提供商
 */
export class CdnProviderManager {
  private providers: CdnProvider[]

  constructor(providers?: CdnProvider[]) {
    this.providers = providers ? [...providers] : [...DEFAULT_CDN_PROVIDERS]
    this.sortByPriority()
  }

  /**
   * 获取所有提供商（按优先级排序）
   */
  getProviders(): CdnProvider[] {
    return [...this.providers]
  }

  /**
   * 获取提供商数量
   */
  getProviderCount(): number {
    return this.providers.length
  }

  /**
   * 根据索引获取提供商
   */
  getProvider(index: number): CdnProvider | undefined {
    return this.providers[index]
  }

  /**
   * 添加自定义提供商
   */
  addProvider(provider: CdnProvider): void {
    // 检查是否已存在同名提供商
    const existingIndex = this.providers.findIndex(p => p.name === provider.name)
    if (existingIndex >= 0) {
      this.providers[existingIndex] = provider
    } else {
      this.providers.push(provider)
    }
    this.sortByPriority()
  }

  /**
   * 移除提供商
   */
  removeProvider(name: string): boolean {
    const index = this.providers.findIndex(p => p.name === name)
    if (index >= 0) {
      this.providers.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * 构建 CDN URL
   * @param pkg 包名
   * @param version 版本号
   * @param file 文件路径
   * @param providerIndex 提供商索引
   */
  buildUrl(pkg: string, version: string, file: string, providerIndex = 0): string {
    const provider = this.providers[providerIndex] || this.providers[0]
    if (!provider) {
      throw new Error('No CDN provider available')
    }
    return `${provider.baseUrl}/${pkg}@${version}/${file}`
  }

  /**
   * 按优先级排序
   */
  private sortByPriority(): void {
    this.providers.sort((a, b) => a.priority - b.priority)
  }

  /**
   * 重置为默认提供商
   */
  reset(): void {
    this.providers = [...DEFAULT_CDN_PROVIDERS]
    this.sortByPriority()
  }
}

/** 导出单例 */
export const cdnProviderManager = new CdnProviderManager()
