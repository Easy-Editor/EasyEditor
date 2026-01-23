/**
 * Setter Preset - 设置器预设
 * 适用于 EasySetters 统一设置器包
 */

import type { EasypackConfig } from '../types'

export const setterPreset: Partial<EasypackConfig> = {
  entry: {
    main: 'src/index.ts',
  },
  output: {
    dir: 'dist',
    umd: true,
    minify: true,
  },
  css: {
    scopedName: '[name]-[local]-[hash:base64:5]',
    mode: 'extract',
    extractFilename: 'index.css',
  },
  jsxRuntime: 'classic',
  alias: {
    '@': './src',
  },
  dev: {
    port: 5002,
    materialApi: false,
  },
}
