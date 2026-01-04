/**
 * Material Loaders
 * 物料加载器模块统一导出
 */

// CDN 加载器
export {
  CdnLoadError,
  CdnLoadErrorType,
  cdnLoader,
  type LoadedMaterial,
  type LoadOptions,
  type MaterialInfo,
} from './cdn-loader'

// 本地调试加载器
export {
  localLoader,
  LocalMaterialLoaderClass,
  type LocalMaterialConfig,
  type LoadedMaterialModule,
  type MaterialServerInfo,
} from './local-loader'

// 远程物料管理器
export {
  remoteMaterialManager,
  RemoteMaterialManagerClass,
  type RemoteMaterialConfig,
} from './remote-manager'

// 配置
export { loadRemoteMaterialsMeta, remoteMaterialsConfig } from './config'
