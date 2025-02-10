import babel from '@rollup/plugin-babel'
import nodeResolve from '@rollup/plugin-node-resolve'
import cleanup from 'rollup-plugin-cleanup'
import pkg from './package.json' assert { type: 'json' }

const external = Object.keys(pkg.peerDependencies)

const plugins = [
  nodeResolve({
    extensions: ['.js', '.ts', '.jsx', '.tsx'],
  }),
  babel({
    extensions: ['.js', '.ts', '.jsx', '.tsx'],
    exclude: 'node_modules/**',
    babelrc: false,
    babelHelpers: 'bundled',
    presets: ['@babel/preset-react', '@babel/preset-typescript'],
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
        file: 'dist/cjs/index.js',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/esm/index.js',
        format: 'es',
        sourcemap: true,
      },
      {
        file: 'dist/index.js',
        format: 'es',
      },
    ],
    plugins,
    external,
  },
]
