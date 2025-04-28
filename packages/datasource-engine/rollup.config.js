import babel from '@rollup/plugin-babel'
import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import cleanup from 'rollup-plugin-cleanup'
import pkg from './package.json' assert { type: 'json' }

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

const createConfig = (input, outputName) => ({
  input,
  output: [
    {
      file: `dist/cjs/${outputName}.js`,
      format: 'cjs',
      sourcemap: true,
    },
    {
      file: `dist/esm/${outputName}.js`,
      format: 'es',
      sourcemap: true,
    },
    {
      file: `dist/${outputName}.js`,
      format: 'es',
    },
  ],
  plugins,
  external,
})

export default [
  createConfig('src/index.ts', 'index'),
  createConfig('src/runtime/index.ts', 'runtime'),
  createConfig('src/interpret/index.ts', 'interpret'),
  createConfig('src/handlers/fetch.ts', 'handlers/fetch'),
]
