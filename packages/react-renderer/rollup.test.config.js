import baseConfig from './rollup.config.js'

const reactExternals = ['react', 'react-dom', 'react/jsx-runtime', 'mobx-react', 'mobx-react-lite']

export default {
  ...baseConfig[0],
  input: 'test/test-entry.ts',
  output: {
    file: '.test-dist/index.js',
    format: 'es',
  },
  external: id => reactExternals.some(external => id === external || id.startsWith(`${external}/`)),
}
