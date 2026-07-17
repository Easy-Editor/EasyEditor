import path from 'node:path'
import federation from '@originjs/vite-plugin-federation'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const agentRuntimeE2EEnabled = process.env.VITE_E2E === '1'

// https://vite.dev/config/
export default defineConfig({
  define: {
    __EASY_EDITOR_AGENT_RUNTIME_E2E__: JSON.stringify(agentRuntimeE2EEnabled),
  },
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
    alias: [
      {
        find: '@/editor/agent/runtime-e2e/index.mjs',
        replacement: path.resolve(
          __dirname,
          agentRuntimeE2EEnabled
            ? './src/editor/agent/runtime-e2e/index.mjs'
            : './src/editor/agent/runtime-e2e/disabled.mjs',
        ),
      },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
    // 确保使用相同的 React 实例，解决双 React 问题
    dedupe: ['react', 'react-dom'],
  },
  build: {
    target: 'esnext',
  },
})
