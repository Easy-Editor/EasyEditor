/**
 * Instance-owned setter loader.
 */

import {
  type Component,
  type LoadOptions,
  RemoteLoadError,
  RemoteLoadErrorType,
  type Setter,
  type SetterInfo,
} from '@easy-editor/core/instance'
import { GlobalExportClaims } from '../global-export-claims.js'
import { LatestOperationRegistry, SingleFlight } from '../keyed-operation-coordinator.js'
import type { DashboardRemoteServices } from '../runtime-services'
import type { ScriptLoader } from './script-loader'
import type { VersionResolver } from './version-resolver'

export interface LoadedSetters {
  setterMap: Record<string, Component | Setter>
  customFieldItem?: unknown
  [key: string]: unknown
}

export class SetterLoader {
  private readonly cache = new Map<string, LoadedSetters>()
  private readonly claims: GlobalExportClaims
  private readonly loadedCSS = new Set<string>()
  private readonly packageOperations = new LatestOperationRegistry()
  private readonly setterLoads = new SingleFlight()

  constructor(
    private readonly services: DashboardRemoteServices,
    private readonly scriptLoader: ScriptLoader,
    private readonly versionResolver: VersionResolver,
  ) {
    this.claims = new GlobalExportClaims(services)
  }

  async loadSetters(info: SetterInfo, options?: LoadOptions): Promise<LoadedSetters> {
    this.services.scope.assertActive()
    const { package: packageName, version = 'latest', globalName } = info
    const cacheKey = this.createCacheKey(packageName, version, globalName)
    return this.setterLoads.run(cacheKey, async () => {
      const packageOperation = this.packageOperations.begin(packageName)
      try {
        const cached = options?.useCache !== false ? this.cache.get(cacheKey) : undefined
        if (cached) return cached
        return await this.loadOperation(packageName, version, globalName, cacheKey, packageOperation, options)
      } finally {
        this.packageOperations.finish(packageOperation)
      }
    })
  }

  preload(setters: SetterInfo[], options?: LoadOptions): Promise<LoadedSetters[]> {
    this.services.scope.assertActive()
    return Promise.all(setters.map(setter => this.loadSetters(setter, options)))
  }

  clearCache(name?: string, version?: string): void {
    if (name && version) {
      const prefix = `${encodeURIComponent(name)}::${encodeURIComponent(version)}::`
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) this.cache.delete(key)
      }
      for (const key of this.loadedCSS) {
        if (key.startsWith(prefix)) this.loadedCSS.delete(key)
      }
      return
    }
    this.cache.clear()
    this.loadedCSS.clear()
  }

  dispose(): void {
    this.packageOperations.invalidateAll()
    this.setterLoads.clear()
    this.clearCache()
    this.claims.clearClaims()
  }

  private async loadOperation(
    packageName: string,
    version: string,
    globalName: string,
    cacheKey: string,
    packageOperation: ReturnType<LatestOperationRegistry['begin']>,
    options?: LoadOptions,
  ): Promise<LoadedSetters> {
    const operation = this.services.scope.beginOperation(`load setters ${cacheKey}`)
    this.services.loadingState.startLoading(cacheKey, 'setter', packageName)
    try {
      this.services.loadingState.updateProgress(cacheKey, 10)
      const resolvedVersion = await this.versionResolver.resolve(packageName, version)
      this.packageOperations.assertCurrent(packageOperation)
      this.services.scope.assertCurrent(operation)
      this.claims.prepare(globalName, `${packageName}@${resolvedVersion}/dist/index.min.js`, {
        name: globalName,
        type: 'global-claim',
        resourceType: 'setter',
      })
      const context = this.scriptLoader.createContext(cacheKey)

      if (options?.loadCSS !== false) {
        this.services.loadingState.updateProgress(cacheKey, 20)
        await this.loadCSS(packageName, resolvedVersion, cacheKey, context, options)
        this.packageOperations.assertCurrent(packageOperation)
        this.services.scope.assertCurrent(operation)
      }

      this.services.loadingState.updateProgress(cacheKey, 40)
      await this.scriptLoader.loadWithFallback(
        packageName,
        resolvedVersion,
        'dist/index.min.js',
        context,
        'setter',
        options,
      )
      this.packageOperations.assertCurrent(packageOperation)
      this.services.scope.assertCurrent(operation)
      this.services.loadingState.updateProgress(cacheKey, 80)

      const setterExports = this.claims.read<LoadedSetters>(globalName)
      if (!setterExports) {
        throw RemoteLoadError.create(
          RemoteLoadErrorType.GLOBAL_NOT_FOUND,
          globalName,
          'setter',
          `UMD export not found: window.${globalName}`,
        )
      }

      this.packageOperations.assertCurrent(packageOperation)
      this.services.scope.assertCurrent(operation)
      this.cache.set(cacheKey, setterExports)
      this.services.loadingState.updateProgress(cacheKey, 100)
      this.services.loadingState.markLoaded(cacheKey)
      return setterExports
    } catch (error) {
      if (this.services.scope.isActive) {
        this.services.loadingState.markError(cacheKey, error instanceof Error ? error : new Error(String(error)))
      }
      throw error
    } finally {
      this.services.scope.finishOperation(operation)
    }
  }

  private async loadCSS(
    packageName: string,
    version: string,
    cacheKey: string,
    context: ReturnType<ScriptLoader['createContext']>,
    options?: LoadOptions,
  ): Promise<void> {
    if (this.loadedCSS.has(cacheKey)) return
    try {
      await this.scriptLoader.loadCSS(packageName, version, 'dist/index.css', context, 'setter', options)
      this.loadedCSS.add(cacheKey)
    } catch (error) {
      if (!this.services.scope.isActive) throw error
      console.warn('[SetterLoader] CSS load failed (non-blocking):', error)
    }
  }

  private createCacheKey(packageName: string, version: string, globalName: string): string {
    return [packageName, version, globalName].map(encodeURIComponent).join('::')
  }
}
