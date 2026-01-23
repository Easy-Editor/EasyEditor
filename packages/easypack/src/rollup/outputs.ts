/**
 * Rollup Outputs Configuration
 * Rollup 输出配置生成
 */

import type { RollupOptions } from 'rollup'
import type { ResolvedConfig } from '../config/types'
import { createPlugins } from './plugins'
import { capitalize } from './constants'

export type BuildType = 'full' | 'meta' | 'component'

export interface CreateOutputConfigOptions {
  config: ResolvedConfig
  input: string
  type: BuildType
  cwd?: string
}

/**
 * 创建 banner 注释
 */
function createBanner(pkgName: string, version: string, suffix?: string): string {
  const suffixPart = suffix ? ` (${suffix})` : ''
  return `/* ${pkgName} v${version}${suffixPart} */`
}

/**
 * 获取外部依赖列表
 */
function getExternals(config: ResolvedConfig): string[] {
  return config.external.externals
}

/**
 * 获取全局变量映射
 */
function getGlobals(config: ResolvedConfig): Record<string, string> {
  return config.external.globals
}

/**
 * 根据构建类型获取 UMD 名称
 */
function getUmdName(globalName: string, type: BuildType): string {
  switch (type) {
    case 'meta':
      return `${globalName}Meta`
    case 'component':
      return `${globalName}Component`
    default:
      return globalName
  }
}

/**
 * 根据构建类型获取文件前缀
 */
function getFilePrefix(type: BuildType): string {
  switch (type) {
    case 'meta':
      return 'meta'
    case 'component':
      return 'component'
    default:
      return 'index'
  }
}

/**
 * 创建单个入口的所有输出配置
 * minify 决定是否生成压缩版本（true: 只生成压缩版本，false: 只生成非压缩版本）
 */
export function createOutputConfigs(options: CreateOutputConfigOptions): RollupOptions[] {
  const { config, input, type, cwd = process.cwd() } = options
  const configs: RollupOptions[] = []

  const external = getExternals(config)
  const globals = getGlobals(config)
  const umdName = getUmdName(config.globalName, type)
  const filePrefix = getFilePrefix(type)
  const { pkg, output: outputConfig } = config
  const { minify } = outputConfig

  const plugins = createPlugins({ config, minify, cwd })

  // ESM 构建
  if (outputConfig.esm) {
    const filename = minify ? `${filePrefix}.min.esm.js` : `${filePrefix}.esm.js`
    configs.push({
      input,
      output: {
        file: `${outputConfig.dir}/${filename}`,
        format: 'esm',
        sourcemap: outputConfig.sourcemap,
        banner: createBanner(pkg.name, pkg.version, minify ? 'minified' : undefined),
        exports: 'named',
      },
      plugins,
      external,
    })
  }

  // UMD 构建
  if (outputConfig.umd) {
    const filename = minify ? `${filePrefix}.min.js` : `${filePrefix}.js`
    configs.push({
      input,
      output: {
        file: `${outputConfig.dir}/${filename}`,
        format: 'umd',
        name: umdName,
        globals,
        sourcemap: outputConfig.sourcemap,
        banner: createBanner(pkg.name, pkg.version, minify ? 'minified' : undefined),
        exports: 'named',
      },
      plugins,
      external,
    })
  }

  // CJS 构建（仅完整构建）
  if (type === 'full' && outputConfig.cjs) {
    const filename = minify ? `${filePrefix}.min.cjs` : `${filePrefix}.cjs`
    configs.push({
      input,
      output: {
        file: `${outputConfig.dir}/${filename}`,
        format: 'cjs',
        sourcemap: outputConfig.sourcemap,
        exports: 'named',
      },
      plugins,
      external,
    })
  }

  return configs
}
