/**
 * Remote Load Types
 * 远程资源加载公共类型定义（纯 TypeScript，无浏览器依赖）
 */

import type { NpmInfo } from '../../types/npm-info'
import type { ResourceType } from './errors'

/** 加载状态枚举 */
export enum LoadingStatus {
  /** 空闲 */
  IDLE = 'idle',
  /** 加载中 */
  LOADING = 'loading',
  /** 已加载 */
  LOADED = 'loaded',
  /** 错误 */
  ERROR = 'error',
}

/**
 * 物料信息
 * 继承自 NpmInfo，添加远程加载所需的额外字段
 */
export interface MaterialInfo extends NpmInfo {
  /** 是否启用 */
  enabled?: boolean
}

/**
 * 设置器信息
 */
export interface SetterInfo {
  /** NPM 包名 */
  package: string
  /** 版本号 */
  version?: string
  /** UMD 全局变量名 */
  globalName: string
  /** 是否启用 */
  enabled?: boolean
}

/** 加载选项（不包含浏览器特定内容） */
export interface LoadOptions {
  /** 超时时间（毫秒） */
  timeout?: number
  /** 是否使用缓存 */
  useCache?: boolean
  /** 是否加载 CSS */
  loadCSS?: boolean
}

/** 加载进度信息 */
export interface LoadProgress {
  /** 资源类型 */
  type: ResourceType
  /** 资源名称 */
  name: string
  /** 当前阶段 */
  stage: 'resolving' | 'loading' | 'parsing' | 'registering'
  /** 进度百分比 (0-100) */
  percent: number
}

/** 默认超时时间（毫秒） */
export const DEFAULT_TIMEOUT = 30000
