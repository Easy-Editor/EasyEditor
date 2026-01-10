import type { CompositeValue, JSExpression, JSFunction, JSONObject, PropsMap } from '../document'
import type { ComponentsMap } from './component'
import type { DataSource } from './data-source'

export interface ProjectSchema<T = RootSchema> {
  id?: string

  /**
   * 协议版本号
   */
  version: string

  /**
   * 组件映射关系
   */
  componentsMap?: ComponentsMap

  /**
   * 组件树
   */
  componentsTree: T[]

  /**
   * 工具类
   */
  utils?: Record<string, any>

  /**
   * 全局常量
   */
  constants?: JSONObject

  /**
   * 全局样式
   */
  css?: string

  /**
   * 配置信息
   */
  config?: Record<string, any>

  /**
   * 元数据信息
   */
  meta?: Record<string, any>

  /**
   * 异步数据源配置
   */
  dataSource?: DataSource

  [key: string]: any
}

export interface RootSchema extends NodeSchema {
  docId?: string

  /**
   * 文件名称
   */
  fileName?: string

  meta?: Record<string, unknown>

  /**
   * 容器初始数据
   */
  state?: {
    [key: string]: CompositeValue
  }

  /**
   * 自定义方法设置
   */
  methods?: {
    [key: string]: JSExpression | JSFunction
  }

  /**
   * 生命周期对象
   */
  lifeCycles?: {
    [key: string]: JSExpression | JSFunction
  }

  /**
   * 样式文件
   */
  css?: string

  /**
   * 异步数据源配置
   */
  dataSource?: DataSource
}

export interface NodeSchema {
  id?: string

  /** title */
  title?: string

  /** required */
  componentName: string

  /** props */
  props?: PropsMap

  /** sub nodes */
  children?: NodeSchema[]

  /** hidden */
  hidden?: boolean

  /** locked */
  locked?: boolean

  /** render condition */
  condition?: CompositeValue

  /** loop data */
  loop?: CompositeValue

  [key: string]: any
}

export type NodeData = NodeSchema | JSExpression
