import { createRequire } from 'node:module'
import babel from '@rollup/plugin-babel'
import nodeResolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import cleanup from 'rollup-plugin-cleanup'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

const createPlugins = () => [
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
    plugins: createPlugins(),
  },
  {
    input: 'src/agent-channel.ts',
    output: [
      {
        file: 'dist/agent-channel.js',
        format: 'es',
      },
      {
        file: 'dist/agent-channel.cjs',
        format: 'cjs',
      },
    ],
    plugins: createPlugins(),
  },
]
