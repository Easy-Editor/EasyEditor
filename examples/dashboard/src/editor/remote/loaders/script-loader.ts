/**
 * Instance-owned dynamic script/style loader with CDN fallback.
 */

import { DEFAULT_TIMEOUT, RemoteLoadError, RemoteLoadErrorType, type ResourceType } from '@easy-editor/core/instance'
import { removeOwnedNodeForSettlement } from '../owned-resource-cleanup.js'
import type { DashboardRemoteServices } from '../runtime-services'
import type { CdnProviderManager } from './cdn-provider'

export interface LoadContext {
  requestId: string
  cdnIndex: number
  triedCdns: Set<string>
}

export interface ScriptLoadOptions {
  timeout?: number
  crossOrigin?: string
  async?: boolean
}

const safeId = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '-')

export class ScriptLoader {
  private readonly loadedCSS = new Set<string>()
  private readonly loadedScripts = new Set<string>()

  constructor(
    private readonly cdnManager: CdnProviderManager,
    private readonly services: DashboardRemoteServices,
  ) {}

  createContext(requestId: string): LoadContext {
    return { requestId, cdnIndex: 0, triedCdns: new Set() }
  }

  async loadWithFallback(
    pkg: string,
    version: string,
    file: string,
    context: LoadContext,
    resourceType: ResourceType,
    options?: ScriptLoadOptions,
  ): Promise<void> {
    this.services.scope.assertActive()
    const provider = this.cdnManager.getProvider(context.cdnIndex)
    if (!provider) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.CDN_ALL_FAILED,
        pkg,
        resourceType,
        `All CDN providers failed for: ${pkg}@${version}/${file}`,
      )
    }

    context.triedCdns.add(provider.name)
    const url = this.cdnManager.buildUrl(pkg, version, file, context.cdnIndex)
    const resourceId = `${pkg}@${version}-${file.replace(/[/.]/g, '-')}`

    try {
      await this.loadScript(url, resourceId, resourceType, options)
    } catch (error) {
      if (!this.services.scope.isActive) throw error
      const nextCdnIndex = context.cdnIndex + 1
      if (nextCdnIndex < this.cdnManager.getProviderCount()) {
        context.cdnIndex = nextCdnIndex
        console.warn(`[ScriptLoader] Fallback to CDN: ${this.cdnManager.getProvider(nextCdnIndex)?.name}`)
        return this.loadWithFallback(pkg, version, file, context, resourceType, options)
      }
      throw RemoteLoadError.create(
        RemoteLoadErrorType.CDN_ALL_FAILED,
        pkg,
        resourceType,
        `All CDN providers failed for: ${pkg}@${version}/${file}`,
        error,
      )
    }
  }

  async loadCSS(
    pkg: string,
    version: string,
    file: string,
    context: LoadContext,
    resourceType: ResourceType,
    options?: Pick<ScriptLoadOptions, 'timeout'>,
  ): Promise<void> {
    this.services.scope.assertActive()
    const cssKey = `${pkg}@${version}-${file.replace(/[/.]/g, '-')}`
    if (this.loadedCSS.has(cssKey)) return

    const url = this.cdnManager.buildUrl(pkg, version, file, context.cdnIndex)
    const operation = this.services.scope.beginOperation(`load stylesheet ${cssKey}`)

    try {
      await new Promise<void>((resolve, reject) => {
        let link: HTMLLinkElement | undefined
        let settled = false
        const finish = (error?: unknown, remove = false) => {
          if (settled) return
          settled = true
          operation.abortController.signal.removeEventListener('abort', onAbort)
          this.services.scope.clearTimer(timeoutId)
          this.services.scope.finishOperation(operation)
          if (link) {
            link.onload = null
            link.onerror = null
          }
          const settlementError =
            remove && link ? removeOwnedNodeForSettlement(this.services.scope, link, error) : error
          if (settlementError !== undefined) reject(settlementError)
          else resolve()
        }
        const onAbort = () => finish(new Error(`Stylesheet load aborted: ${url}`), true)
        const timeoutId = this.services.scope.setTimer(
          () => finish(RemoteLoadError.create(RemoteLoadErrorType.TIMEOUT, cssKey, resourceType, url), true),
          options?.timeout ?? DEFAULT_TIMEOUT,
        )

        operation.abortController.signal.addEventListener('abort', onAbort, { once: true })
        try {
          this.services.scope.perform({ name: cssKey, type: 'style', url, resourceType }, () => {
            link = this.services.environment.document.createElement('link')
            link.rel = 'stylesheet'
            link.href = url
            link.id = `easy-editor-${this.services.instanceId}-css-${safeId(cssKey)}`
            link.dataset.easyEditorOwner = this.services.instanceId
            link.onload = () => {
              try {
                this.services.scope.assertCurrent(operation)
                this.loadedCSS.add(cssKey)
                finish()
              } catch (error) {
                finish(error, true)
              }
            }
            link.onerror = () => finish(new Error(`Stylesheet load failed: ${url}`), true)
            this.services.scope.ownNode(link)
            this.services.environment.document.head.appendChild(link)
          })
        } catch (error) {
          finish(error, true)
        }
      })
    } catch (error) {
      this.services.scope.finishOperation(operation)
      throw error
    }
  }

  isLoaded(id: string): boolean {
    return this.loadedScripts.has(id)
  }

  isCSSLoaded(id: string): boolean {
    return this.loadedCSS.has(id)
  }

  clearLoadedRecords(): void {
    this.loadedScripts.clear()
    this.loadedCSS.clear()
  }

  dispose(): void {
    this.clearLoadedRecords()
  }

  private async loadScript(
    url: string,
    id: string,
    resourceType: ResourceType,
    options?: ScriptLoadOptions,
  ): Promise<void> {
    if (this.loadedScripts.has(id)) return

    const operation = this.services.scope.beginOperation(`load script ${id}`)

    try {
      await new Promise<void>((resolve, reject) => {
        let script: HTMLScriptElement | undefined
        let settled = false
        const finish = (error?: unknown, remove = false) => {
          if (settled) return
          settled = true
          operation.abortController.signal.removeEventListener('abort', onAbort)
          this.services.scope.clearTimer(timeoutId)
          this.services.scope.finishOperation(operation)
          if (script) {
            script.onload = null
            script.onerror = null
          }
          const settlementError =
            remove && script ? removeOwnedNodeForSettlement(this.services.scope, script, error) : error
          if (settlementError !== undefined) reject(settlementError)
          else resolve()
        }
        const onAbort = () =>
          finish(RemoteLoadError.create(RemoteLoadErrorType.NETWORK_ERROR, id, resourceType, 'Load aborted'), true)
        const timeoutId = this.services.scope.setTimer(
          () =>
            finish(RemoteLoadError.create(RemoteLoadErrorType.TIMEOUT, id, resourceType, `Load timeout: ${url}`), true),
          options?.timeout ?? DEFAULT_TIMEOUT,
        )

        operation.abortController.signal.addEventListener('abort', onAbort, { once: true })
        try {
          this.services.scope.perform({ name: id, type: 'script', url, resourceType }, () => {
            script = this.services.environment.document.createElement('script')
            script.src = url
            script.id = `easy-editor-${this.services.instanceId}-script-${safeId(id)}`
            script.async = options?.async ?? true
            script.crossOrigin = options?.crossOrigin ?? 'anonymous'
            script.dataset.easyEditorOwner = this.services.instanceId
            script.onload = () => {
              try {
                this.services.scope.assertCurrent(operation)
                this.loadedScripts.add(id)
                finish()
              } catch (error) {
                finish(error, true)
              }
            }
            script.onerror = () =>
              finish(
                RemoteLoadError.create(
                  RemoteLoadErrorType.SCRIPT_LOAD_FAILED,
                  id,
                  resourceType,
                  `Failed to load script: ${url}`,
                ),
                true,
              )
            this.services.scope.ownNode(script)
            this.services.environment.document.head.appendChild(script)
          })
        } catch (error) {
          finish(error, true)
        }
      })
    } catch (error) {
      this.services.scope.finishOperation(operation)
      throw error
    }
  }
}
