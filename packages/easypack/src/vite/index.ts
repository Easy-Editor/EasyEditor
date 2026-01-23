/**
 * Vite Configuration Generator
 * Vite 配置生成器
 */

import type { UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { ResolvedConfig } from '../config/types'
import { externalDepsPlugin } from './plugins/external-deps'
import { materialDevPlugin } from './plugins/material-dev'
import path from 'node:path'

export interface CreateViteConfigOptions {
  config: ResolvedConfig
  cwd?: string
}

/**
 * 创建 Vite 开发服务器配置
 */
export function createViteConfig(options: CreateViteConfigOptions): UserConfig {
  const { config, cwd = process.cwd() } = options

  // 直接使用已解析的配置（已包含默认值）
  const { externals, globals } = config.external

  const plugins: UserConfig['plugins'] = [react()]

  // 外部依赖插件
  plugins.push(externalDepsPlugin({ externals, globals }))

  // 物料开发插件（仅 material 预设启用）
  if (config.dev.materialApi) {
    plugins.push(materialDevPlugin({ entry: `/${config.entry.main}` }))
  }

  // 用户自定义插件
  if (config.vitePlugins.length > 0) {
    plugins.push(...config.vitePlugins)
  }

  // 路径别名
  const aliasConfig: Record<string, string> = {}
  for (const [key, value] of Object.entries(config.alias)) {
    aliasConfig[key] = path.resolve(cwd, value)
  }

  return {
    plugins,
    server: {
      port: config.dev.port,
      host: 'localhost',
      cors: true,
      hmr: {
        port: config.dev.port,
      },
    },
    build: {
      target: 'esnext',
      rollupOptions: {
        external: externals,
        output: {
          globals,
        },
      },
    },
    resolve: {
      alias: aliasConfig,
      dedupe: ['react', 'react-dom'],
    },
    css: {
      modules: {
        generateScopedName: config.css.scopedName,
      },
    },
  }
}

// 导出插件
export * from './plugins'
