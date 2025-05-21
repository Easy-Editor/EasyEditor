import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
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
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
  },
})
