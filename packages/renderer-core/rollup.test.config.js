import baseConfig from './rollup.config.js'

export default {
  ...baseConfig[0],
  output: {
    file: '.test-dist/index.js',
    format: 'es',
  },
  external: [],
}
