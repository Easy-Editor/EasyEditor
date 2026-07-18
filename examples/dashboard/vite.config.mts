import path from 'node:path'
import { fileURLToPath } from 'node:url'
import federation from '@originjs/vite-plugin-federation'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { type UserConfig, defineConfig } from 'vite'
import { type DataProxyMiddlewareOptions, createEnvironmentDataProxyMiddleware } from './server/data/index.mjs'
import {
  type ModelGatewayMiddlewareOptions,
  createEnvironmentModelGatewayMiddleware,
  createModelGatewayVitePlugin,
} from './server/gateway/index.mjs'
import {
  type OnlineComponentDependencyMiddlewareOptions,
  createEnvironmentOnlineComponentDependencyMiddleware,
} from './server/online-components/index.mjs'
import {
  type MaterialPromotionMiddlewareOptions,
  createEnvironmentMaterialPromotionMiddleware,
} from './server/promotion/index.mjs'

export interface DashboardViteConfigOptions {
  env?: NodeJS.ProcessEnv
  agentModelGatewayOptions?: ModelGatewayMiddlewareOptions
  dataProxyOptions?: Pick<DataProxyMiddlewareOptions, 'lookup' | 'transport'>
  onlineComponentDependencyOptions?: Pick<OnlineComponentDependencyMiddlewareOptions, 'lookup' | 'transport'>
  materialPromotionOptions?: MaterialPromotionMiddlewareOptions
}

const dashboardDirectory = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export const createDashboardViteConfig = ({
  env = process.env,
  agentModelGatewayOptions = {},
  dataProxyOptions = {},
  onlineComponentDependencyOptions = {},
  materialPromotionOptions = {},
}: DashboardViteConfigOptions = {}): UserConfig => {
  const agentRuntimeE2EEnabled = env.VITE_E2E === '1'
  const agentModelGatewayMiddleware = createEnvironmentModelGatewayMiddleware({
    ...agentModelGatewayOptions,
    env,
  })
  const dataProxyMiddleware = createEnvironmentDataProxyMiddleware({
    env,
    lookup: dataProxyOptions.lookup,
    transport: dataProxyOptions.transport,
  })
  const onlineComponentDependencyMiddleware = createEnvironmentOnlineComponentDependencyMiddleware({
    env,
    lookup: onlineComponentDependencyOptions.lookup,
    transport: onlineComponentDependencyOptions.transport,
  })
  const materialPromotionMiddleware = createEnvironmentMaterialPromotionMiddleware({
    ...materialPromotionOptions,
    env,
  })
  return {
    define: {
      __EASY_EDITOR_AGENT_RUNTIME_E2E__: JSON.stringify(agentRuntimeE2EEnabled),
    },
    plugins: [
      createModelGatewayVitePlugin(agentModelGatewayMiddleware),
      {
        name: 'easy-editor-material-promotion',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            void materialPromotionMiddleware(request, response, next)
          })
        },
      },
      {
        name: 'easy-editor-online-component-dependency',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            void onlineComponentDependencyMiddleware(request, response, next)
          })
        },
      },
      {
        name: 'easy-editor-data-proxy',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            void dataProxyMiddleware(request, response, next)
          })
        },
      },
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
            dashboardDirectory,
            agentRuntimeE2EEnabled
              ? './src/editor/agent/runtime-e2e/index.mjs'
              : './src/editor/agent/runtime-e2e/disabled.mjs',
          ),
        },
        { find: '@', replacement: path.resolve(dashboardDirectory, './src') },
      ],
      // 确保使用相同的 React 实例，解决双 React 问题
      dedupe: ['react', 'react-dom'],
    },
    build: {
      target: 'esnext',
    },
  }
}

export default defineConfig(createDashboardViteConfig())
