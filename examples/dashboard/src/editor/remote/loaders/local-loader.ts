/**
 * Instance-owned local material development loader.
 */

import { type Component, type ComponentMetadata, MaterialSource } from '@easy-editor/core/instance'
import { runInAction } from 'mobx'
import { type KeyedOperation, LatestOperationRegistry, SingleFlight } from '../keyed-operation-coordinator.js'
import { closeOwnedSocket } from '../owned-resource-cleanup.js'
import type { RemoteOperation } from '../resource-scope.js'
import type { DashboardRemoteServices } from '../runtime-services'

export interface LocalMaterialConfig {
  devServerUrl: string
}

export interface MaterialServerInfo {
  name: string
  title?: string
  version: string
  group?: string
  category?: string
  entry: string
  hasComponent: boolean
  hasMeta: boolean
  hasConfigure: boolean
  hasSnippets: boolean
  hmrPort?: number
  wsPath?: string
}

export interface LoadedMaterialModule {
  default?: Component
  component?: Component
  meta?: ComponentMetadata
}

interface MaterialConnection {
  url: string
  componentName: string
  module: LoadedMaterialModule
  ws?: WebSocket
  info: MaterialServerInfo
  reconnect: {
    retries: number
    timer?: ReturnType<typeof setTimeout>
    isReconnecting: boolean
  }
}

interface LocalUrlOperation {
  keyed: KeyedOperation
  scoped: RemoteOperation
  abortScopedOperation: () => void
}

const DEBUG_GROUP = 'DEBUG'
const WS_RECONNECT_CONFIG = {
  maxRetries: 5,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
}

type EventHandler = (payload: unknown) => void

class EventEmitter {
  private readonly events = new Map<string, Set<EventHandler>>()

  on<T>(event: string, handler: (payload: T) => void): () => void {
    const stored = handler as unknown as EventHandler
    const handlers = this.events.get(event) || new Set<EventHandler>()
    handlers.add(stored)
    this.events.set(event, handlers)
    return () => handlers.delete(stored)
  }

  off<T>(event: string, handler: (payload: T) => void): void {
    this.events.get(event)?.delete(handler as unknown as EventHandler)
  }

  protected emit(event: string, payload: unknown): void {
    for (const handler of this.events.get(event) || []) {
      try {
        handler(payload)
      } catch (error) {
        console.error(`[LocalMaterialLoader] Event handler error (${event}):`, error)
      }
    }
  }

  protected clearEvents(): void {
    this.events.clear()
  }
}

export class LocalMaterialLoaderClass extends EventEmitter {
  private readonly connectFlights = new SingleFlight()
  private readonly connections = new Map<string, MaterialConnection>()
  private readonly moduleVersion = new Map<string, number>()
  private readonly operations = new LatestOperationRegistry()
  private readonly pendingSocketClosures = new Set<WebSocket>()
  private cleanupComplete = false
  private disposed = false

  constructor(private readonly services: DashboardRemoteServices) {
    super()
  }

  async connect(config: LocalMaterialConfig): Promise<LoadedMaterialModule> {
    this.assertUsable()
    const normalizedUrl = this.normalizeUrl(config.devServerUrl)
    const existing = this.connections.get(normalizedUrl)
    if (existing) return existing.module
    return this.connectFlights.run(normalizedUrl, () => this.connectOperation(normalizedUrl))
  }

  private async connectOperation(normalizedUrl: string): Promise<LoadedMaterialModule> {
    this.assertUsable()
    const operation = this.beginUrlOperation(normalizedUrl, `connect local material ${normalizedUrl}`)
    let ws: WebSocket | undefined
    let registeredComponentName: string | undefined
    try {
      await this.checkHealth(normalizedUrl, operation.keyed.signal)
      this.assertUrlOperationCurrent(operation)
      this.emit('status', { url: normalizedUrl, status: 'checking' })

      const info = await this.fetchMaterialInfo(normalizedUrl, operation.keyed.signal)
      this.assertUrlOperationCurrent(operation)
      this.emit('status', { url: normalizedUrl, status: 'loading', info })

      const module = await this.loadModule(normalizedUrl, info.entry)
      this.assertUrlOperationCurrent(operation)
      if (!module.meta) throw new Error('Material meta not found in module')

      this.registerMaterial(normalizedUrl, module, operation, componentName => {
        registeredComponentName = componentName
      })
      this.assertUrlOperationCurrent(operation)
      ws = this.setupViteHMR(normalizedUrl, info, () => this.isUrlOperationCurrent(operation))
      this.assertUrlOperationCurrent(operation)

      const connection: MaterialConnection = {
        url: normalizedUrl,
        componentName: module.meta.componentName,
        module,
        ws,
        info,
        reconnect: { retries: 0, isReconnecting: false },
      }
      this.assertUrlOperationCurrent(operation)
      this.connections.set(normalizedUrl, connection)
      this.emit('connected', {
        url: normalizedUrl,
        componentName: module.meta.componentName,
        meta: module.meta,
      })
      if (this.connections.get(normalizedUrl) !== connection) {
        throw new Error(`Local material connection for ${normalizedUrl} was invalidated`)
      }
      return module
    } catch (error) {
      const cleanupFailures: unknown[] = []
      if (ws) {
        try {
          this.closeSocket(ws)
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError)
        }
      }
      if (registeredComponentName) {
        try {
          this.removeOwnedMaterial(normalizedUrl, registeredComponentName)
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError)
        }
      }
      if (this.isUrlOperationCurrent(operation)) this.emit('error', { url: normalizedUrl, error })
      if (cleanupFailures.length) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          `Local material connection cleanup failed: ${normalizedUrl}`,
        )
      }
      throw error
    } finally {
      this.finishUrlOperation(operation)
    }
  }

  disconnect(devServerUrl: string): void {
    const normalizedUrl = this.normalizeUrl(devServerUrl)
    this.operations.invalidate(normalizedUrl)
    this.connectFlights.forget(normalizedUrl)
    const connection = this.connections.get(normalizedUrl)
    if (!connection) return

    const failures: unknown[] = []
    this.connections.delete(normalizedUrl)
    if (connection.reconnect.timer) this.services.scope.clearTimer(connection.reconnect.timer)
    if (connection.ws) {
      try {
        this.closeSocket(connection.ws)
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      runInAction(() => this.removeOwnedMaterial(normalizedUrl, connection.componentName))
    } catch (error) {
      failures.push(error)
    }
    this.emit('disconnected', { url: normalizedUrl, componentName: connection.componentName })
    if (failures.length) throw new AggregateError(failures, `Failed to disconnect local material: ${normalizedUrl}`)
  }

  disconnectAll(): void {
    const failures: unknown[] = []
    for (const url of [...this.connections.keys()]) {
      try {
        this.disconnect(url)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Failed to disconnect one or more local materials')
  }

  getConnections(): Array<{ url: string; componentName: string }> {
    return Array.from(this.connections.values(), connection => ({
      url: connection.url,
      componentName: connection.componentName,
    }))
  }

  isConnected(devServerUrl: string): boolean {
    return this.connections.has(this.normalizeUrl(devServerUrl))
  }

  async refresh(devServerUrl: string): Promise<void> {
    this.assertUsable()
    const normalizedUrl = this.normalizeUrl(devServerUrl)
    const connection = this.connections.get(normalizedUrl)
    if (!connection) throw new Error(`Not connected to ${normalizedUrl}`)
    await this.handleHMRUpdate(normalizedUrl, connection.info, true)
  }

  dispose(): void {
    if (this.cleanupComplete) return
    const failures: unknown[] = []
    if (!this.disposed) {
      this.disposed = true
      this.operations.invalidateAll()
      this.connectFlights.clear()
    }
    try {
      this.disconnectAll()
    } catch (error) {
      failures.push(error)
    }
    for (const socket of [...this.pendingSocketClosures]) {
      try {
        this.closeSocket(socket)
      } catch (error) {
        failures.push(error)
      }
    }
    this.moduleVersion.clear()
    this.clearEvents()
    if (failures.length) throw new AggregateError(failures, 'Local material loader disposal failed')
    this.cleanupComplete = true
  }

  private async checkHealth(url: string, signal: AbortSignal): Promise<void> {
    const endpoint = `${url}/api/health`
    try {
      const response = await this.services.scope.perform(
        { name: url, type: 'fetch', url: endpoint, resourceType: 'material' },
        () => this.services.environment.fetch(endpoint, { method: 'GET', signal }),
      )
      if (!response.ok) throw new Error(`Server responded with status ${response.status}`)
      const data = (await response.json()) as { status?: unknown }
      if (data.status !== 'ok') throw new Error('Server health check failed')
    } catch (error) {
      throw new Error(
        `Cannot connect to dev server at ${url}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private async fetchMaterialInfo(url: string, signal: AbortSignal): Promise<MaterialServerInfo> {
    const endpoint = `${url}/api/material`
    try {
      const response = await this.services.scope.perform(
        { name: url, type: 'fetch', url: endpoint, resourceType: 'material' },
        () => this.services.environment.fetch(endpoint, { method: 'GET', signal }),
      )
      if (!response.ok) throw new Error(`Server responded with status ${response.status}`)
      const info = (await response.json()) as Partial<MaterialServerInfo>
      if (!info.name || !info.version || !info.entry) throw new Error('Invalid material server response')
      return info as MaterialServerInfo
    } catch (error) {
      throw new Error(`Failed to fetch material info: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async loadModule(baseUrl: string, entry: string): Promise<LoadedMaterialModule> {
    const version = (this.moduleVersion.get(baseUrl) || 0) + 1
    this.moduleVersion.set(baseUrl, version)
    const moduleUrl = `${baseUrl}${entry}?t=${Date.now()}&v=${version}`
    try {
      return (await this.services.scope.perform(
        { name: baseUrl, type: 'module', url: moduleUrl, resourceType: 'material' },
        () => this.services.environment.importModule(moduleUrl),
      )) as LoadedMaterialModule
    } catch (error) {
      throw new Error(`Failed to load material module: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private registerMaterial(
    url: string,
    module: LoadedMaterialModule,
    operation: LocalUrlOperation,
    onRegistered?: (componentName: string) => void,
  ): void {
    const meta = module.meta
    if (!meta) throw new Error('Material meta is required')
    const component = module.component || module.default
    const registrationMeta: ComponentMetadata = {
      ...meta,
      group: DEBUG_GROUP,
      configure: meta.configure
        ? {
            ...meta.configure,
            advanced: { ...meta.configure.advanced, view: component },
          }
        : { advanced: { view: component } },
    }

    this.services.scope.perform(
      { name: meta.componentName, type: 'registration', url, resourceType: 'material' },
      () => {
        this.assertUrlOperationCurrent(operation)
        runInAction(() => {
          this.assertMaterialNameAvailable(url, meta.componentName)
          this.services.materials.createComponentMeta(registrationMeta, {
            component,
            extensions: new Map<string, unknown>([
              ['devServerUrl', url],
              ['isLocalDebug', true],
            ]),
            source: MaterialSource.DEBUG,
          })
          onRegistered?.(meta.componentName)
        })
      },
    )
    this.assertUrlOperationCurrent(operation)
  }

  private setupViteHMR(url: string, info: MaterialServerInfo, isOwnerCurrent: () => boolean): WebSocket | undefined {
    try {
      const wsUrl = new URL(info.wsPath || '/ws', url)
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = this.services.scope.perform(
        { name: info.name, type: 'websocket', url: wsUrl.href, resourceType: 'material' },
        () => {
          if (!isOwnerCurrent()) throw new Error(`WebSocket owner for ${url} was invalidated`)
          const socket = new this.services.environment.WebSocket(wsUrl.href)
          try {
            this.services.scope.ownSocket(socket)
          } catch (ownershipError) {
            try {
              socket.close()
            } catch (cleanupError) {
              throw new AggregateError(
                [ownershipError, cleanupError],
                `WebSocket ownership and cleanup both failed for ${url}`,
              )
            }
            throw ownershipError
          }
          if (!isOwnerCurrent()) {
            this.closeSocket(socket)
            throw new Error(`WebSocket owner for ${url} was invalidated`)
          }
          return socket
        },
      )
      if (!isOwnerCurrent()) {
        this.closeSocket(ws)
        return undefined
      }

      ws.onopen = () => {
        const connection = this.connections.get(url)
        if (!this.services.scope.isActive || connection?.ws !== ws) return
        connection.reconnect.retries = 0
        connection.reconnect.isReconnecting = false
        this.emit('ws:connected', { url })
      }
      ws.onmessage = event => {
        if (!this.services.scope.isActive || this.connections.get(url)?.ws !== ws) return
        try {
          const data = JSON.parse(String(event.data)) as { type?: unknown }
          if (data.type === 'update') void this.handleHMRUpdate(url, info)
        } catch {
          // Ignore non-JSON development-server messages.
        }
      }
      ws.onerror = error => {
        if (this.services.scope.isActive && this.connections.get(url)?.ws === ws) {
          this.emit('ws:error', { url, error })
        }
      }
      ws.onclose = () => {
        this.services.scope.releaseSocket(ws)
        if (!this.services.scope.isActive || this.connections.get(url)?.ws !== ws) return
        this.emit('ws:closed', { url })
        this.scheduleReconnect(url, info)
      }
      return ws
    } catch (error) {
      if (this.services.scope.isActive && isOwnerCurrent()) {
        console.warn('[LocalMaterialLoader] Failed to setup HMR:', error)
      }
      return undefined
    }
  }

  private scheduleReconnect(url: string, info: MaterialServerInfo): void {
    const connection = this.connections.get(url)
    if (!connection || connection.reconnect.retries >= WS_RECONNECT_CONFIG.maxRetries) return
    const delay = Math.min(
      WS_RECONNECT_CONFIG.initialDelay * WS_RECONNECT_CONFIG.backoffFactor ** connection.reconnect.retries,
      WS_RECONNECT_CONFIG.maxDelay,
    )
    connection.reconnect.retries += 1
    connection.reconnect.isReconnecting = true
    if (connection.reconnect.timer) this.services.scope.clearTimer(connection.reconnect.timer)
    connection.reconnect.timer = this.services.scope.setTimer(() => {
      const current = this.connections.get(url)
      if (current !== connection) return
      const ws = this.setupViteHMR(
        url,
        info,
        () => this.services.scope.isActive && this.connections.get(url) === connection,
      )
      if (ws && this.connections.get(url) === connection) current.ws = ws
    }, delay)
    this.emit('ws:reconnecting', { url, attempt: connection.reconnect.retries, delay })
  }

  private async handleHMRUpdate(url: string, info: MaterialServerInfo, propagateError = false): Promise<void> {
    if (this.disposed || !this.services.scope.isActive) {
      if (propagateError) throw new Error('Local material loader is disposed')
      return
    }
    const operation = this.beginUrlOperation(url, `refresh local material ${url}`)
    let registeredComponentName: string | undefined
    try {
      const module = await this.loadModule(url, info.entry)
      this.assertUrlOperationCurrent(operation)
      const meta = module.meta
      if (!meta) throw new Error('Material meta not found in refreshed module')
      const connection = this.connections.get(url)
      if (!connection) throw new Error(`Local material connection for ${url} was invalidated`)
      const previousComponentName = connection.componentName
      this.registerMaterial(url, module, operation, componentName => {
        registeredComponentName = componentName
      })
      this.assertUrlOperationCurrent(operation)
      runInAction(() => {
        if (previousComponentName !== meta.componentName) {
          this.removeOwnedMaterial(url, previousComponentName)
        }
      })
      connection.module = module
      connection.componentName = meta.componentName
      this.emit('hmr:update', { url, componentName: meta.componentName, module })
    } catch (error) {
      const failures: unknown[] = [error]
      const connection = this.connections.get(url)
      if (registeredComponentName && connection?.componentName !== registeredComponentName) {
        const componentName = registeredComponentName
        try {
          runInAction(() => this.removeOwnedMaterial(url, componentName))
        } catch (cleanupError) {
          failures.push(cleanupError)
        }
      }
      const failure =
        failures.length === 1 ? error : new AggregateError(failures, `Local material refresh cleanup failed: ${url}`)
      if (this.isUrlOperationCurrent(operation)) this.emit('hmr:error', { url, error: failure })
      if (propagateError) throw failure
    } finally {
      this.finishUrlOperation(operation)
    }
  }

  private beginUrlOperation(url: string, label: string): LocalUrlOperation {
    const scoped = this.services.scope.beginOperation(label)
    const keyed = this.operations.begin(url)
    const abortScopedOperation = () => scoped.abortController.abort()
    keyed.signal.addEventListener('abort', abortScopedOperation, { once: true })
    return { keyed, scoped, abortScopedOperation }
  }

  private isUrlOperationCurrent(operation: LocalUrlOperation): boolean {
    return (
      !this.disposed &&
      this.services.scope.isActive &&
      !operation.scoped.abortController.signal.aborted &&
      this.operations.isCurrent(operation.keyed)
    )
  }

  private assertUrlOperationCurrent(operation: LocalUrlOperation): void {
    this.operations.assertCurrent(operation.keyed)
    this.services.scope.assertCurrent(operation.scoped)
    if (this.disposed) throw new Error('Local material loader is disposed')
  }

  private finishUrlOperation(operation: LocalUrlOperation): void {
    operation.keyed.signal.removeEventListener('abort', operation.abortScopedOperation)
    this.operations.finish(operation.keyed)
    this.services.scope.finishOperation(operation.scoped)
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('Local material loader is disposed')
    this.services.scope.assertActive()
  }

  private closeSocket(ws: WebSocket): void {
    ws.onopen = null
    ws.onmessage = null
    ws.onerror = null
    ws.onclose = null
    this.pendingSocketClosures.add(ws)
    closeOwnedSocket(this.services.scope, ws)
    this.pendingSocketClosures.delete(ws)
  }

  private assertMaterialNameAvailable(url: string, componentName: string): void {
    const existing = this.services.materials.registry.get(componentName)
    if (!existing) return
    const ownerUrl = existing.extensions?.get('devServerUrl')
    if (ownerUrl !== url) {
      throw new Error(
        `Local material component name "${componentName}" is already registered${
          ownerUrl ? ` by ${String(ownerUrl)}` : ''
        }`,
      )
    }
  }

  private removeOwnedMaterial(url: string, componentName: string): boolean {
    const entry = this.services.materials.registry.get(componentName)
    if (entry?.extensions?.get('devServerUrl') !== url) return false
    return this.services.materials.removeComponentMeta(componentName)
  }

  private normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '')
  }
}
