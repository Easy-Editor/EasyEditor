import type { Component } from './types'
import { createLogger, isPlainObject } from './utils'

const logger = createLogger('Config')

export interface ConfigOptions {
  /**
   * 是否开启 condition 的能力，默认在设计器中不管 condition 是啥都正常展示
   * @default false
   */
  enableCondition?: boolean

  /**
   * 设计模式，live 模式将会实时展示变量值
   * @default 'design'
   */
  designMode?: 'design' | 'live'

  /**
   * 设备类型
   * @default 'default'
   */
  device?: 'default' | 'mobile' | string

  /**
   * 指定初始化的 deviceClassName，挂载到画布的顶层节点上
   */
  deviceClassName?: string

  /**
   * 语言
   * @default 'zh-CN'
   */
  locale?: string

  /**
   * 渲染器类型
   */
  renderEnv?: 'react' | 'vue' | string

  /**
   * 关闭画布自动渲染
   * @default false
   */
  disableAutoRender?: boolean

  /**
   * 容器锁定后，容器本身是否可以设置属性，仅当画布锁定特性开启时生效
   * @default false
   * @todo
   */
  enableLockedNodeSetting?: boolean

  /**
   * 与 renderer 的 appHelper 一致
   */
  appHelper?: {
    utils?: Record<string, any>
    constants?: Record<string, any>
    [key: string]: any
  }

  /**
   * 当开启组件未找到严格模式时，渲染模块不会默认给一个容器组件
   * @default false
   */
  enableStrictNotFoundMode?: boolean

  /**
   * 是否在设计态中执行生命周期，默认只在运行态执行
   * @default false
   */
  excuteLifeCycleInDesignMode?: boolean

  /**
   * 当找不到组件时显示的组件
   */
  notFoundComponent?: Component

  /**
   * 当组件渲染异常时显示的组件
   */
  faultComponent?: Component

  /**
   * 项目进行初始化加载时显示的组件
   */
  loadingComponent?: Component
}

export class Config {
  private config: { [key: string]: any } = {}

  private waits = new Map<
    string,
    Array<{
      once?: boolean
      resolve: (data: any) => void
    }>
  >()

  constructor(config?: { [key: string]: any }) {
    this.config = config || {}
  }

  /**
   * 判断指定 key 是否有值
   * @param key
   */
  has(key: string): boolean {
    return this.config[key] !== undefined
  }

  /**
   * 获取指定 key 的值
   * @param key
   * @param defaultValue
   */
  get(key: string, defaultValue?: any): any {
    return this.config[key] ?? defaultValue
  }

  /**
   * 设置指定 key 的值
   * @param key
   * @param value
   */
  set(key: string, value: any) {
    this.config[key] = value
    this.notifyGot(key)
  }

  /**
   * 批量设值，set 的对象版本
   * @param config
   */
  setConfig(config: { [key: string]: any }) {
    if (config) {
      Object.keys(config).forEach(key => {
        this.set(key, config[key])
      })
    }
  }

  /**
   * if engineOptions.strictPluginMode === true, only accept propertied predefined in EngineOptions.
   *
   * @param {ConfigOptions} engineOptions
   */
  setEngineOptions(engineOptions: ConfigOptions) {
    if (!engineOptions || !isPlainObject(engineOptions)) {
      return
    }
    this.setConfig(engineOptions as any)
  }

  /**
   * 获取指定 key 的值，若此时还未赋值，则等待，若已有值，则直接返回值
   *  注：此函数返回 Promise 实例，只会执行（fullfill）一次
   * @param key
   * @returns
   */
  onceGot(key: string): Promise<any> {
    const val = this.config[key]
    if (val !== undefined) {
      return Promise.resolve(val)
    }
    return new Promise(resolve => {
      this.setWait(key, resolve, true)
    })
  }

  /**
   * 获取指定 key 的值，函数回调模式，若多次被赋值，回调会被多次调用
   * @param key
   * @param fn
   * @returns
   */
  onGot(key: string, fn: (data: any) => void): () => void {
    const val = this.config?.[key]
    if (val !== undefined) {
      fn(val)
    }
    this.setWait(key, fn)
    return () => {
      this.delWait(key, fn)
    }
  }

  notifyGot(key: string): void {
    let waits = this.waits.get(key)
    if (!waits) {
      return
    }
    waits = waits.slice().reverse()
    let i = waits.length
    while (i--) {
      waits[i].resolve(this.get(key))
      if (waits[i].once) {
        waits.splice(i, 1)
      }
    }
    if (waits.length > 0) {
      this.waits.set(key, waits)
    } else {
      this.waits.delete(key)
    }
  }

  setWait(key: string, resolve: (data: any) => void, once?: boolean) {
    const waits = this.waits.get(key)
    if (waits) {
      waits.push({ resolve, once })
    } else {
      this.waits.set(key, [{ resolve, once }])
    }
  }

  delWait(key: string, fn: any) {
    const waits = this.waits.get(key)
    if (!waits) {
      return
    }
    let i = waits.length
    while (i--) {
      if (waits[i].resolve === fn) {
        waits.splice(i, 1)
      }
    }
    if (waits.length < 1) {
      this.waits.delete(key)
    }
  }
}

export const config = new Config()
