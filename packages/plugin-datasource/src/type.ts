import type { InterpretDataSource } from './types'

declare module '@easy-editor/core' {
  interface ProjectSchema {
    /**
     * 数据源配置
     */
    // @ts-ignore
    dataSource?: InterpretDataSource
  }

  interface RootSchema {
    /**
     * 数据源配置
     */
    // @ts-ignore
    dataSource?: InterpretDataSource
  }

  interface DataSourceEngine {
    // @ts-ignore
    createDataSourceEngine: (
      dataSource: InterpretDataSource,
      engine: any,
    ) => {
      dataSourceMap: Record<string, any>
      reloadDataSource: () => Promise<void>
    }
  }
}
