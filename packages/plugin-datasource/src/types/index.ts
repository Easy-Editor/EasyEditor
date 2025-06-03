import type { JSExpression, JSONObject } from '@easy-editor/core'
import type { DataHandler } from './data-source-runtime'

export * from './data-source'
export * from './data-source-handlers'
export * from './data-source-interpret'
export * from './data-source-runtime'

export interface ExtraConfig {
  defaultDataHandler?: DataHandler
}

export interface DataSourceItem {
  id: string
  isInit?: boolean | JSExpression
  type?: string
  options?: {
    uri: string | JSExpression
    params?: JSONObject | JSExpression
    method?: string | JSExpression
    shouldFetch?: string
    willFetch?: string
    fit?: string
    didFetch?: string
  }
  dataHandler?: JSExpression
}

export interface DataSource {
  list?: DataSourceItem[]
  dataHandler?: JSExpression
}

export interface DataSourceEngine {
  createDataSourceEngine: (
    dataSource: DataSource,
    engine: any,
  ) => {
    dataSourceMap: Record<string, any>
    reloadDataSource: () => Promise<void>
  }

  [key: string]: any
}
