/**
 * Instance-owned material loader.
 */

import {
  type Component,
  type ComponentMetadata,
  type LoadOptions,
  type MaterialInfo,
  RemoteLoadError,
  RemoteLoadErrorType,
} from '@easy-editor/core/instance'
import { GlobalExportClaims } from '../global-export-claims.js'
import { SingleFlight } from '../keyed-operation-coordinator.js'
import type { DashboardRemoteServices } from '../runtime-services'
import type { ScriptLoader } from './script-loader'
import type { VersionResolver } from './version-resolver'

export interface LoadedMaterial {
  component: Component
  meta: ComponentMetadata
}

export class MaterialLoader {
  private readonly cache = new Map<string, LoadedMaterial>()
  private readonly claims: GlobalExportClaims
  private readonly componentLoads = new SingleFlight()
  private readonly loadingPromises = new Map<string, Promise<LoadedMaterial>>()
  private readonly metaCache = new Map<string, ComponentMetadata>()
  private readonly metaLoadingPromises = new Map<string, Promise<ComponentMetadata>>()
  constructor(
    private readonly services: DashboardRemoteServices,
    private readonly scriptLoader: ScriptLoader,
    private readonly versionResolver: VersionResolver,
  ) {
    this.claims = new GlobalExportClaims(services)
  }

  async loadMaterial(info: MaterialInfo, options?: LoadOptions): Promise<LoadedMaterial> {
    this.services.scope.assertActive()
    const { package: packageName, version = 'latest' } = info
    const globalName = this.requireGlobalName(info.globalName, packageName)
    const cacheKey = this.createCacheKey(packageName, version, globalName)
    if (options?.useCache !== false && this.cache.has(cacheKey)) return this.cache.get(cacheKey)!
    if (this.loadingPromises.has(cacheKey)) return this.loadingPromises.get(cacheKey)!

    const promise = this.loadMaterialOperation(packageName, version, globalName, cacheKey, options)
    this.loadingPromises.set(cacheKey, promise)
    try {
      return await promise
    } finally {
      this.loadingPromises.delete(cacheKey)
    }
  }

  async loadMeta(info: MaterialInfo, options?: LoadOptions): Promise<ComponentMetadata> {
    this.services.scope.assertActive()
    const { package: packageName, version = 'latest' } = info
    const globalName = this.requireGlobalName(info.globalName, packageName)
    const cacheKey = this.createCacheKey(packageName, version, globalName)
    if (options?.useCache !== false && this.metaCache.has(cacheKey)) return this.metaCache.get(cacheKey)!
    if (this.metaLoadingPromises.has(cacheKey)) return this.metaLoadingPromises.get(cacheKey)!

    const promise = this.loadMetaOperation(packageName, version, globalName, cacheKey, options)
    this.metaLoadingPromises.set(cacheKey, promise)
    try {
      return await promise
    } finally {
      this.metaLoadingPromises.delete(cacheKey)
    }
  }

  async addComponent(info: MaterialInfo, options?: LoadOptions): Promise<Component> {
    this.services.scope.assertActive()
    const { package: packageName, version = 'latest' } = info
    const globalName = this.requireGlobalName(info.globalName, packageName)
    const cacheKey = this.createCacheKey(packageName, version, globalName)
    const cached = this.cache.get(cacheKey)
    if (cached) return cached.component
    return this.componentLoads.run(cacheKey, () =>
      this.addComponentOperation(packageName, version, globalName, cacheKey, options),
    )
  }

  private async addComponentOperation(
    packageName: string,
    version: string,
    globalName: string,
    cacheKey: string,
    options?: LoadOptions,
  ): Promise<Component> {
    this.services.scope.assertActive()
    const operation = this.services.scope.beginOperation(`load component ${cacheKey}`)
    try {
      const resolvedVersion = await this.versionResolver.resolve(packageName, version)
      this.services.scope.assertCurrent(operation)
      const exportName = `${globalName}Component`
      this.claims.prepare(exportName, `${packageName}@${resolvedVersion}/dist/component.min.js`, {
        name: exportName,
        type: 'global-claim',
        resourceType: 'material',
      })
      const context = this.scriptLoader.createContext(`${cacheKey}-component`)
      await this.scriptLoader.loadWithFallback(
        packageName,
        resolvedVersion,
        'dist/component.min.js',
        context,
        'material',
        options,
      )
      this.services.scope.assertCurrent(operation)

      const componentExports = this.claims.read<Record<string, unknown>>(exportName)
      if (!componentExports) {
        throw RemoteLoadError.create(
          RemoteLoadErrorType.GLOBAL_NOT_FOUND,
          exportName,
          'material',
          `Component UMD export not found: window.${exportName}`,
        )
      }
      const defaultExport = componentExports.default as Record<string, unknown> | undefined
      const component = (componentExports.component || defaultExport?.component || defaultExport) as
        | Component
        | undefined
      if (!component) {
        throw RemoteLoadError.create(
          RemoteLoadErrorType.GLOBAL_NOT_FOUND,
          exportName,
          'material',
          `Component not found in window.${exportName}`,
        )
      }

      const meta = this.metaCache.get(cacheKey)
      if (meta) this.cache.set(cacheKey, { component, meta })
      return component
    } finally {
      this.services.scope.finishOperation(operation)
    }
  }

  preload(materials: MaterialInfo[], options?: LoadOptions): Promise<LoadedMaterial[]> {
    this.services.scope.assertActive()
    return Promise.all(materials.map(material => this.loadMaterial(material, options)))
  }

  clearCache(name?: string, version?: string): void {
    if (name && version) {
      const prefix = `${encodeURIComponent(name)}::${encodeURIComponent(version)}::`
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) this.cache.delete(key)
      }
      for (const key of this.metaCache.keys()) {
        if (key.startsWith(prefix)) this.metaCache.delete(key)
      }
      return
    }
    this.cache.clear()
    this.metaCache.clear()
  }

  dispose(): void {
    this.clearCache()
    this.componentLoads.clear()
    this.loadingPromises.clear()
    this.metaLoadingPromises.clear()
    this.claims.clearClaims()
  }

  private async loadMaterialOperation(
    packageName: string,
    version: string,
    globalName: string,
    cacheKey: string,
    options?: LoadOptions,
  ): Promise<LoadedMaterial> {
    const operation = this.services.scope.beginOperation(`load material ${cacheKey}`)
    this.services.loadingState.startLoading(cacheKey, 'material', packageName)
    try {
      this.services.loadingState.updateProgress(cacheKey, 10)
      const resolvedVersion = await this.versionResolver.resolve(packageName, version)
      this.services.scope.assertCurrent(operation)
      this.claims.prepare(globalName, `${packageName}@${resolvedVersion}/dist/index.min.js`, {
        name: globalName,
        type: 'global-claim',
        resourceType: 'material',
      })

      this.services.loadingState.updateProgress(cacheKey, 30)
      const context = this.scriptLoader.createContext(cacheKey)
      await this.scriptLoader.loadWithFallback(
        packageName,
        resolvedVersion,
        'dist/index.min.js',
        context,
        'material',
        options,
      )
      this.services.scope.assertCurrent(operation)
      this.services.loadingState.updateProgress(cacheKey, 80)

      const materialExports = this.claims.read<Record<string, unknown>>(globalName)
      if (!materialExports) {
        throw RemoteLoadError.create(
          RemoteLoadErrorType.GLOBAL_NOT_FOUND,
          globalName,
          'material',
          `UMD export not found: window.${globalName}`,
        )
      }
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

      const result = { component, meta }
      this.services.scope.assertCurrent(operation)
      this.cache.set(cacheKey, result)
      this.metaCache.set(cacheKey, meta)
      this.services.loadingState.updateProgress(cacheKey, 100)
      this.services.loadingState.markLoaded(cacheKey)
      return result
    } catch (error) {
      if (this.services.scope.isActive) this.services.loadingState.markError(cacheKey, this.toError(error))
      throw error
    } finally {
      this.services.scope.finishOperation(operation)
    }
  }

  private async loadMetaOperation(
    packageName: string,
    version: string,
    globalName: string,
    cacheKey: string,
    options?: LoadOptions,
  ): Promise<ComponentMetadata> {
    const stateKey = `${cacheKey}-meta`
    const operation = this.services.scope.beginOperation(`load material metadata ${cacheKey}`)
    this.services.loadingState.startLoading(stateKey, 'material', packageName)
    try {
      const resolvedVersion = await this.versionResolver.resolve(packageName, version)
      this.services.scope.assertCurrent(operation)
      const exportName = `${globalName}Meta`
      this.claims.prepare(exportName, `${packageName}@${resolvedVersion}/dist/meta.min.js`, {
        name: exportName,
        type: 'global-claim',
        resourceType: 'material',
      })
      const context = this.scriptLoader.createContext(stateKey)
      await this.scriptLoader.loadWithFallback(
        packageName,
        resolvedVersion,
        'dist/meta.min.js',
        context,
        'material',
        options,
      )
      this.services.scope.assertCurrent(operation)

      const metaExports = this.claims.read<Record<string, unknown>>(exportName)
      if (!metaExports) {
        throw RemoteLoadError.create(
          RemoteLoadErrorType.GLOBAL_NOT_FOUND,
          exportName,
          'material',
          `UMD meta export not found: window.${exportName}`,
        )
      }
      const defaultExport = metaExports.default as Record<string, unknown> | undefined
      const meta = (metaExports.meta || defaultExport?.meta || defaultExport) as ComponentMetadata | undefined
      if (!meta?.componentName) {
        throw RemoteLoadError.create(
          RemoteLoadErrorType.METADATA_INVALID,
          exportName,
          'material',
          'Invalid metadata: missing componentName',
        )
      }

      this.services.scope.assertCurrent(operation)
      this.metaCache.set(cacheKey, meta)
      this.services.loadingState.markLoaded(stateKey)
      return meta
    } catch (error) {
      if (this.services.scope.isActive) this.services.loadingState.markError(stateKey, this.toError(error))
      throw error
    } finally {
      this.services.scope.finishOperation(operation)
    }
  }

  private requireGlobalName(globalName: string | undefined, packageName: string): string {
    if (globalName) return globalName
    throw RemoteLoadError.create(
      RemoteLoadErrorType.METADATA_INVALID,
      packageName,
      'material',
      'globalName is required',
    )
  }

  private createCacheKey(packageName: string, version: string, globalName: string): string {
    return [packageName, version, globalName].map(encodeURIComponent).join('::')
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }
}
