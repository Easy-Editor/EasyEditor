import babel from '@rollup/plugin-babel'
import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import cleanup from 'rollup-plugin-cleanup'
import postcss from 'rollup-plugin-postcss'
import pkg from './package.json' assert { type: 'json' }

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

const replaceDev = isDev =>
  replace({
    '"_EASY_EDITOR_DEV_"': isDev,
    preventAssignment: true,
    delimiters: ['', ''],
  })

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/cjs/index.js',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/cjs/index.production.js',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/esm/index.js',
        format: 'es',
        sourcemap: true,
      },
      {
        file: 'dist/esm/index.production.js',
        format: 'es',
        sourcemap: true,
      },
      {
        file: 'dist/index.js',
        format: 'es',
      },
    ],
    plugins: [replaceDev(false)].concat(plugins),
    external,
  },
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/cjs/index.development.js',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/esm/index.development.js',
        format: 'es',
        sourcemap: true,
      },
    ],
    plugins: [replaceDev(true)].concat(plugins),
    external,
  },
]
