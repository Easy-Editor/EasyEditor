import { createPlugins } from './rollup.config.js'

export default {
  input: 'test/fixtures/kernel-entry.ts',
  output: {
    file: 'test/dist/kernel.js',
    format: 'es',
  },
  plugins: createPlugins(),
}
