import babel from '@rollup/plugin-babel'
import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import cleanup from 'rollup-plugin-cleanup'
import pkg from './package.json' with { type: 'json' }

const external = [...Object.keys(pkg.peerDependencies)]

const plugins = [
  nodeResolve({
    extensions: ['.js', '.ts'],
    browser: true,
  }),
  commonjs(),
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
    external,
  },
]
