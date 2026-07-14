import { createRequire } from 'node:module'
import babel from '@rollup/plugin-babel'
import nodeResolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import cleanup from 'rollup-plugin-cleanup'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

export const createPlugins = () => [
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
  {
    input: {
      agent: 'src/agent.ts',
      'agent-channel': 'src/agent-channel.ts',
      index: 'src/index.ts',
      instance: 'src/instance.ts',
    },
    output: [
      {
        chunkFileNames: 'chunks/[name]-[hash].js',
        dir: 'dist',
        entryFileNames: '[name].js',
        format: 'es',
      },
      {
        chunkFileNames: 'chunks/[name]-[hash].cjs',
        dir: 'dist',
        entryFileNames: '[name].cjs',
        exports: 'named',
        format: 'cjs',
      },
    ],
    plugins: createPlugins(),
  },
]
