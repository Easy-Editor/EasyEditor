import babel from '@rollup/plugin-babel'

const plugins = [
  babel({
    extensions: ['.js', '.ts'],
    exclude: 'node_modules/**',
    babelrc: false,
    babelHelpers: 'bundled',
    presets: ['@babel/preset-typescript'],
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
