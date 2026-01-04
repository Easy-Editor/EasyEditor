/**
 * Material Registry Types
 * 物料注册表类型定义
 */

import type { Component, ComponentMetadata } from '../../types'
import type { ComponentMeta } from '../component-meta'

/** 物料状态 */
export enum MaterialStatus {
  /** 加载中 */
  LOADING = 'loading',
  /** 已注册（元数据已加载） */
  REGISTERED = 'registered',
  /** 活跃（组件已加载且可用） */
  ACTIVE = 'active',
  /** 卸载中 */
  UNLOADING = 'unloading',
  /** 错误状态 */
  ERROR = 'error',
}

/** 物料来源 */
export enum MaterialSource {
  /** 内置物料（打包时包含） */
  BUILTIN = 'builtin',
  /** 远程物料（CDN/NPM） */
  REMOTE = 'remote',
  /** 本地调试物料 */
  LOCAL_DEBUG = 'local_debug',
}

/** 物料条目 */
export interface MaterialEntry {
  /** 组件名称（唯一标识） */
  componentName: string
  /** 物料状态 */
  status: MaterialStatus
  /** 物料来源 */
  source: MaterialSource
  /** 组件元数据包装 */
  meta: ComponentMeta
  /** 组件实现（可选，懒加载时可能未加载） */
  component?: Component
  /** 版本号（远程物料） */
  version?: string
  /** 加载时间戳 */
  loadedAt: number
  /** 最后访问时间戳 */
  lastAccessedAt: number
  /** 使用计数（画布上的实例数） */
  usageCount: number
  /** 扩展数据 */
  extensions?: Map<string, unknown>
}

/** 注册选项 */
export interface RegisterOptions {
  /** 物料来源 */
  source?: MaterialSource
  /** 版本号 */
  version?: string
  /** 组件实现 */
  component?: Component
  /** 是否覆盖已存在的物料 */
  override?: boolean
}

/** 卸载选项 */
export interface UnloadOptions {
  /** 强制卸载（即使有使用中的实例） */
  force?: boolean
}

/** 注册表事件类型 */
export enum RegistryEventType {
  /** 物料注册 */
  REGISTERED = 'registered',
  /** 物料更新 */
  UPDATED = 'updated',
  /** 物料卸载 */
  UNLOADED = 'unloaded',
  /** 状态变更 */
  STATUS_CHANGED = 'status_changed',
  /** 使用计数变更 */
  USAGE_CHANGED = 'usage_changed',
  /** 错误 */
  ERROR = 'error',
}

/** 注册表事件 */
export interface RegistryEvent {
  type: RegistryEventType
  componentName: string
  entry?: MaterialEntry
  previousStatus?: MaterialStatus
  error?: Error
  timestamp: number
}

/** 注册表事件监听器 */
export type RegistryEventListener = (event: RegistryEvent) => void

/** 物料注册表接口 */
export interface IMaterialRegistry {
  /**
   * 注册物料
   * @param metadata 组件元数据
   * @param options 注册选项
   * @returns ComponentMeta 实例
   */
  register(metadata: ComponentMetadata, options?: RegisterOptions): ComponentMeta

  /**
   * 卸载物料
   * @param componentName 组件名称
   * @param options 卸载选项
   * @returns 是否成功卸载
   */
  unload(componentName: string, options?: UnloadOptions): Promise<boolean>

  /**
   * 获取物料条目
   * @param componentName 组件名称
   */
  get(componentName: string): MaterialEntry | undefined

  /**
   * 获取或创建物料（懒加载）
   * @param componentName 组件名称
   * @param generateMetadata 元数据生成函数
   */
  getOrCreate(componentName: string, generateMetadata?: () => ComponentMetadata | null): ComponentMeta

  /**
   * 检查物料是否存在
   * @param componentName 组件名称
   */
  has(componentName: string): boolean

  /**
   * 增加使用计数
   * @param componentName 组件名称
   */
  incrementUsage(componentName: string): void

  /**
   * 减少使用计数
   * @param componentName 组件名称
   */
  decrementUsage(componentName: string): void

  /**
   * 检查物料是否可以安全卸载
   * @param componentName 组件名称
   */
  canUnload(componentName: string): boolean

  /**
   * 订阅注册表事件
   * @param listener 事件监听器
   * @returns 取消订阅函数
   */
  subscribe(listener: RegistryEventListener): () => void

  /**
   * 获取所有物料条目
   */
  getAll(): Map<string, MaterialEntry>

  /**
   * 获取按来源分组的物料
   * @param source 物料来源
   */
  getBySource(source: MaterialSource): MaterialEntry[]

  /**
   * 获取版本号（用于缓存失效）
   */
  readonly version: number

  /**
   * 刷新版本号（触发依赖更新）
   */
  refresh(): void

  /**
   * 销毁注册表
   */
  dispose(): void
}
