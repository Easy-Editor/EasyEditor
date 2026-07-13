import { type Component, type ComponentMetadata, MaterialSource } from '@easy-editor/core/instance'
import { action, computed, observable, runInAction } from 'mobx'
import { assertCommittedPackageIdentity } from '../committed-package-identity.js'
import { LatestOperationRegistry, SingleFlight } from '../keyed-operation-coordinator.js'
import type { LoadedMaterial, MaterialLoader } from '../loaders'
import { type RemotePackageLoadResult, settleRemotePackageLoads } from '../remote-load-batch.js'
import type { DashboardRemoteServices } from '../runtime-services'

export interface RemoteMaterialConfig {
  package: string
  version?: string
  globalName: string
  enabled?: boolean
}

interface CachedMaterialPackage {
  version: string
  globalName: string
  meta: ComponentMetadata
  component?: Component
  hasComponent: boolean
}

export class MaterialManagerClass {
  @observable.shallow private accessor remoteMaterialPackages = new Map<string, CachedMaterialPackage>()
  private readonly componentRegistrations = new SingleFlight()
  private readonly packageOperations = new LatestOperationRegistry()
  private readonly registeredResources = new Set<string>()

  constructor(
    private readonly services: DashboardRemoteServices,
    private readonly loader: MaterialLoader,
  ) {}

  @computed
  get loadedCount(): number {
    return this.remoteMaterialPackages.size
  }

  @computed
  get remoteComponentsMap(): Record<string, Component> {
    const componentsMap: Record<string, Component> = {}
    for (const data of this.remoteMaterialPackages.values()) {
      if (data.meta.componentName && data.component) componentsMap[data.meta.componentName] = data.component
    }
    return componentsMap
  }

  @action
  async loadMeta(config: RemoteMaterialConfig): Promise<void> {
    const { package: packageName, version = 'latest', globalName, enabled = true } = config
    if (!enabled) return
    this.assertCommittedIdentityCompatible(packageName, version, globalName)
    const packageOperation = this.packageOperations.begin(packageName)
    const operation = this.services.scope.beginOperation(`register material metadata ${packageName}`)
    try {
      const meta = await this.loader.loadMeta({ package: packageName, version, globalName })
      this.packageOperations.assertCurrent(packageOperation)
      this.services.scope.assertCurrent(operation)
      this.assertCommittedIdentityCompatible(packageName, version, globalName)
      this.services.scope.perform({ name: packageName, type: 'registration', resourceType: 'material' }, () => {
        this.packageOperations.assertCurrent(packageOperation)
        this.services.materials.buildComponentMetasMap([meta])
      })
      this.packageOperations.assertCurrent(packageOperation)
      this.services.scope.assertCurrent(operation)
      runInAction(() => {
        this.remoteMaterialPackages.set(packageName, { version, globalName, meta, hasComponent: false })
      })
    } finally {
      this.packageOperations.finish(packageOperation)
      this.services.scope.finishOperation(operation)
    }
  }

  @action
  async loadMetaMultiple(configs: RemoteMaterialConfig[]): Promise<RemotePackageLoadResult> {
    return settleRemotePackageLoads(configs, config => this.loadMeta(config))
  }

  @action
  async loadFull(config: RemoteMaterialConfig): Promise<LoadedMaterial> {
    const { package: packageName, version = 'latest', globalName, enabled = true } = config
    if (!enabled) throw new Error(`Material ${packageName} is disabled`)
    this.assertCommittedIdentityCompatible(packageName, version, globalName)
    const packageOperation = this.packageOperations.begin(packageName)
    const operation = this.services.scope.beginOperation(`register material ${packageName}`)
    try {
      const loaded = await this.loader.loadMaterial({ package: packageName, version, globalName })
      this.packageOperations.assertCurrent(packageOperation)
      this.services.scope.assertCurrent(operation)
      this.assertCommittedIdentityCompatible(packageName, version, globalName)
      this.services.scope.perform({ name: packageName, type: 'registration', resourceType: 'material' }, () => {
        this.packageOperations.assertCurrent(packageOperation)
        this.services.scope.assertCurrent(operation)
        this.services.materials.buildComponentMetasMap([loaded.meta])
        this.services.registry.register({
          type: 'material',
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
        this.remoteMaterialPackages.set(packageName, {
          version,
          globalName,
          meta: loaded.meta,
          component: loaded.component,
          hasComponent: true,
        })
      })
      return loaded
    } finally {
      this.packageOperations.finish(packageOperation)
      this.services.scope.finishOperation(operation)
    }
  }

  @action
  async addComponent(packageName: string): Promise<void> {
    const cached = this.remoteMaterialPackages.get(packageName)
    if (!cached) throw new Error(`Material ${packageName} not found in cache`)
    if (cached.hasComponent) return
    const cacheKey = `${packageName}@${cached.version}#${cached.globalName}`
    return this.componentRegistrations.run(cacheKey, () => this.addComponentOperation(packageName, cached))
  }

  private async addComponentOperation(packageName: string, cached: CachedMaterialPackage): Promise<void> {
    this.assertCachedMaterialCurrent(packageName, cached)
    const operation = this.services.scope.beginOperation(`register component ${packageName}`)
    try {
      const component = await this.loader.addComponent({
        package: packageName,
        version: cached.version,
        globalName: cached.globalName,
      })
      this.services.scope.assertCurrent(operation)
      this.assertCachedMaterialCurrent(packageName, cached)
      this.services.scope.perform({ name: packageName, type: 'registration', resourceType: 'material' }, () => {
        this.assertCachedMaterialCurrent(packageName, cached)
        this.services.materials.createComponentMeta(cached.meta, {
          component,
          source: MaterialSource.REMOTE,
        })
        this.services.registry.register({
          type: 'material',
          name: packageName,
          version: cached.version,
          globalName: cached.globalName,
          data: { component, meta: cached.meta },
          loadedAt: Date.now(),
        })
        this.registeredResources.add(packageName)
      })
      this.services.scope.assertCurrent(operation)
      this.assertCachedMaterialCurrent(packageName, cached)
      runInAction(() => {
        this.remoteMaterialPackages.set(packageName, { ...cached, component, hasComponent: true })
      })
    } finally {
      this.services.scope.finishOperation(operation)
    }
  }

  @action
  async loadMaterialMultiple(configs: RemoteMaterialConfig[]): Promise<{
    total: number
    succeeded: number
    failed: number
    results: PromiseSettledResult<LoadedMaterial>[]
  }> {
    const results = await Promise.allSettled(configs.map(config => this.loadFull(config)))
    return {
      total: configs.length,
      succeeded: results.filter(result => result.status === 'fulfilled').length,
      failed: results.filter(result => result.status === 'rejected').length,
      results,
    }
  }

  getLoadedPackages(): Array<{
    name: string
    version: string
    componentName: string
    hasComponent: boolean
  }> {
    return Array.from(this.remoteMaterialPackages, ([name, data]) => ({
      name,
      version: data.version,
      componentName: data.meta.componentName,
      hasComponent: data.hasComponent,
    }))
  }

  getLoadedMaterials(): Array<{ name: string; version: string; metadata: ComponentMetadata }> {
    return Array.from(this.remoteMaterialPackages, ([name, data]) => ({
      name,
      version: data.version,
      metadata: data.meta,
    }))
  }

  isLoaded(packageName: string): boolean {
    return this.remoteMaterialPackages.has(packageName)
  }

  hasComponent(packageName: string): boolean {
    return this.remoteMaterialPackages.get(packageName)?.hasComponent ?? false
  }

  getPackageInfo(packageName: string): CachedMaterialPackage | undefined {
    return this.remoteMaterialPackages.get(packageName)
  }

  dispose(): void {
    this.packageOperations.invalidateAll()
    this.componentRegistrations.clear()
    for (const data of this.remoteMaterialPackages.values()) {
      this.services.materials.removeComponentMeta(data.meta.componentName)
    }
    for (const packageName of this.registeredResources) this.services.registry.unload('material', packageName)
    this.registeredResources.clear()
    this.remoteMaterialPackages.clear()
  }

  private assertCachedMaterialCurrent(packageName: string, cached: CachedMaterialPackage): void {
    if (this.remoteMaterialPackages.get(packageName) !== cached) {
      throw new Error(`Material ${packageName}@${cached.version} was superseded during component loading`)
    }
  }

  private assertCommittedIdentityCompatible(packageName: string, version: string, globalName: string): void {
    assertCommittedPackageIdentity(
      'Material',
      { packageName, version, globalName },
      this.remoteMaterialPackages.get(packageName),
    )
  }
}
