import type { Component, Setter } from '@easy-editor/core'
import { action, computed, observable, runInAction } from 'mobx'
import { assertCommittedPackageIdentity } from '../committed-package-identity.js'
import { LatestOperationRegistry } from '../keyed-operation-coordinator.js'
import type { SetterLoader } from '../loaders'
import { type RemotePackageLoadResult, settleRemotePackageLoads } from '../remote-load-batch.js'
import type { DashboardRemoteServices } from '../runtime-services'

export interface RemoteSetterConfig {
  package: string
  version?: string
  globalName: string
  enabled?: boolean
}

interface CachedSetterPackage {
  version: string
  globalName: string
  setterMap: Record<string, Component | Setter>
  customFieldItem?: unknown
}

export class SetterManagerClass {
  @observable.shallow private accessor remoteSetterPackages = new Map<string, CachedSetterPackage>()
  private readonly packageOperations = new LatestOperationRegistry()
  private readonly registeredResources = new Set<string>()

  constructor(
    private readonly services: DashboardRemoteServices,
    private readonly loader: SetterLoader,
  ) {}

  @computed
  get loadedCount(): number {
    return this.remoteSetterPackages.size
  }

  @computed
  get remoteSettersMap(): Record<string, Component | Setter> {
    const result: Record<string, Component | Setter> = {}
    for (const data of this.remoteSetterPackages.values()) Object.assign(result, data.setterMap)
    return result
  }

  @action
  async load(config: RemoteSetterConfig): Promise<void> {
    const { package: packageName, version = 'latest', globalName, enabled = true } = config
    if (!enabled) return
    this.assertCommittedIdentityCompatible(packageName, version, globalName)
    const packageOperation = this.packageOperations.begin(packageName)
    const operation = this.services.scope.beginOperation(`register setters ${packageName}`)
    try {
      const loaded = await this.loader.loadSetters({ package: packageName, version, globalName })
      this.packageOperations.assertCurrent(packageOperation)
      this.services.scope.assertCurrent(operation)
      this.assertCommittedIdentityCompatible(packageName, version, globalName)
      this.services.scope.perform({ name: packageName, type: 'registration', resourceType: 'setter' }, () => {
        this.packageOperations.assertCurrent(packageOperation)
        this.services.scope.assertCurrent(operation)
        if (loaded.setterMap) this.services.setters.registerSetter(loaded.setterMap)
        this.services.registry.register({
          type: 'setter',
          name: packageName,
          version,
          globalName,
          data: loaded,
          loadedAt: Date.now(),
        })
        this.registeredResources.add(packageName)
      })
      this.packageOperations.assertCurrent(packageOperation)
      this.services.scope.assertCurrent(operation)
      runInAction(() => {
        this.packageOperations.assertCurrent(packageOperation)
        this.remoteSetterPackages.set(packageName, {
          version,
          globalName,
          setterMap: loaded.setterMap || {},
          customFieldItem: loaded.customFieldItem,
        })
      })
    } finally {
      this.packageOperations.finish(packageOperation)
      this.services.scope.finishOperation(operation)
    }
  }

  @action
  async loadMultiple(configs: RemoteSetterConfig[]): Promise<RemotePackageLoadResult> {
    return settleRemotePackageLoads(configs, config => this.load(config))
  }

  getLoadedPackages(): Array<{ name: string; version: string; setterCount: number; setterNames: string[] }> {
    return Array.from(this.remoteSetterPackages, ([name, data]) => ({
      name,
      version: data.version,
      setterCount: Object.keys(data.setterMap).length,
      setterNames: Object.keys(data.setterMap),
    }))
  }

  getCustomFieldItem(packageName: string): unknown {
    return this.remoteSetterPackages.get(packageName)?.customFieldItem
  }

  isLoaded(packageName: string): boolean {
    return this.remoteSetterPackages.has(packageName)
  }

  getPackageInfo(packageName: string): CachedSetterPackage | undefined {
    return this.remoteSetterPackages.get(packageName)
  }

  dispose(): void {
    // Setters has no per-entry unregister API. The owning EngineInstance clears
    // its complete setter registry immediately after the adapter is disposed.
    this.packageOperations.invalidateAll()
    for (const packageName of this.registeredResources) this.services.registry.unload('setter', packageName)
    this.registeredResources.clear()
    this.remoteSetterPackages.clear()
  }

  private assertCommittedIdentityCompatible(packageName: string, version: string, globalName: string): void {
    assertCommittedPackageIdentity(
      'Setter',
      { packageName, version, globalName },
      this.remoteSetterPackages.get(packageName),
    )
  }
}
