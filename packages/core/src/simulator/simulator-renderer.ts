import type { Node } from '..'
import type { Component, ComponentInstance, NodeInstance } from '../designer'

export interface SimulatorRenderer {
  readonly isSimulatorRenderer: true

  /**
   * 是否自动重绘节点
   */
  autoRepaintNode?: boolean

  /**
   * 组件列表
   */
  components: Record<string, Component>

  /**
   * 重新渲染
   */
  rerender: () => void

  /**
   * 获取组件
   */
  getComponent(componentName: string): Component

  /**
   * 获取最近的节点实例
   */
  getClosestNodeInstance(from: ComponentInstance, nodeId?: string): NodeInstance<ComponentInstance, Node> | null

  /**
   * 获取组件的 DOM 节点
   */
  findDOMNodes(instance: ComponentInstance): Array<Element | Text> | null

  /**
   * 获取元素的 Rect 信息
   */
  getClientRects(element: Element | Text): DOMRect[]

  /**
   * 关闭自动重绘节点
   */
  stopAutoRepaintNode(): void

  /**
   * 开启自动重绘节点
   */
  enableAutoRepaintNode(): void

  /**
   * 渲染器启动
   */
  run(): void

  // TODO
  // load(asset: Asset): Promise<any>;
  // loadAsyncLibrary(asyncMap: { [index: string]: any }): void
}

export const isSimulatorRenderer = (obj: any): obj is SimulatorRenderer => {
  return obj && obj.isSimulatorRenderer
}
