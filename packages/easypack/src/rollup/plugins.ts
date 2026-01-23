/**
 * Rollup Plugins Configuration
 * Rollup 插件配置
 */

import babel from '@rollup/plugin-babel'
import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import json from '@rollup/plugin-json'
import alias from '@rollup/plugin-alias'
import cleanup from 'rollup-plugin-cleanup'
import postcss from 'rollup-plugin-postcss'
import terser from '@rollup/plugin-terser'
import type { Plugin as RollupPlugin } from 'rollup'
import type { ResolvedConfig } from '../config/types'
import { DEFAULT_EXTENSIONS } from './constants'
import path from 'node:path'

export interface CreatePluginsOptions {
  config: ResolvedConfig
  /** 是否添加 terser 压缩 */
  minify?: boolean
  /** 当前工作目录 */
  cwd?: string
}

/**
 * 创建 Rollup 插件配置
 */
export function createPlugins(options: CreatePluginsOptions): RollupPlugin[] {
  const { config, minify = false, cwd = process.cwd() } = options
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
        ['@babel/preset-react', { runtime: config.jsxRuntime }],
        ['@babel/preset-typescript', { allowDeclareFields: true }],
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
