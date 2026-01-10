/**
 * Remote State Module
 * 远程资源状态管理模块导出
 */

// 加载状态管理
export {
  LoadingStateManager,
  LoadingStatus,
  loadingState,
  type ResourceState,
  type StateChangeListener,
} from './loading-state'

// 资源注册表
export { ResourceRegistry, resourceRegistry, type LoadedResource } from './resource-registry'
