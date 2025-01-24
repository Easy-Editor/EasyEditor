import { LowCodeRenderer } from './renderer'
import { SimulatorRenderer, simulatorRenderer } from './simulator-renderer'

export {
  /**
   * renderer: 用于 live 模式
   * @example
   * <LowCodeRenderer schema={schema} components={components} />
   */
  LowCodeRenderer,
  /**
   * SimulatorRenderer: 用于 design 模式
   * @example
   * <SimulatorRenderer host={simulator} />
   */
  SimulatorRenderer,
  /**
   * simulator renderer: 用于 design 模式
   * @example
   * <SimulatorRenderer schema={schema} components={components} />
   * simulatorRenderer.mount(simulator)
   * simulator.mountContentFrame(elem)
   */
  simulatorRenderer,
}
