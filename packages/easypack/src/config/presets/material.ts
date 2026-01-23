/**
 * Material Preset - 物料组件预设
 * 适用于 EasyMaterials 中的独立物料包
 */

import type { EasypackConfig } from '../types'

export const materialPreset: Partial<EasypackConfig> = {
  entry: {
    main: 'src/index.tsx',
    meta: 'src/meta.ts',
    component: 'src/component.tsx',
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
    port: 5001,
    materialApi: true,
  },
}
