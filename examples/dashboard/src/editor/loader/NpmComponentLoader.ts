/**
 * NPM Component Loader
 * 从 NPM + CDN 动态加载物料组件
 */

import type { Component, ComponentMetadata } from '@easy-editor/core'

/**
 * 加载错误类型
 */
export enum LoadErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR', // 网络错误
  PACKAGE_NOT_FOUND = 'PACKAGE_NOT_FOUND', // 包不存在
  VERSION_NOT_FOUND = 'VERSION_NOT_FOUND', // 版本不存在
  SCRIPT_LOAD_FAILED = 'SCRIPT_LOAD_FAILED', // 脚本加载失败
  GLOBAL_NOT_FOUND = 'GLOBAL_NOT_FOUND', // 全局变量未找到
  METADATA_INVALID = 'METADATA_INVALID', // 元数据无效
  CDN_ALL_FAILED = 'CDN_ALL_FAILED', // 所有 CDN 都失败
}

/**
 * 自定义加载错误
 */
export class ComponentLoadError extends Error {
  constructor(
    public type: LoadErrorType,
    public packageName: string,
    message: string,
    public originalError?: unknown,
  ) {
    super(message)
    this.name = 'ComponentLoadError'
  }

  toUserMessage(): string {
    switch (this.type) {
      case LoadErrorType.NETWORK_ERROR:
        return `网络连接失败，请检查您的网络设置`
      case LoadErrorType.PACKAGE_NOT_FOUND:
        return `物料包 "${this.packageName}" 不存在，请检查包名是否正确`
      case LoadErrorType.VERSION_NOT_FOUND:
        return `指定的版本不存在，请检查版本号是否正确`
      case LoadErrorType.SCRIPT_LOAD_FAILED:
        return `物料脚本加载失败，请稍后重试`
      case LoadErrorType.GLOBAL_NOT_FOUND:
        return `物料格式不正确，无法加载组件`
      case LoadErrorType.METADATA_INVALID:
        return `物料元数据格式错误，请联系物料开发者`
      case LoadErrorType.CDN_ALL_FAILED:
        return `所有 CDN 加载失败，请检查网络或稍后重试`
      default:
        return `加载失败: ${this.message}`
    }
  }
}

interface ComponentInfo {
  name: string // @easy-editor/materials-dashboard-text
  version?: string // 1.0.0 | latest | stable
  globalName: string // EasyEditorMaterialsText（UMD 暴露的全局变量名）
}

interface LoadedComponent {
  component: Component
  meta: ComponentMetadata
}

interface LoadedMeta {
  meta: ComponentMetadata
}

class NpmComponentLoader {
  private cache = new Map<string, LoadedComponent>()
  private metaCache = new Map<string, LoadedMeta>()
  private loadingPromises = new Map<string, Promise<LoadedComponent>>()
  private metaLoadingPromises = new Map<string, Promise<LoadedMeta>>()
  private cdnProviders = ['https://unpkg.com', 'https://cdn.jsdelivr.net/npm', 'https://fastly.jsdelivr.net/npm']
  private currentCdnIndex = 0

  /**
   * 从 NPM 加载元数据（轻量，用于初次加载）
   */
  async loadMeta({ name, version = 'latest', globalName }: ComponentInfo): Promise<LoadedMeta> {
    const cacheKey = `${name}@${version}`

    // 1. 检查缓存
    if (this.metaCache.has(cacheKey)) {
      console.log(`[Meta Cache Hit] ${cacheKey}`)
      return this.metaCache.get(cacheKey)!
    }

    // 2. 检查是否正在加载
    if (this.metaLoadingPromises.has(cacheKey)) {
      console.log(`[Meta Loading] ${cacheKey} - waiting...`)
      return this.metaLoadingPromises.get(cacheKey)!
    }

    // 3. 开始加载
    const loadPromise = this._doLoadMeta(name, version, globalName, cacheKey)
    this.metaLoadingPromises.set(cacheKey, loadPromise)

    try {
      const meta = await loadPromise
      this.metaCache.set(cacheKey, meta)
      return meta
    } finally {
      this.metaLoadingPromises.delete(cacheKey)
    }
  }

  /**
   * 从 NPM 加载物料（完整加载：元数据 + 组件代码）
   */
  async loadMaterial({ name, version = 'latest', globalName }: ComponentInfo): Promise<LoadedComponent> {
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

  /**
   * 添加组件代码（元数据已加载的情况下，只加载组件代码）
   */
  async addComponent({ name, version = 'latest', globalName }: ComponentInfo): Promise<Component> {
    const cacheKey = `${name}@${version}`

    // 检查是否已完整加载
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!.component
    }

    // 加载组件代码
    const resolvedVersion = await this.resolveVersion(name, version)
    const pkgInfo = await this.fetchPackageInfo(name, resolvedVersion)
    const url = this.getCdnUrl(
      name,
      resolvedVersion,
      pkgInfo.unpkg?.replace('index', 'component') || 'dist/component.min.js',
    )

    await this.loadScript(url, `${cacheKey}-component`)

    // 从 UMD 全局变量获取组件
    const global = window as any
    const componentUmdExports = global[`${globalName}Component`]

    if (!componentUmdExports) {
      throw new ComponentLoadError(
        LoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        `Component UMD export not found: window.${globalName}Component`,
      )
    }

    const component =
      componentUmdExports.component || componentUmdExports.default?.component || componentUmdExports.default

    if (!component) {
      throw new ComponentLoadError(
        LoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        `Component not found in window.${globalName}Component`,
      )
    }

    // 获取元数据（如果已加载）
    const meta = global.$EasyEditor?.materials?.[globalName]?.meta

    if (meta) {
      // 如果元数据已加载，注册到 window.$EasyEditor.materials
      const loadedComponent: LoadedComponent = {
        component,
        meta,
      }
      this.registerToGlobal(globalName, loadedComponent)
    }

    return component
  }

  /**
   * 加载元数据（只加载 meta, snippets, configure）
   */
  private async _doLoadMeta(name: string, version: string, globalName: string, cacheKey: string): Promise<LoadedMeta> {
    console.log(`[Loading Meta] ${cacheKey}`)

    // 1. 解析真实版本号
    const resolvedVersion = await this.resolveVersion(name, version)
    console.log(`[Resolved] ${name}: ${version} → ${resolvedVersion}`)

    // 2. 构建 CDN URL（使用 meta.js）
    const url = this.getCdnUrl(name, resolvedVersion, 'dist/meta.min.js')

    // 4. 动态加载脚本
    await this.loadScript(url, `${cacheKey}-meta`)

    // 5. 从 UMD 全局变量获取元数据
    const global = window as any
    const umdExports = global[`${globalName}Meta`] // 例如: window.EasyEditorMaterialsTextMeta

    if (!umdExports) {
      throw new ComponentLoadError(
        LoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        `Material meta UMD export not found: window.${globalName}Meta`,
      )
    }

    // 从 UMD 导出中获取 meta
    const meta = umdExports.meta || umdExports.default?.meta || umdExports.default

    // 挂载到 window.$EasyEditor.materials 以便后续使用
    global.$EasyEditor = global.$EasyEditor || {}
    global.$EasyEditor.materials = global.$EasyEditor.materials || {}
    global.$EasyEditor.materials[globalName] = global.$EasyEditor.materials[globalName] || {}
    global.$EasyEditor.materials[globalName].meta = meta

    if (!meta) {
      throw new ComponentLoadError(
        LoadErrorType.METADATA_INVALID,
        globalName,
        `Meta not found in window.$EasyEditor.materials.${globalName}.meta`,
      )
    }

    if (!meta.componentName) {
      throw new ComponentLoadError(
        LoadErrorType.METADATA_INVALID,
        globalName,
        `Component metadata is missing required field: componentName`,
      )
    }

    const loadedMeta: LoadedMeta = {
      meta,
    }

    console.log(`[Meta Loaded] ${cacheKey}`, loadedMeta)
    return loadedMeta
  }

  private async _doLoad(name: string, version: string, globalName: string, cacheKey: string): Promise<LoadedComponent> {
    console.log(`[Loading] ${cacheKey}`)

    // 1. 解析真实版本号
    const resolvedVersion = await this.resolveVersion(name, version)
    console.log(`[Resolved] ${name}: ${version} → ${resolvedVersion}`)

    // 2. 先加载元数据（如果未加载）
    const global = window as any
    const existingMeta = global.$EasyEditor?.materials?.[globalName]

    if (!existingMeta?.meta) {
      // 加载元数据
      await this._doLoadMeta(name, version, globalName, cacheKey)
    }

    // 4. 加载组件代码
    const componentUrl = this.getCdnUrl(name, resolvedVersion, 'dist/component.min.js')
    await this.loadScript(componentUrl, `${cacheKey}-component`)

    // 5. 从 UMD 全局变量获取组件
    const componentUmdExports = global[`${globalName}Component`]

    if (!componentUmdExports) {
      throw new ComponentLoadError(
        LoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        `Component UMD export not found: window.${globalName}Component`,
      )
    }

    const component =
      componentUmdExports.component || componentUmdExports.default?.component || componentUmdExports.default

    if (!component) {
      throw new ComponentLoadError(
        LoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        `Component not found in window.${globalName}Component`,
      )
    }

    // 6. 从已挂载的全局变量获取完整信息
    const material = global.$EasyEditor.materials[globalName]
    const meta = material.meta

    const loadedComponent: LoadedComponent = {
      component,
      meta,
    }

    // 注册到 window.$EasyEditor.materials
    this.registerToGlobal(globalName, loadedComponent)

    console.log(`[Loaded] ${cacheKey}`, loadedComponent)
    return loadedComponent
  }

  /**
   * 解析版本号（处理 latest/stable 等）
   */
  private async resolveVersion(name: string, version: string): Promise<string> {
    try {
      // 从 npm registry 获取版本信息
      const response = await fetch(`https://registry.npmjs.org/${name}`)

      if (!response.ok) {
        if (response.status === 404) {
          throw new ComponentLoadError(
            LoadErrorType.PACKAGE_NOT_FOUND,
            name,
            `Package "${name}" not found in NPM registry`,
          )
        }
        throw new ComponentLoadError(
          LoadErrorType.NETWORK_ERROR,
          name,
          `Failed to fetch package info: ${response.statusText}`,
        )
      }

      const data = await response.json()

      // 如果是具体版本号，验证是否存在
      if (/^\d+\.\d+\.\d+/.test(version)) {
        if (!data.versions[version]) {
          const availableVersions = Object.keys(data.versions).slice(-5).join(', ')
          throw new ComponentLoadError(
            LoadErrorType.VERSION_NOT_FOUND,
            name,
            `Version "${version}" not found. Recent versions: ${availableVersions}`,
          )
        }
        return version
      }

      // 处理 dist-tags
      if (version === 'latest') {
        return data['dist-tags']?.latest || Object.keys(data.versions).pop()!
      }

      if (version === 'stable') {
        return data['dist-tags']?.stable || data['dist-tags']?.latest || Object.keys(data.versions).pop()!
      }

      // 检查是否是 dist-tag
      if (data['dist-tags']?.[version]) {
        return data['dist-tags'][version]
      }

      // 默认返回 latest
      return data['dist-tags']?.latest || Object.keys(data.versions).pop()!
    } catch (error) {
      if (error instanceof ComponentLoadError) {
        throw error
      }
      throw new ComponentLoadError(
        LoadErrorType.NETWORK_ERROR,
        name,
        `Failed to resolve version: ${error instanceof Error ? error.message : String(error)}`,
        error,
      )
    }
  }

  /**
   * 获取 package.json 信息
   */
  private async fetchPackageInfo(name: string, version: string): Promise<any> {
    try {
      const pkgUrl = `${this.cdnProviders[this.currentCdnIndex]}/${name}@${version}/package.json`
      const response = await fetch(pkgUrl)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return response.json()
    } catch (error) {
      throw new ComponentLoadError(
        LoadErrorType.NETWORK_ERROR,
        name,
        `Failed to fetch package.json: ${error instanceof Error ? error.message : String(error)}`,
        error,
      )
    }
  }

  /**
   * 构建 CDN URL（支持多 CDN 降级）
   */
  private getCdnUrl(name: string, version: string, entryFile: string): string {
    const cdn = this.cdnProviders[this.currentCdnIndex]
    return `${cdn}/${name}@${version}/${entryFile}`
  }

  /**
   * 动态加载 script（支持 CDN fallback）
   */
  private async loadScript(url: string, id: string, retryWithNextCdn = true): Promise<void> {
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

      script.onerror = async () => {
        console.warn(`[Script Load Failed] ${url}`)

        // 尝试下一个 CDN
        if (retryWithNextCdn && this.currentCdnIndex < this.cdnProviders.length - 1) {
          console.log(`[Retry] Switching to CDN ${this.currentCdnIndex + 1}`)
          this.currentCdnIndex++

          // 移除失败的 script 标签
          script.remove()

          try {
            // 重新生成 URL 并加载
            const newUrl = url.replace(
              this.cdnProviders[this.currentCdnIndex - 1],
              this.cdnProviders[this.currentCdnIndex],
            )
            await this.loadScript(newUrl, id, true)
            resolve()
          } catch (error) {
            reject(error)
          }
        } else {
          script.remove()
          const error = new ComponentLoadError(
            LoadErrorType.CDN_ALL_FAILED,
            id,
            `Failed to load from all CDN providers: ${url}`,
          )
          reject(error)
        }
      }

      document.head.appendChild(script)
    })
  }

  /**
   * 从全局变量获取组件（已废弃，现在直接从 window.$EasyEditor.materials 获取）
   * @deprecated 使用 window.$EasyEditor.materials[globalName] 代替
   */
  private getComponentFromGlobal(globalName: string): LoadedComponent {
    const global = window as any
    const material = global.$EasyEditor?.materials?.[globalName]

    if (!material) {
      throw new ComponentLoadError(
        LoadErrorType.GLOBAL_NOT_FOUND,
        globalName,
        `Material not found in window.$EasyEditor.materials.${globalName}`,
      )
    }

    const component = material.component
    const meta = material.meta

    if (!component) {
      throw new ComponentLoadError(
        LoadErrorType.METADATA_INVALID,
        globalName,
        `Component not found in window.$EasyEditor.materials.${globalName}.component`,
      )
    }

    if (!meta) {
      throw new ComponentLoadError(
        LoadErrorType.METADATA_INVALID,
        globalName,
        `Component metadata not found in window.$EasyEditor.materials.${globalName}.meta`,
      )
    }

    if (!meta.componentName) {
      throw new ComponentLoadError(
        LoadErrorType.METADATA_INVALID,
        globalName,
        `Component metadata is missing required field: componentName`,
      )
    }

    return {
      component,
      meta,
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
    await Promise.all(components.map(comp => this.loadMaterial(comp)))
    console.log('[Preload] Complete')
  }
}

export default new NpmComponentLoader()
