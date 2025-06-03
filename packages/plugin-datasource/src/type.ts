import type { DataSource, DataSourceEngine } from './types'

declare module '@easy-editor/core' {
  interface ConfigOptions {
    /**
     * 数据源引擎
     */
    dataSourceEngine?: DataSourceEngine
  }

  interface ProjectSchema {
    /**
     * 异步数据源配置
     */
    dataSource?: DataSource
  }

  interface Simulator {
    /**
     * 数据源引擎
     */
    dataSourceEngine?: DataSourceEngine
  }

  interface Project {
    /**
     * 数据源配置
     */
    dataSource: DataSource | undefined
  }
}
