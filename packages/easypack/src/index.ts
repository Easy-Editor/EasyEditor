/**
 * @easy-editor/easypack
 * Build and dev tools for EasyEditor ecosystem
 */

// CLI 入口
export { cli } from './cli'

// 配置相关
export { defineConfig, loadConfig } from './config'
export type {
  EasypackConfig,
  BuildToolsConfig,
  ResolvedConfig,
  Preset,
  EntryConfig,
  OutputConfig,
  ExternalConfig,
  CssConfig,
  DevConfig,
  CssMode,
  JsxRuntime,
} from './config/types'

// 预设
export { materialPreset, setterPreset, libraryPreset, getPreset } from './config/presets'

// 默认配置
export {
  DEFAULT_ENTRY,
  DEFAULT_OUTPUT,
  DEFAULT_CSS,
  DEFAULT_DEV,
  DEFAULT_EXTERNALS,
  DEFAULT_GLOBALS,
} from './config/defaults'

// Rollup 相关
export { createRollupConfig } from './rollup'
export { createPlugins } from './rollup/plugins'
export { createOutputConfigs } from './rollup/outputs'
export { DEFAULT_EXTENSIONS } from './rollup/constants'

// Vite 相关
export { createViteConfig } from './vite'
export { externalDepsPlugin, materialDevPlugin } from './vite/plugins'
export type { ExternalDepsOptions, MaterialDevPluginOptions } from './vite/plugins'
