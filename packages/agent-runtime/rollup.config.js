import babel from '@rollup/plugin-babel'
import nodeResolve from '@rollup/plugin-node-resolve'
import cleanup from 'rollup-plugin-cleanup'

const createPlugins = () => [
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

const createEntry = name => ({
  input: `src/${name}.ts`,
  output: [
    {
      file: `dist/${name}.js`,
      format: 'es',
      sourcemap: true,
    },
    {
      file: `dist/${name}.cjs`,
      format: 'cjs',
      exports: 'named',
      sourcemap: true,
    },
  ],
  plugins: createPlugins(),
})

export default ['index', 'worker', 'testing'].map(createEntry)
