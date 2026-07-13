import babel from '@rollup/plugin-babel'
import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import cleanup from 'rollup-plugin-cleanup'

export default {
  input: 'test/runtime-entry.ts',
  output: {
    file: '.test-dist/index.js',
    format: 'es',
  },
  plugins: [
    nodeResolve({
      extensions: ['.js', '.ts'],
      browser: true,
      preferBuiltins: true,
    }),
    commonjs(),
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
  ],
  external: [],
}
