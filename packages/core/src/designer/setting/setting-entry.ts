import type { Editor, Node, Setters } from '../..'
import type { Designer } from '../designer'
import type { SettingField } from './setting-field'

export interface SettingEntry {
  readonly designer: Designer | undefined

  readonly id: string

  /**
   * 同样类型的节点
   */
  readonly isSameComponent: boolean

  /**
   * 一个
   */
  readonly isSingle: boolean

  /**
   * 多个
   */
  readonly isMultiple: boolean

  /**
   * 编辑器引用
   */
  readonly editor: Editor

  readonly setters: Setters

  /**
   * 取得子项
   */
  get: (propName: string | number) => SettingField | null

  readonly nodes: Node[]

  // @todo 补充 node 定义
  /**
   * 获取 node 中的第一项
   */
  getNode: () => any
}

export interface SettingTarget {
  // 所设置的节点集，至少一个
  readonly nodes: Node[]

  // 所有属性值数据
  readonly props: object

  // 设置属性值
  setPropValue(propName: string, value: any): void

  // 获取属性值
  getPropValue(propName: string): any

  // 设置多个属性值，替换原有值
  setProps(data: object): void

  // 设置多个属性值，和原有值合并
  mergeProps(data: object): void

  // 绑定属性值发生变化时
  onPropsChange(fn: () => void): () => void
}
