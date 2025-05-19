import babel from '@rollup/plugin-babel'
import nodeResolve from '@rollup/plugin-node-resolve'
import { createRequire } from 'node:module'
import cleanup from 'rollup-plugin-cleanup'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

const plugins = [
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
    plugins,
  },
]
