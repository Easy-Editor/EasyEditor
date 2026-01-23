/**
 * Easypack Configuration Types
 * 构建工具配置类型定义
 */

import type { Plugin as VitePlugin } from 'vite'

/**
 * 预设类型
 */
export type Preset = 'material' | 'setter' | 'library'

/**
 * CSS 处理模式
 */
export type CssMode = 'inject' | 'extract'

/**
 * JSX 运行时
 */
export type JsxRuntime = 'automatic' | 'classic'

/**
 * 入口文件配置
 */
export interface EntryConfig {
  /** 主入口（默认 'src/index.tsx' 或 'src/index.ts'） */
  main?: string
  /** 元数据入口（仅 material 预设，默认 'src/meta.ts'） */
  meta?: string
  /** 组件入口（仅 material 预设，默认 'src/component.tsx'） */
  component?: string
}

/**
 * 输出配置
 * minify 作为修饰符，决定是否压缩选中的格式
 */
export interface OutputConfig {
  /** 输出目录（默认 'dist'） */
  dir?: string
  /** 是否生成 ESM 格式（默认 false） */
  esm?: boolean
  /** 是否生成 CJS 格式（默认 false） */
  cjs?: boolean
  /** 是否生成 UMD 格式（默认 true） */
  umd?: boolean
  /** 是否压缩输出文件（默认 true） */
  minify?: boolean
  /** 是否生成 sourcemap（默认 false） */
  sourcemap?: boolean
  /** 是否生成 TypeScript 类型声明（默认 true） */
  types?: boolean
}

/**
 * 外部依赖配置
 */
export interface ExternalConfig {
  /**
   * 外部依赖列表
   * - 如果设置，将完全覆盖默认值
   * - 默认: ['react', 'react-dom', 'react/jsx-runtime']
   */
  externals?: string[]
  /**
   * 全局变量映射（UMD 格式使用）
   * - 如果设置，将与默认值合并
   * - 默认: { react: 'React', 'react-dom': 'ReactDOM', ... }
   */
  globals?: Record<string, string>
}

/**
 * CSS 配置
 */
export interface CssConfig {
  /** CSS Modules 作用域类名格式 */
  scopedName?: string
  /**
   * CSS 处理模式
   * - 'inject': 注入到 JS 中（默认，适合 Materials）
   * - 'extract': 提取为独立文件（适合 Setters）
   */
  mode?: CssMode
  /** 提取的 CSS 文件名（mode 为 'extract' 时有效） */
  extractFilename?: string
}

/**
 * 开发服务器配置
 */
export interface DevConfig {
  /** 端口号（默认 5001） */
  port?: number
  /** 是否启用物料调试 API（默认 true） */
  materialApi?: boolean
}

/**
 * Easypack 配置
 */
export interface EasypackConfig {
  /**
   * 预设类型
   * - 'material': 物料组件（多入口、Vite 开发插件）
   * - 'setter': 设置器（单入口、CSS 提取）
   * - 'library': 通用库
   */
  preset: Preset

  /**
   * 全局变量名（UMD 输出使用）
   * 如果不指定，将从 package.json 的 name 自动推导
   * @example 'EasyEditorMaterialsBarChart'
   */
  globalName?: string

  /**
   * 入口文件配置
   */
  entry?: EntryConfig

  /**
   * 输出配置
   */
  output?: OutputConfig

  /**
   * 外部依赖配置
   */
  external?: ExternalConfig

  /**
   * CSS 配置
   */
  css?: CssConfig

  /**
   * React JSX 运行时
   * - 'automatic': React 17+ 新 JSX 转换（默认）
   * - 'classic': React.createElement 方式
   */
  jsxRuntime?: JsxRuntime

  /**
   * 路径别名
   */
  alias?: Record<string, string>

  /**
   * 开发服务器配置（仅 material 预设）
   */
  dev?: DevConfig

  /**
   * 额外的 Vite 插件
   */
  vitePlugins?: VitePlugin[]
}

/**
 * 解析后的完整配置（所有字段都有值）
 */
export interface ResolvedConfig {
  preset: Preset
  globalName: string
  entry: Required<EntryConfig>
  output: Required<OutputConfig>
  external: Required<ExternalConfig>
  css: Required<CssConfig>
  jsxRuntime: JsxRuntime
  alias: Record<string, string>
  dev: Required<DevConfig>
  vitePlugins: VitePlugin[]
  /** 从 package.json 读取的包信息 */
  pkg: {
    name: string
    version: string
  }
}

/**
 * @deprecated 使用 EasypackConfig 代替
 */
export type BuildToolsConfig = EasypackConfig
