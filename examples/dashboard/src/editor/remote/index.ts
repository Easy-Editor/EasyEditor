/**
 * Public Dashboard remote-resource surface. Every value below belongs to the
 * single explicit engine composition in ../runtime; leaf modules export only
 * classes so importing them never creates hidden loaders or caches.
 */

import { remoteResources } from '../runtime'

export * from './loaders'
export * from './managers'
export { remoteMaterialsConfig, remoteSettersConfig } from './config'
export { RemoteLoadError, RemoteLoadErrorType } from '@easy-editor/core/instance'
export { DashboardRemoteResources } from './dashboard-remote-resources'
export type { RemotePackageLoadFailure, RemotePackageLoadResult } from './remote-load-batch.js'

export const cdnProviderManager = remoteResources.cdnProviderManager
export const localLoader = remoteResources.localLoader
export const materialLoader = remoteResources.materialLoader
export const materialManager = remoteResources.materialManager
export const scriptLoader = remoteResources.scriptLoader
export const setterLoader = remoteResources.setterLoader
export const setterManager = remoteResources.setterManager
export const versionResolver = remoteResources.versionResolver

export const loadRemoteMaterialsMeta = () => remoteResources.loadRemoteMaterialsMeta()
export const loadRemoteSetters = () => remoteResources.loadRemoteSetters()
export const loadAllRemoteResources = () => remoteResources.loadAllRemoteResources()
export const waitForSetters = (timeout = 30000) => remoteResources.waitForSetters(timeout)
export const waitForAllResources = (timeout = 30000) => remoteResources.waitForAllResources(timeout)
