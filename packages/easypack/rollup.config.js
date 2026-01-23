import nodeResolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import babel from '@rollup/plugin-babel'
import cleanup from 'rollup-plugin-cleanup'

const external = [
  // Node built-ins
  'node:fs',
  'node:path',
  'node:url',
  'node:http',
  'fs',
  'path',
  'url',
  // Dependencies (will be installed by users)
  '@clack/prompts',
  '@rollup/plugin-alias',
  '@rollup/plugin-babel',
  '@rollup/plugin-commonjs',
  '@rollup/plugin-json',
  '@rollup/plugin-node-resolve',
  '@rollup/plugin-terser',
  '@vitejs/plugin-react',
  'esbuild',
  'mri',
  'picocolors',
  'rollup',
  'rollup-plugin-cleanup',
  'rollup-plugin-postcss',
  'vite',
  'ws',
  // Peer dependencies
  '@babel/core',
  '@babel/preset-react',
  '@babel/preset-typescript',
]

const plugins = [
  nodeResolve({
    extensions: ['.js', '.ts'],
  }),
  commonjs(),
  json(),
  babel({
    extensions: ['.js', '.ts'],
    exclude: 'node_modules/**',
    babelrc: false,
    babelHelpers: 'bundled',
    presets: [['@babel/preset-typescript', { allowDeclareFields: true }]],
  }),
  cleanup({
    comments: ['some', /PURE/],
    extensions: ['.js', '.ts'],
  }),
]

export default [
  // 库入口 (API 使用)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'esm',
      sourcemap: true,
    },
    plugins,
    external,
  },
  // CLI 入口
  {
    input: 'src/bin.ts',
    output: {
      file: 'dist/bin.js',
      format: 'esm',
      sourcemap: true,
      banner: '#!/usr/bin/env node',
    },
    plugins,
    external,
  },
]
