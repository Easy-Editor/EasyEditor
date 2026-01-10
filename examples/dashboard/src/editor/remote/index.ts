/**
 * Remote Module
 * 远程资源模块统一导出
 */

import { loadingState, RemoteLoadError } from '@easy-editor/core'
import { remoteMaterialsConfig, remoteSettersConfig } from './config'
import { materialManager, setterManager } from './managers'

// 导出加载器
export * from './loaders'

// 导出管理器
export * from './managers'

// 导出配置
export { remoteMaterialsConfig, remoteSettersConfig } from './config'

// 重新导出 core 中的错误类型
export { RemoteLoadError, RemoteLoadErrorType } from '@easy-editor/core'

/**
 * 加载远程物料元数据
 */
export async function loadRemoteMaterialsMeta(): Promise<void> {
  if (remoteMaterialsConfig.length === 0) {
    return
  }

  console.log(`[Remote] Loading ${remoteMaterialsConfig.length} remote material metas...`)
  await materialManager.loadMetaMultiple(remoteMaterialsConfig)
}

/**
 * 加载远程设置器
 */
export async function loadRemoteSetters(): Promise<void> {
  if (remoteSettersConfig.length === 0) {
    return
  }

  console.log(`[Remote] Loading ${remoteSettersConfig.length} remote setter packages...`)
  await setterManager.loadMultiple(remoteSettersConfig)
}

/**
 * 加载所有远程资源
 */
export async function loadAllRemoteResources(): Promise<{
  materials: { succeeded: number; failed: number }
  setters: { succeeded: number; failed: number }
}> {
  const [materialsResult, settersResult] = await Promise.all([
    materialManager.loadMetaMultiple(remoteMaterialsConfig),
    setterManager.loadMultiple(remoteSettersConfig),
  ])

  return {
    materials: { succeeded: materialsResult.succeeded, failed: materialsResult.failed },
    setters: { succeeded: settersResult.succeeded, failed: settersResult.failed },
  }
}

/**
 * 等待设置器加载完成
 */
export async function waitForSetters(timeout = 30000): Promise<void> {
  return loadingState.waitForType('setter', timeout)
}

/**
 * 等待所有远程资源加载完成
 */
export async function waitForAllResources(timeout = 30000): Promise<void> {
  return loadingState.waitForAll(timeout)
}
