/**
 * Rollup Plugins Configuration
 * Rollup 插件配置
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import alias from '@rollup/plugin-alias'
import babel from '@rollup/plugin-babel'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import nodeResolve from '@rollup/plugin-node-resolve'
import terser from '@rollup/plugin-terser'
import type { Plugin as RollupPlugin } from 'rollup'
import cleanup from 'rollup-plugin-cleanup'
import postcss from 'rollup-plugin-postcss'
import type { ResolvedConfig } from '../config/types'
import { DEFAULT_EXTENSIONS } from './constants'

const require = createRequire(import.meta.url)
const presetReact = require.resolve('@babel/preset-react')
const presetTypescript = require.resolve('@babel/preset-typescript')

export interface CreatePluginsOptions {
  config: ResolvedConfig
  /** 是否添加 terser 压缩 */
  minify?: boolean
  /** 当前工作目录 */
  cwd?: string
  /** 将 Node 包解析限制在 cwd；程序化工作区构建启用。 */
  workspaceConfinement?: boolean
}

/**
 * 创建 Rollup 插件配置
 */
export function createPlugins(options: CreatePluginsOptions): RollupPlugin[] {
  const { config, minify = false, cwd = process.cwd(), workspaceConfinement = false } = options
  // 使用 unknown[] 避免第三方插件之间的 Rollup 版本类型冲突
  const plugins: unknown[] = []

  // 路径别名插件
  if (Object.keys(config.alias).length > 0) {
    const entries = Object.entries(config.alias).map(([find, replacement]) => ({
      find,
      replacement: path.resolve(cwd, replacement),
    }))
    plugins.push(alias({ entries }))
  }

  // 模块解析
  plugins.push(
    nodeResolve({
      extensions: DEFAULT_EXTENSIONS,
      rootDir: cwd,
      ...(workspaceConfinement ? { jail: cwd } : {}),
    }),
  )

  // CommonJS 支持
  plugins.push(commonjs())

  // JSON 支持
  plugins.push(json())

  // PostCSS / CSS Modules
  plugins.push(
    postcss({
      modules: {
        generateScopedName: config.css.scopedName,
      },
      autoModules: true,
      minimize: true,
      inject: config.css.mode === 'inject',
      extract: config.css.mode === 'extract' ? config.css.extractFilename : false,
    }),
  )

  // Babel 转译
  plugins.push(
    babel({
      extensions: DEFAULT_EXTENSIONS,
      exclude: 'node_modules/**',
      babelrc: false,
      babelHelpers: 'bundled',
      presets: [
        [presetReact, { runtime: config.jsxRuntime }],
        [presetTypescript, { allowDeclareFields: true }],
      ],
    }),
  )

  // 代码清理
  plugins.push(
    cleanup({
      comments: ['some', /PURE/],
      extensions: ['.js', '.ts'],
    }),
  )

  // 压缩
  if (minify) {
    plugins.push(terser())
  }

  return plugins as RollupPlugin[]
}
