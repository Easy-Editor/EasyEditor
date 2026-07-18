/**
 * Rollup Configuration Generator
 * Rollup 配置生成器
 */

import fs from 'node:fs'
import path from 'node:path'
import type { RollupOptions } from 'rollup'
import type { ResolvedConfig } from '../config/types'
import { createOutputConfigs } from './outputs'

export interface CreateRollupConfigOptions {
  config: ResolvedConfig
  cwd?: string
  workspaceConfinement?: boolean
}

/**
 * 检查入口文件是否存在
 */
function entryExists(entry: string, cwd: string): boolean {
  const fullPath = path.join(cwd, entry)
  return fs.existsSync(fullPath)
}

/**
 * 创建 Rollup 配置
 */
export function createRollupConfig(options: CreateRollupConfigOptions): RollupOptions[] {
  const { config, cwd = process.cwd(), workspaceConfinement = false } = options
  const configs: RollupOptions[] = []

  // 对于 material 预设，生成分离构建（meta + component）
  if (config.preset === 'material') {
    // Meta 构建
    if (config.entry.meta && entryExists(config.entry.meta, cwd)) {
      configs.push(
        ...createOutputConfigs({
          config,
          input: config.entry.meta,
          type: 'meta',
          cwd,
          workspaceConfinement,
        }),
      )
    }

    // Component 构建
    if (config.entry.component && entryExists(config.entry.component, cwd)) {
      configs.push(
        ...createOutputConfigs({
          config,
          input: config.entry.component,
          type: 'component',
          cwd,
          workspaceConfinement,
        }),
      )
    }
  }

  // 完整构建（所有预设都需要）
  if (config.entry.main && entryExists(config.entry.main, cwd)) {
    configs.push(
      ...createOutputConfigs({
        config,
        input: config.entry.main,
        type: 'full',
        cwd,
        workspaceConfinement,
      }),
    )
  } else {
    throw new Error(`Main entry file not found: ${config.entry.main}`)
  }

  return configs
}

// 导出子模块
export * from './constants'
export * from './plugins'
export * from './outputs'
