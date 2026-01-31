/**
 * Default Configuration
 * 默认配置和配置合并逻辑
 */

import { getPreset } from './presets'
import type { EasypackConfig, ResolvedConfig } from './types'

/**
 * 默认的外部依赖
 */
export const DEFAULT_EXTERNALS = ['react', 'react-dom', 'react/jsx-runtime']

/**
 * 默认的全局变量映射
 */
export const DEFAULT_GLOBALS: Record<string, string> = {
  react: 'React',
  'react-dom': 'ReactDOM',
  'react/jsx-runtime': 'jsxRuntime',
}

/**
 * 默认入口配置
 */
export const DEFAULT_ENTRY = {
  main: 'src/index.ts',
  meta: 'src/meta.ts',
  component: 'src/component.tsx',
} as const

/**
 * 默认输出配置
 */
export const DEFAULT_OUTPUT = {
  dir: 'dist',
  esm: false,
  cjs: false,
  umd: true,
  minify: true,
  sourcemap: false,
  types: false,
} as const

/**
 * 默认 CSS 配置
 */
export const DEFAULT_CSS = {
  scopedName: '[name]__[local]___[hash:base64:5]',
  mode: 'inject' as const,
  extractFilename: 'index.css',
}

/**
 * 默认开发服务器配置
 */
export const DEFAULT_DEV = {
  port: 5001,
  materialApi: true,
} as const

/**
 * 从包名推导全局变量名
 *
 * @example
 * '@easy-editor/materials-dashboard-bar-chart' → 'EasyEditorMaterialsBarChart'
 * '@easy-editor/setters' → 'EasyEditorSetters'
 */
export function deriveGlobalName(pkgName: string): string {
  // 移除 @scope/ 前缀
  const withoutScope = pkgName.replace(/^@[^/]+\//, '')

  // 特殊处理：materials-dashboard-xxx → MaterialsXxx
  if (withoutScope.startsWith('materials-dashboard-')) {
    const componentName = withoutScope.replace('materials-dashboard-', '')
    return `EasyEditorMaterials${toPascalCase(componentName)}`
  }

  // 通用处理：转为 PascalCase
  return `EasyEditor${toPascalCase(withoutScope)}`
}

function toPascalCase(str: string): string {
  return str
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/**
 * 深度合并两个对象
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      ) as T[keyof T]
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T]
    }
  }

  return result
}

/**
 * 解析并合并配置
 */
export function resolveConfig(userConfig: EasypackConfig, pkg: { name: string; version: string }): ResolvedConfig {
  // 获取预设配置
  const presetConfig = getPreset(userConfig.preset)

  // 合并用户配置和预设配置
  const merged = deepMerge(presetConfig, userConfig)

  // 合并 externals：默认值 + external.externals + rollup.external
  const baseExternals = merged.external?.externals || DEFAULT_EXTERNALS
  const rollupExternals = merged.rollup?.external || []
  const mergedExternals = [...new Set([...baseExternals, ...rollupExternals])]

  // 合并 globals：默认值 + external.globals + rollup.output.globals
  const mergedGlobals = {
    ...DEFAULT_GLOBALS,
    ...merged.external?.globals,
    ...merged.rollup?.output?.globals,
  }

  // 构建完整的解析配置
  const resolved: ResolvedConfig = {
    preset: userConfig.preset,
    globalName: merged.globalName || deriveGlobalName(pkg.name),
    entry: {
      main: merged.entry?.main || DEFAULT_ENTRY.main,
      meta: merged.entry?.meta || DEFAULT_ENTRY.meta,
      component: merged.entry?.component || DEFAULT_ENTRY.component,
    },
    output: {
      dir: merged.output?.dir || DEFAULT_OUTPUT.dir,
      esm: merged.output?.esm ?? DEFAULT_OUTPUT.esm,
      cjs: merged.output?.cjs ?? DEFAULT_OUTPUT.cjs,
      umd: merged.output?.umd ?? DEFAULT_OUTPUT.umd,
      minify: merged.output?.minify ?? DEFAULT_OUTPUT.minify,
      sourcemap: merged.output?.sourcemap ?? DEFAULT_OUTPUT.sourcemap,
      types: merged.output?.types ?? DEFAULT_OUTPUT.types,
    },
    external: {
      externals: mergedExternals,
      globals: mergedGlobals,
    },
    css: {
      scopedName: merged.css?.scopedName || DEFAULT_CSS.scopedName,
      mode: merged.css?.mode || DEFAULT_CSS.mode,
      extractFilename: merged.css?.extractFilename || DEFAULT_CSS.extractFilename,
    },
    jsxRuntime: merged.jsxRuntime || 'automatic',
    alias: merged.alias || {},
    dev: {
      port: merged.dev?.port || DEFAULT_DEV.port,
      materialApi: merged.dev?.materialApi ?? DEFAULT_DEV.materialApi,
    },
    vitePlugins: merged.vitePlugins || [],
    pkg,
  }

  return resolved
}
