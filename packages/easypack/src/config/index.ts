/**
 * Configuration Loader
 * 配置加载器 - 加载和解析 easypack.config.ts
 */

import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveConfig } from './defaults'
import type { EasypackConfig, ResolvedConfig } from './types'

/**
 * 支持的配置文件名（按优先级）
 */
const CONFIG_FILES = ['easypack.config.ts', 'easypack.config.js', 'easypack.config.mjs']

/**
 * 读取 package.json
 */
function readPackageJson(cwd: string): { name: string; version: string } {
  const pkgPath = path.join(cwd, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found in ${cwd}`)
  }
  const content = fs.readFileSync(pkgPath, 'utf-8')
  const pkg = JSON.parse(content)
  return {
    name: pkg.name || 'unknown',
    version: pkg.version || '0.0.0',
  }
}

/**
 * 加载 TypeScript/JavaScript 配置文件
 */
async function loadConfigFile(configPath: string): Promise<EasypackConfig> {
  const ext = path.extname(configPath)

  // 对于 .js 和 .mjs 文件，直接导入
  if (ext === '.js' || ext === '.mjs') {
    const module = await import(pathToFileURL(configPath).href)
    return module.default
  }

  // 对于 .ts 文件，使用 esbuild 编译
  const result = await build({
    entryPoints: [configPath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    external: ['@easy-editor/easypack'],
  })

  const code = result.outputFiles[0].text
  const tempFile = path.join(path.dirname(configPath), '.easypack.config.tmp.mjs')

  fs.writeFileSync(tempFile, code)
  try {
    const module = await import(pathToFileURL(tempFile).href)
    return module.default
  } finally {
    // 清理临时文件
    try {
      fs.unlinkSync(tempFile)
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 查找配置文件
 */
function findConfigFile(cwd: string, customPath?: string): string | null {
  if (customPath) {
    const fullPath = path.isAbsolute(customPath) ? customPath : path.join(cwd, customPath)
    if (fs.existsSync(fullPath)) {
      return fullPath
    }
    throw new Error(`Config file not found: ${customPath}`)
  }

  for (const file of CONFIG_FILES) {
    const fullPath = path.join(cwd, file)
    if (fs.existsSync(fullPath)) {
      return fullPath
    }
  }

  return null
}

/**
 * 加载配置
 * @param customConfigPath 自定义配置文件路径
 * @param cwd 工作目录（默认 process.cwd()）
 */
export async function loadConfig(customConfigPath?: string, cwd: string = process.cwd()): Promise<ResolvedConfig> {
  // 查找配置文件
  const configPath = findConfigFile(cwd, customConfigPath)

  if (!configPath) {
    throw new Error(
      `No config file found. Run \`easypack init\` to create one.\nSupported config files: ${CONFIG_FILES.join(', ')}`,
    )
  }

  // 读取 package.json
  const pkg = readPackageJson(cwd)

  // 加载用户配置
  const userConfig = await loadConfigFile(configPath)

  // 解析并返回完整配置
  return resolveConfig(userConfig, pkg)
}

/**
 * 定义配置的辅助函数
 * 提供类型提示
 */
export function defineConfig(config: EasypackConfig): EasypackConfig {
  return config
}

// 导出类型
export { DEFAULT_EXTERNALS, DEFAULT_GLOBALS, deriveGlobalName } from './defaults'
export * from './presets'
export * from './types'
