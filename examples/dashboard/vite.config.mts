import path from 'node:path'
import federation from '@originjs/vite-plugin-federation'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        exclude: 'node_modules/**',
        babelrc: false,
        presets: [
          [
            '@babel/preset-typescript',
            {
              allowDeclareFields: true,
            },
          ],
        ],
        plugins: [
          [
            '@babel/plugin-proposal-decorators',
            {
              version: '2023-11',
            },
          ],
        ],
      },
    }),
    federation({
      name: 'dashboard',
      filename: 'remoteEntry.json',
      remotes: {
        materials_audio: 'materials_audio@http://localhost:5001/remoteEntry.js',
      },
      shared: {
        react: { requiredVersion: '^19.0.0' },
        'react-dom': { requiredVersion: '^19.0.0' },
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // 确保使用相同的 React 实例，解决双 React 问题
    dedupe: ['react', 'react-dom'],
  },
  build: {
    target: 'esnext',
  },
})
