/**
 * NPM Component Loader
 * 从 NPM + CDN 动态加载物料组件
 */

import type { Component, ComponentMetadata, Configure, Snippet } from '@easy-editor/core'

interface ComponentInfo {
  name: string // @easy-editor/materials-dashboard-text
  version?: string // 1.0.0 | latest | stable
  globalName: string // Text（UMD 暴露的全局变量名，即 window.Text）
}

interface LoadedComponent {
  component: Component
  meta: ComponentMetadata
  snippets: Snippet[]
  configure: Configure
}

class NpmComponentLoader {
  private cache = new Map<string, LoadedComponent>()
  private loadingPromises = new Map<string, Promise<LoadedComponent>>()
  private cdnProviders = ['https://unpkg.com', 'https://cdn.jsdelivr.net/npm', 'https://fastly.jsdelivr.net/npm']
  private currentCdnIndex = 0

  /**
   * 从 NPM 加载组件
   */
  async loadComponent({ name, version = 'latest', globalName }: ComponentInfo): Promise<LoadedComponent> {
    const cacheKey = `${name}@${version}`

    // 1. 检查缓存
    if (this.cache.has(cacheKey)) {
      console.log(`[Cache Hit] ${cacheKey}`)
      return this.cache.get(cacheKey)!
    }

    // 2. 检查是否正在加载（避免重复请求）
    if (this.loadingPromises.has(cacheKey)) {
      console.log(`[Loading] ${cacheKey} - waiting...`)
      return this.loadingPromises.get(cacheKey)!
    }

    // 3. 开始加载
    const loadPromise = this._doLoad(name, version, globalName, cacheKey)
    this.loadingPromises.set(cacheKey, loadPromise)

    try {
      const component = await loadPromise
      this.cache.set(cacheKey, component)
      return component
    } finally {
      this.loadingPromises.delete(cacheKey)
    }
  }

  private async _doLoad(name: string, version: string, globalName: string, cacheKey: string): Promise<LoadedComponent> {
    console.log(`[Loading] ${cacheKey}`)

    // 1. 解析真实版本号
    const resolvedVersion = await this.resolveVersion(name, version)
    console.log(`[Resolved] ${name}: ${version} → ${resolvedVersion}`)

    // 2. 获取 package.json 信息
    const pkgInfo = await this.fetchPackageInfo(name, resolvedVersion)

    // 3. 构建 CDN URL
    const url = this.getCdnUrl(name, resolvedVersion, pkgInfo.unpkg || 'dist/index.min.js')

    // 4. 动态加载脚本
    await this.loadScript(url, cacheKey)

    // 5. 从全局获取组件
    const component = this.getComponentFromGlobal(globalName)

    // 6. 注册到 $EasyEditor.materials
    this.registerToGlobal(globalName, component)

    console.log(`[Loaded] ${cacheKey}`, component)
    return component
  }

  /**
   * 解析版本号（处理 latest/stable 等）
   */
  private async resolveVersion(name: string, version: string): Promise<string> {
    // 如果是具体版本号，直接返回
    if (/^\d+\.\d+\.\d+/.test(version)) {
      return version
    }

    // 从 npm registry 获取版本信息
    const response = await fetch(`https://registry.npmjs.org/${name}`)
    const data = await response.json()

    if (version === 'latest') {
      return data['dist-tags'].latest
    }

    if (version === 'stable') {
      return data['dist-tags'].stable || data['dist-tags'].latest
    }

    // 默认返回 latest
    return data['dist-tags'].latest
  }

  /**
   * 获取 package.json 信息
   */
  private async fetchPackageInfo(name: string, version: string): Promise<any> {
    const pkgUrl = `${this.cdnProviders[this.currentCdnIndex]}/${name}@${version}/package.json`
    const response = await fetch(pkgUrl)
    return response.json()
  }

  /**
   * 构建 CDN URL（支持多 CDN 降级）
   */
  private getCdnUrl(name: string, version: string, entryFile: string): string {
    const cdn = this.cdnProviders[this.currentCdnIndex]
    return `${cdn}/${name}@${version}/${entryFile}`
  }

  /**
   * 动态加载 script
   */
  private loadScript(url: string, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 检查是否已加载
      if (document.getElementById(`npm-component-${id}`)) {
        resolve()
        return
      }

      const script = document.createElement('script')
      script.src = url
      script.id = `npm-component-${id}`
      script.async = true
      script.crossOrigin = 'anonymous'

      script.onload = () => {
        console.log(`[Script Loaded] ${url}`)
        resolve()
      }

      script.onerror = () => {
        reject(new Error(`Failed to load: ${url}`))
      }

      document.head.appendChild(script)
    })
  }

  /**
   * 从全局变量获取组件
   * @param globalName UMD 暴露的全局变量名（如 'Text' 对应 window.Text）
   */
  private getComponentFromGlobal(globalName: string): LoadedComponent {
    const global = window as any

    // 从 window[globalName] 获取 UMD 导出
    if (!global[globalName]) {
      throw new Error(`Global variable "${globalName}" not found. Please check the UMD build configuration.`)
    }

    const umdExports = global[globalName]

    // UMD 模块的导出可能是：
    // 1. { default: Component, meta, snippets, configure }
    // 2. 直接是 Component（但应该包含 meta 等属性）
    const component = umdExports.default || umdExports
    const meta = umdExports.meta
    const snippets = umdExports.snippets
    const configure = umdExports.configure

    if (!component) {
      throw new Error(`Component not found in global.${globalName}`)
    }

    if (!meta) {
      throw new Error(`Component metadata not found in global.${globalName}.meta`)
    }

    return {
      component,
      meta,
      snippets,
      configure,
    }
  }

  /**
   * 注册到 window.$EasyEditor.materials
   */
  private registerToGlobal(globalName: string, loaded: LoadedComponent) {
    const global = window as any
    global.$EasyEditor = global.$EasyEditor || {}
    global.$EasyEditor.materials = global.$EasyEditor.materials || {}

    global.$EasyEditor.materials[globalName] = {
      component: loaded.component,
      meta: loaded.meta,
      snippets: loaded.snippets,
      configure: loaded.configure,
    }

    console.log(`✅ Registered to window.$EasyEditor.materials.${globalName}`)
  }

  /**
   * 获取组件的所有版本
   */
  async getVersionList(name: string): Promise<string[]> {
    const response = await fetch(`https://registry.npmjs.org/${name}`)
    const data = await response.json()

    return Object.keys(data.versions).sort((a, b) => this.compareVersion(b, a)) // 倒序
  }

  private compareVersion(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number)
    const parts2 = v2.split('.').map(Number)

    for (let i = 0; i < 3; i++) {
      if (parts1[i] !== parts2[i]) {
        return parts1[i] - parts2[i]
      }
    }
    return 0
  }

  /**
   * 清除缓存
   */
  clearCache(name?: string, version?: string) {
    if (name && version) {
      const key = `${name}@${version}`
      this.cache.delete(key)
      console.log(`[Cache Cleared] ${key}`)
    } else {
      this.cache.clear()
      console.log('[Cache Cleared] All')
    }
  }

  /**
   * 预加载组件
   */
  async preload(components: ComponentInfo[]) {
    console.log('[Preload] Starting...', components)
    await Promise.all(components.map(comp => this.loadComponent(comp)))
    console.log('[Preload] Complete')
  }
}

export default new NpmComponentLoader()
