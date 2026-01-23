/**
 * Setter Library Build Configuration
 * 设置器库构建配置模板
 */

import { defineConfig } from '@easy-editor/easypack'

export default defineConfig({
  preset: 'setter',

  // 设置器全局变量名
  globalName: 'EasyEditorSetters',

  // 以下为可选配置，通常无需修改：

  // 入口文件配置
  // entry: {
  //   main: 'src/index.ts',
  // },

  // 输出配置
  // output: {
  //   dir: 'dist',
  //   umd: true,       // UMD 格式（默认开启）
  //   esm: false,      // ESM 格式
  //   cjs: false,      // CJS 格式
  //   minify: true,    // 压缩输出（默认开启）
  //   types: false,    // TypeScript 类型声明
  //   sourcemap: false,
  // },

  // 外部依赖配置
  // external: {
  //   externals: ['react', 'react-dom', 'react/jsx-runtime'],
  //   globals: { lodash: '_' },
  // },

  // CSS 配置（设置器预设默认提取 CSS）
  // css: {
  //   scopedName: '[name]-[local]-[hash:base64:5]',
  //   mode: 'extract',
  //   extractFilename: 'index.css',
  // },

  // 路径别名
  // alias: {
  //   '@': './src',
  // },
})
