import type { EngineInstance, RemoteAccessRequest, RemoteAdapter } from '@easy-editor/core/instance'
import { remoteMaterialsConfig, remoteSettersConfig } from './config'
import {
  CdnProviderManager,
  LocalMaterialLoaderClass,
  MaterialLoader,
  ScriptLoader,
  SetterLoader,
  VersionResolver,
} from './loaders'
import { MaterialManagerClass, SetterManagerClass } from './managers'
import { OwnedGlobalBindings } from './owned-global-bindings.js'
import { type RemotePackageLoadResult, settleRemotePackageLoads } from './remote-load-batch.js'
import { RemoteResourceScope } from './resource-scope.js'
import { RetryableDisposal } from './retryable-disposal.js'
import type { DashboardRemoteServices, RemoteEnvironment } from './runtime-services'

export interface DashboardRemoteResourcesOptions {
  authorize: (request: RemoteAccessRequest) => unknown
  environment: RemoteEnvironment
  hostGlobals: Readonly<Record<string, unknown>>
  instanceId?: string
}

export class DashboardRemoteResources implements RemoteAdapter {
  readonly scope: RemoteResourceScope
  readonly instanceId: string

  cdnProviderManager!: CdnProviderManager
  localLoader!: LocalMaterialLoaderClass
  materialLoader!: MaterialLoader
  materialManager!: MaterialManagerClass
  scriptLoader!: ScriptLoader
  setterLoader!: SetterLoader
  setterManager!: SetterManagerClass
  versionResolver!: VersionResolver

  private bound = false
  private disposalStarted = false
  private readonly disposal: RetryableDisposal
  private readonly environment: RemoteEnvironment
  private readonly hostGlobals: OwnedGlobalBindings
  private services?: DashboardRemoteServices

  constructor(options: DashboardRemoteResourcesOptions) {
    this.environment = options.environment
    this.instanceId = options.instanceId || Math.random().toString(36).slice(2)
    this.scope = new RemoteResourceScope(options.authorize)
    this.hostGlobals = new OwnedGlobalBindings({ bindings: options.hostGlobals, realm: options.environment.window })
    this.disposal = new RetryableDisposal([
      { name: 'scope', run: () => this.scope.dispose() },
      { name: 'hostGlobals', run: () => this.hostGlobals.dispose() },
      { name: 'localLoader', run: () => this.localLoader?.dispose() },
      { name: 'materialManager', run: () => this.materialManager?.dispose() },
      { name: 'setterManager', run: () => this.setterManager?.dispose() },
      { name: 'materialLoader', run: () => this.materialLoader?.dispose() },
      { name: 'setterLoader', run: () => this.setterLoader?.dispose() },
      { name: 'scriptLoader', run: () => this.scriptLoader?.dispose() },
      { name: 'versionResolver', run: () => this.versionResolver?.dispose() },
      { name: 'cdnProviderManager', run: () => this.cdnProviderManager?.reset() },
      { name: 'loadingState', run: () => this.services?.loadingState.clearAll() },
      { name: 'registry', run: () => this.services?.registry.clearAll() },
    ])
  }

  bindEngine(engine: EngineInstance): void {
    if (this.disposalStarted) throw new Error('Dashboard remote resources are disposing or disposed')
    if (this.bound) throw new Error('Dashboard remote resources are already bound to an engine')
    const services: DashboardRemoteServices = {
      environment: this.environment,
      instanceId: this.instanceId,
      loadingState: engine.remote.loadingState,
      materials: engine.materials,
      registry: engine.remote.registry,
      scope: this.scope,
      setters: engine.setters,
    }

    this.cdnProviderManager = new CdnProviderManager()
    this.versionResolver = new VersionResolver(services)
    this.scriptLoader = new ScriptLoader(this.cdnProviderManager, services)
    this.materialLoader = new MaterialLoader(services, this.scriptLoader, this.versionResolver)
    this.setterLoader = new SetterLoader(services, this.scriptLoader, this.versionResolver)
    this.materialManager = new MaterialManagerClass(services, this.materialLoader)
    this.setterManager = new SetterManagerClass(services, this.setterLoader)
    this.localLoader = new LocalMaterialLoaderClass(services)
    this.services = services
    this.bound = true
  }

  init(): void {
    this.assertBound()
    this.scope.activate()
    this.hostGlobals.install((request, effect) => this.scope.perform(request, effect))
  }

  request(request: RemoteAccessRequest): void {
    this.assertBound()
    const allowedTypes = new Set(['fetch', 'global-claim', 'module', 'registration', 'script', 'style', 'websocket'])
    if (!allowedTypes.has(request.type)) throw new Error(`Unsupported remote operation: ${request.type}`)
    if (!request.url) return
    const url = new URL(request.url, this.environment.window.location.href)
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) {
      throw new Error(`Remote URL is not allowed: ${url.href}`)
    }
  }

  dispose(): Promise<void> {
    this.disposalStarted = true
    return this.disposal.dispose()
  }

  loadRemoteMaterialsMeta(): Promise<RemotePackageLoadResult> {
    this.assertBound()
    this.scope.assertActive()
    return settleRemotePackageLoads(remoteMaterialsConfig, config => this.materialManager.loadMeta(config))
  }

  loadRemoteSetters(): Promise<RemotePackageLoadResult> {
    this.assertBound()
    this.scope.assertActive()
    return settleRemotePackageLoads(remoteSettersConfig, config => this.setterManager.load(config))
  }

  async loadAllRemoteResources(): Promise<{
    materials: RemotePackageLoadResult
    setters: RemotePackageLoadResult
  }> {
    this.assertBound()
    this.scope.assertActive()
    const [materials, setters] = await Promise.all([this.loadRemoteMaterialsMeta(), this.loadRemoteSetters()])
    return { materials, setters }
  }

  waitForSetters(timeout = 30000): Promise<void> {
    this.assertBound()
    this.scope.assertActive()
    return this.getEngineLoadingState().waitForType('setter', timeout)
  }

  waitForAllResources(timeout = 30000): Promise<void> {
    this.assertBound()
    this.scope.assertActive()
    return this.getEngineLoadingState().waitForAll(timeout)
  }

  async runBackground<T>(label: string, task: () => Promise<T>): Promise<T> {
    const operation = this.scope.beginOperation(label)
    try {
      const result = await task()
      this.scope.assertCurrent(operation)
      return result
    } finally {
      this.scope.finishOperation(operation)
    }
  }

  private getEngineLoadingState() {
    this.assertBound()
    return this.services!.loadingState
  }

  private assertBound(): void {
    if (!this.bound) throw new Error('Dashboard remote resources are not bound to an engine')
  }
}
