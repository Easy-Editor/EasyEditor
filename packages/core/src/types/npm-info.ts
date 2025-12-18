/**
 * npm 源引入完整描述对象
 */
export interface NpmInfo {
  /**
   * 源码组件名称
   */
  componentName?: string
  /**
   * 源码组件库名
   */
  package: string
  /**
   * 源码组件版本号
   */
  version?: string
  /**
   * 是否解构
   */
  destructuring?: boolean
  /**
   * 源码组件名称（导出名）
   */
  exportName?: string
  /**
   * 子组件名
   */
  subName?: string
  /**
   * 组件路径
   */
  main?: string
  /**
   * UMD 全局变量名（扩展字段）
   */
  globalName?: string
}
