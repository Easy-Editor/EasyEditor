import type { CompositeValue, JSExpression, JSONObject, PropsMap } from '../document'

export interface ProjectSchema<T = RootSchema> {
  id?: string

  version: string

  componentsMap?: any

  componentsTree: T[]

  utils?: Record<string, any>

  constants?: JSONObject

  css?: string

  config?: Record<string, any>

  meta?: Record<string, any>

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
  // state?: {
  //   [key: string]: IPublicTypeCompositeValue;
  // };

  /**
   * 自定义方法设置
   */
  // methods?: {
  //   [key: string]: IPublicTypeJSExpression | IPublicTypeJSFunction;
  // };

  /**
   * 生命周期对象
   */
  // lifeCycles?: {
  //   [key: string]: IPublicTypeJSExpression | IPublicTypeJSFunction;
  // };

  /**
   * 样式文件
   */
  css?: string
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
  isHidden?: boolean

  /** locked */
  isLocked?: boolean

  /** render condition */
  condition?: CompositeValue

  /** loop data */
  loop?: CompositeValue

  [key: string]: any
}

export type NodeData = NodeSchema | JSExpression
