import { promiseSettled } from '../helpers'
import type { DataSourceMap, RuntimeDataSource, RuntimeDataSourceConfig } from '../types'

export const reloadDataSourceFactory = (
  dataSource: RuntimeDataSource,
  dataSourceMap: DataSourceMap,
  dataHandler?: (dataSourceMap: DataSourceMap) => void,
) => {
  return async () => {
    const initializedDataSources = dataSource.list.filter(isInit)
    const urlParamDataSources = initializedDataSources.filter(el => el.type === 'urlParams')
    const remainRuntimeDataSourceList = initializedDataSources.filter(el => el.type !== 'urlParams' && el.options)
    const allAsyncLoadings = [
      ...urlParamDataSources.map(el => dataSourceMap[el.id].load()),
      ...remainRuntimeDataSourceList.filter(el => !el.isSync).map(el => dataSourceMap[el.id].load()),
    ]
    const errors: unknown[] = []

    // 处理串行，同时保留错误并等待其他已启动任务结算。
    for (const ds of remainRuntimeDataSourceList.filter(el => el.isSync)) {
      try {
        await dataSourceMap[ds.id].load()
      } catch (error) {
        errors.push(error)
      }
    }

    for (const result of await promiseSettled(allAsyncLoadings)) {
      if (result.status === 'rejected' && 'reason' in result) errors.push(result.reason)
    }

    if (errors.length > 0) {
      if (errors.length === 1) throw errors[0]
      throw new AggregateError(errors, 'One or more data sources failed to reload')
    }

    // 所有的初始化请求都成功结束之后，调用钩子函数
    if (dataHandler) {
      await dataHandler(dataSourceMap)
    }
  }
}

function isInit(ds: RuntimeDataSourceConfig) {
  return typeof ds.isInit === 'function' ? (ds as unknown as { isInit: () => boolean }).isInit() : (ds.isInit ?? true)
}
