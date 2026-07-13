/**
 * Remote Loaders
 * 远程资源加载器导出
 */

// CDN 提供商
export { CdnProviderManager, DEFAULT_CDN_PROVIDERS, type CdnProvider } from './cdn-provider'

// 版本解析器
export { VersionResolver } from './version-resolver'

// 脚本加载器
export { ScriptLoader, type LoadContext, type ScriptLoadOptions } from './script-loader'

// 物料加载器
export { MaterialLoader, type LoadedMaterial } from './material-loader'

// 设置器加载器
export { SetterLoader, type LoadedSetters } from './setter-loader'

// 本地开发加载器
export {
  LocalMaterialLoaderClass,
  type LocalMaterialConfig,
  type MaterialServerInfo,
  type LoadedMaterialModule,
} from './local-loader'
