import Renderer from './renderer'
import { LowCodeRenderer } from './renderer-core/renderer'
import PureRenderer from './renderer/pure'
import { SimulatorRenderer } from './simulator-renderer'

import './css/theme.css'

export {
  /**
   * renderer: 用于 live 模式
   * @example
   * <LowCodeRenderer schema={schema} components={components} />
   */
  LowCodeRenderer,
  /**
   * PreviewRenderer: 用于 preview & live 模式，支持多页面导航
   * @example
   * <PreviewRenderer projectSchema={projectSchema} components={components} onBeforeNavigate={...} />
   */
  PureRenderer,
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
}
