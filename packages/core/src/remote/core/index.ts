/**
 * Remote Core Module
 * 远程资源加载核心模块导出（纯类型和错误定义，无浏览器依赖）
 */

// 错误定义
export { RemoteLoadError, RemoteLoadErrorType, type ResourceType } from './errors'

// 类型定义
export type { LoadOptions, LoadProgress, MaterialInfo, SetterInfo } from './types'
export { DEFAULT_TIMEOUT, LoadingStatus } from './types'
