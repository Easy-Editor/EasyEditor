import { createRequire } from 'module'
import babel from '@rollup/plugin-babel'
import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import cleanup from 'rollup-plugin-cleanup'
import postcss from 'rollup-plugin-postcss'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

const external = [
  ...Object.keys(pkg.peerDependencies),
  'mobx-react-lite',
  'mobx-react',
  'mobx',
  'react/jsx-runtime',
  'react-dom/client',
]

const plugins = [
  nodeResolve({
    extensions: ['.js', '.ts', '.jsx', '.tsx'],
  }),
  commonjs(),
  postcss({
    modules: false,
    extract: false,
    minimize: true,
    sourceMap: true,
  }),
  babel({
    extensions: ['.js', '.ts', '.jsx', '.tsx'],
    exclude: 'node_modules/**',
    babelrc: false,
    babelHelpers: 'bundled',
    presets: [
      ['@babel/preset-react', { runtime: 'automatic' }],
      [
        '@babel/preset-typescript',
        {
          allowDeclareFields: true,
        },
      ],
    ],
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
    plugins,
    external,
  },
]
