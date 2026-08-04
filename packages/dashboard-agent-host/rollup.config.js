import babel from '@rollup/plugin-babel'
import nodeResolve from '@rollup/plugin-node-resolve'
import cleanup from 'rollup-plugin-cleanup'

export default {
  input: 'src/index.mjs',
  output: {
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true,
  },
  plugins: [
    nodeResolve({
      browser: true,
      extensions: ['.js', '.mjs', '.ts', '.tsx'],
    }),
    babel({
      babelHelpers: 'bundled',
      babelrc: false,
      exclude: 'node_modules/**',
      extensions: ['.js', '.mjs', '.ts', '.tsx'],
      presets: [
        ['@babel/preset-react', { runtime: 'automatic' }],
        ['@babel/preset-typescript', { allowDeclareFields: true }],
      ],
    }),
    cleanup({
      comments: ['some', /PURE/],
      extensions: ['.js', '.mjs', '.ts', '.tsx'],
    }),
  ],
}
