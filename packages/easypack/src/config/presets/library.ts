/**
 * Library Preset - 通用库预设
 * 适用于普通的 React 组件库
 */

import type { EasypackConfig } from '../types'

export const libraryPreset: Partial<EasypackConfig> = {
  entry: {
    main: 'src/index.ts',
  },
  output: {
    dir: 'dist',
    umd: true,
    minify: true,
  },
  css: {
    scopedName: '[name]__[local]___[hash:base64:5]',
    mode: 'inject',
  },
  jsxRuntime: 'automatic',
  dev: {
    port: 5000,
    materialApi: false,
  },
}
