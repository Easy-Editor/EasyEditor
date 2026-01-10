/**
 * Remote Loaders
 * 远程资源加载器导出
 */

// CDN 提供商
export { CdnProviderManager, cdnProviderManager, DEFAULT_CDN_PROVIDERS, type CdnProvider } from './cdn-provider'

// 版本解析器
export { VersionResolver, versionResolver } from './version-resolver'

// 脚本加载器
export { ScriptLoader, scriptLoader, type LoadContext, type ScriptLoadOptions } from './script-loader'

// 物料加载器
export { MaterialLoader, materialLoader, type LoadedMaterial } from './material-loader'

// 设置器加载器
export { SetterLoader, setterLoader, type LoadedSetters } from './setter-loader'

// 本地开发加载器
export { LocalLoader, localLoader, type LocalLoaderConfig } from './local-loader'
