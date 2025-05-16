import babel from '@rollup/plugin-babel'
import nodeResolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import cleanup from 'rollup-plugin-cleanup'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')
const __dirname = dirname(fileURLToPath(import.meta.url))

const plugins = [
  replace({
    _EASY_EDITOR_VERSION_: pkg.version,
    preventAssignment: true,
    delimiters: ['', ''],
  }),
  nodeResolve({
    extensions: ['.js', '.ts'],
    browser: true,
  }),
  babel({
    extensions: ['.js', '.ts'],
    exclude: 'node_modules/**',
    babelrc: false,
    babelHelpers: 'bundled',
    presets: ['@babel/preset-typescript'],
    plugins: [
      [
        '@babel/plugin-proposal-decorators',
        {
          version: '2023-11',
        },
      ],
    ],
  }),
  cleanup({
    comments: ['some', /PURE/],
    extensions: ['.js', '.ts'],
  }),
]

export default [
  // core
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'es',
      },
      {
        file: 'dist/index.cjs',
        format: 'cjs',
      },
    ],
    plugins: plugins,
  },
  // engine
  {
    input: 'engine/src/index.ts',
    output: [
      {
        file: 'engine/dist/index.js',
        format: 'es',
        paths: {
          '../..': '../../dist/index.js',
          '@easy-editor/core': '../../dist/index.js',
        },
      },
      {
        file: 'engine/dist/index.cjs',
        format: 'cjs',
        paths: {
          '../..': '../../dist/index.cjs',
          '@easy-editor/core': '../../dist/index.cjs',
        },
      },
    ],
    plugins: [
      replace({
        _EASY_EDITOR_ENGINE_VERSION_: pkg.version,
        preventAssignment: true,
        delimiters: ['', ''],
      }),
      ...plugins,
    ],
    // 关键改变：使用精确的匹配来确定外部模块
    external: id => {
      // 处理相对路径 '../..'
      if (id === '../..') return true
      // 处理包名 '@easy-editor/core'
      if (id === '@easy-editor/core') return true

      // 添加其他可能的外部依赖
      if (id.startsWith('node:')) return true
      if (['mobx'].includes(id)) return true

      return false
    },
  },
]
