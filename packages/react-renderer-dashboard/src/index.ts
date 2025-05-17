import Renderer from './renderer'
import { LowCodeRenderer } from './renderer-core/renderer'
import { SimulatorRenderer, simulatorRenderer } from './simulator-renderer'

import './css/theme.css'

export {
  /**
   * renderer: 用于 live 模式
   * @example
   * <LowCodeRenderer schema={schema} components={components} />
   */
  LowCodeRenderer,
  /**
   * Renderer: 用于 live 模式
   * @example
   * <Renderer schema={schema} components={components} viewport={{ width: 1920, height: 1080 }} />
   */
  Renderer,
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
