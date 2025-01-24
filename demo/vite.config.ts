import babel from '@rollup/plugin-babel'
import react from '@vitejs/plugin-react'
import ReactComponentName from 'react-scan/react-component-name/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // TODO: 暂时需要 babel 插件，因为需要联调 @easy-editor/core 的代码，会用到装饰器内容
    babel({
      extensions: ['.js', '.ts', '.jsx', '.tsx'],
      exclude: 'node_modules/**',
      babelrc: false,
      babelHelpers: 'bundled',
      presets: ['@babel/preset-typescript'],
      plugins: [
        [
          '@babel/plugin-proposal-decorators',
          {
            version: '2023-11',
          },
        ],
      ],
    }),
    react(),
    ReactComponentName({}),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
