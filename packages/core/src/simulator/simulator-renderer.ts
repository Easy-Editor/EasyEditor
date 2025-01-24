import type { Node } from '..'
import type { Component, ComponentInstance, NodeInstance } from '../designer'

export interface SimulatorRenderer {
  readonly isSimulatorRenderer: true
  autoRepaintNode?: boolean
  components: Record<string, Component>
  rerender: () => void
  // createComponent(
  //   schema: IPublicTypeProjectSchema<IPublicTypeComponentSchema>,
  // ): Component | null;
  getComponent(componentName: string): Component
  getClosestNodeInstance(from: ComponentInstance, nodeId?: string): NodeInstance<ComponentInstance, Node> | null
  // findDOMNodes(instance: ComponentInstance): Array<Element | Text> | null
  getClientRects(element: Element | Text): DOMRect[]
  // loadAsyncLibrary(asyncMap: { [index: string]: any }): void
  stopAutoRepaintNode(): void
  enableAutoRepaintNode(): void
  run(): void
  // load(asset: Asset): Promise<any>;
}
