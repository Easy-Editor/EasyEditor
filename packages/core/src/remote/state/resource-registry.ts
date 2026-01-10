/**
 * Resource Registry
 * 已加载资源注册表
 */

import { action, computed, observable } from 'mobx'
import type { ResourceType } from '../core/errors'

/** 已加载资源条目 */
export interface LoadedResource<T = unknown> {
  /** 资源类型 */
  type: ResourceType
  /** 资源名称（包名） */
  name: string
  /** 版本号 */
  version: string
  /** UMD 全局变量名 */
  globalName: string
  /** 资源数据 */
  data: T
  /** 加载完成时间 */
  loadedAt: number
}

/**
 * 资源注册表
 * 管理已加载的远程资源
 */
export class ResourceRegistry {
  /** 物料资源 */
  @observable.shallow private accessor materials = new Map<string, LoadedResource>()

  /** 设置器资源 */
  @observable.shallow private accessor setters = new Map<string, LoadedResource>()

  /**
   * 获取所有物料数量
   */
  @computed
  get materialCount(): number {
    return this.materials.size
  }

  /**
   * 获取所有设置器数量
   */
  @computed
  get setterCount(): number {
    return this.setters.size
  }

  /**
   * 注册资源
   */
  @action
  register<T>(resource: LoadedResource<T>): void {
    const map = this.getMap(resource.type)
    map.set(resource.name, resource as LoadedResource)
  }

  /**
   * 获取资源
   */
  get<T>(type: ResourceType, name: string): LoadedResource<T> | undefined {
    const map = this.getMap(type)
    return map.get(name) as LoadedResource<T> | undefined
  }

  /**
   * 检查资源是否已加载
   */
  has(type: ResourceType, name: string): boolean {
    const map = this.getMap(type)
    return map.has(name)
  }

  /**
   * 卸载资源
   */
  @action
  unload(type: ResourceType, name: string): boolean {
    const map = this.getMap(type)
    return map.delete(name)
  }

  /**
   * 获取所有资源
   */
  getAll(type?: ResourceType): LoadedResource[] {
    if (type === 'material') {
      return Array.from(this.materials.values())
    }
    if (type === 'setter') {
      return Array.from(this.setters.values())
    }
    return [...Array.from(this.materials.values()), ...Array.from(this.setters.values())]
  }

  /**
   * 获取所有物料名称
   */
  getMaterialNames(): string[] {
    return Array.from(this.materials.keys())
  }

  /**
   * 获取所有设置器名称
   */
  getSetterNames(): string[] {
    return Array.from(this.setters.keys())
  }

  /**
   * 清除指定类型的所有资源
   */
  @action
  clearType(type: ResourceType): void {
    const map = this.getMap(type)
    map.clear()
  }

  /**
   * 清除所有资源
   */
  @action
  clearAll(): void {
    this.materials.clear()
    this.setters.clear()
  }

  /**
   * 获取资源映射
   */
  private getMap(type: ResourceType): Map<string, LoadedResource> {
    return type === 'material' ? this.materials : this.setters
  }
}

/** 导出单例 */
export const resourceRegistry = new ResourceRegistry()
