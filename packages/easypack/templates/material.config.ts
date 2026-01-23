/**
 * Material Component Build Configuration
 * 物料组件构建配置模板
 */

import { defineConfig } from '@easy-editor/easypack'

export default defineConfig({
  preset: 'material',

  // globalName 自动从 package.json 的 name 字段推导
  // 例如 @easy-editor/materials-dashboard-bar-chart → EasyEditorMaterialsBarChart
  // 如需自定义，取消下行注释：
  // globalName: 'EasyEditorMaterialsMyComponent',

  // 开发服务器配置
  dev: {
    port: 5001, // 每个物料使用不同端口
  },

  // 以下为可选配置，通常无需修改：

  // 入口文件配置
  // entry: {
  //   main: 'src/index.tsx',
  //   meta: 'src/meta.ts',
  //   component: 'src/component.tsx',
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

  // CSS 配置
  // css: {
  //   scopedName: '[name]__[local]___[hash:base64:5]',
  //   mode: 'inject',
  // },
})
