import babel from '@rollup/plugin-babel'
import nodeResolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import cleanup from 'rollup-plugin-cleanup'
import pkg from './package.json' assert { type: 'json' }

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
    _EASY_EDITOR_DEV_: isDev,
    _EASY_EDITOR_VERSION_: pkg.version,
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
  },
]
