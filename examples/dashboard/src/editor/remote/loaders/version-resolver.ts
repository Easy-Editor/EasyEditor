/**
 * Instance-owned NPM version resolver.
 */

import { RemoteLoadError, RemoteLoadErrorType } from '@easy-editor/core/instance'
import type { DashboardRemoteServices } from '../runtime-services'

interface RegistryDocument {
  'dist-tags'?: Record<string, string>
  versions?: Record<string, unknown>
}

export class VersionResolver {
  private readonly cache = new Map<string, string>()

  constructor(private readonly services: DashboardRemoteServices) {}

  async resolve(packageName: string, version: string): Promise<string> {
    const operation = this.services.scope.beginOperation(`resolve ${packageName}@${version}`)
    try {
      const cacheKey = `${packageName}@${version}`
      const cached = this.cache.get(cacheKey)
      if (cached) return cached

      if (this.isConcreteVersion(version) || version === 'latest' || version === 'stable') {
        this.cache.set(cacheKey, version)
        return version
      }

      const resolved = await this.resolveFromRegistry(packageName, version)
      this.services.scope.assertCurrent(operation)
      this.cache.set(cacheKey, resolved)
      return resolved
    } catch (error) {
      if (!this.services.scope.isActive) throw error
      console.warn(`[VersionResolver] Failed to resolve version, using "${version}" directly:`, error)
      this.services.scope.assertCurrent(operation)
      const cacheKey = `${packageName}@${version}`
      this.cache.set(cacheKey, version)
      return version
    } finally {
      this.services.scope.finishOperation(operation)
    }
  }

  async getVersionList(packageName: string): Promise<string[]> {
    const operation = this.services.scope.beginOperation(`resolve versions for ${packageName}`)
    const url = `https://registry.npmjs.org/${packageName}`
    try {
      const response = await this.services.scope.perform(
        { name: packageName, type: 'fetch', url, resourceType: 'material' },
        () => this.services.environment.fetch(url, { signal: operation.abortController.signal }),
      )
      this.services.scope.assertCurrent(operation)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as RegistryDocument
      this.services.scope.assertCurrent(operation)
      return Object.keys(data.versions || {}).reverse()
    } catch (error) {
      throw RemoteLoadError.create(
        RemoteLoadErrorType.NETWORK_ERROR,
        packageName,
        'material',
        `Failed to fetch version list: ${error instanceof Error ? error.message : String(error)}`,
        error,
      )
    } finally {
      this.services.scope.finishOperation(operation)
    }
  }

  clearCache(packageName?: string): void {
    if (!packageName) {
      this.cache.clear()
      return
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${packageName}@`)) this.cache.delete(key)
    }
  }

  dispose(): void {
    this.cache.clear()
  }

  private isConcreteVersion(version: string): boolean {
    return /^\d+\.\d+\.\d+/.test(version)
  }

  private async resolveFromRegistry(packageName: string, version: string): Promise<string> {
    const operation = this.services.scope.beginOperation(`resolve ${packageName}@${version}`)
    const url = `https://registry.npmjs.org/${packageName}`
    try {
      const response = await this.services.scope.perform(
        { name: packageName, type: 'fetch', url, resourceType: 'material' },
        () => this.services.environment.fetch(url, { signal: operation.abortController.signal }),
      )
      this.services.scope.assertCurrent(operation)

      if (!response.ok) {
        if (response.status === 404) {
          throw RemoteLoadError.create(
            RemoteLoadErrorType.PACKAGE_NOT_FOUND,
            packageName,
            'material',
            `Package not found: ${packageName}`,
          )
        }
        throw RemoteLoadError.create(
          RemoteLoadErrorType.NETWORK_ERROR,
          packageName,
          'material',
          `HTTP ${response.status}: ${response.statusText}`,
        )
      }

      const data = (await response.json()) as RegistryDocument
      this.services.scope.assertCurrent(operation)
      const distTags = data['dist-tags'] || {}
      const versions = Object.keys(data.versions || {})
      return distTags[version] || distTags.latest || versions.at(-1) || version
    } finally {
      this.services.scope.finishOperation(operation)
    }
  }
}
