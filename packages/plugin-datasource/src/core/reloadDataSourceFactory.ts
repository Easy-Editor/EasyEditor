import { promiseSettled } from '../helpers'
import type { DataSourceMap, RuntimeDataSource, RuntimeDataSourceConfig } from '../types'

export const reloadDataSourceFactory = (
  dataSource: RuntimeDataSource,
  dataSourceMap: DataSourceMap,
  dataHandler?: (dataSourceMap: DataSourceMap) => void,
) => {
  return async () => {
    const allAsyncLoadings: Array<Promise<any>> = []

    // TODO: 那么，如果有新的类型过来，这个地方怎么处理???
    // 单独处理 urlParams 类型的
    dataSource.list
      .filter((el: RuntimeDataSourceConfig) => el.type === 'urlParams' && isInit(el))
      .forEach((el: RuntimeDataSourceConfig) => {
        dataSourceMap[el.id].load()
      })

    const remainRuntimeDataSourceList = dataSource.list.filter((el: RuntimeDataSourceConfig) => el.type !== 'urlParams')

    // 处理并行
    for (const ds of remainRuntimeDataSourceList) {
      if (!ds.options) {
        continue
      }
      if (
        // 需要考虑出码直接不传值的情况
        isInit(ds) &&
        !ds.isSync
      ) {
        allAsyncLoadings.push(dataSourceMap[ds.id].load())
      }
    }

    // 处理串行
    for (const ds of remainRuntimeDataSourceList) {
      if (!ds.options) {
        continue
      }

      if (
        // 需要考虑出码直接不传值的情况
        isInit(ds) &&
        ds.isSync
      ) {
        try {
          await dataSourceMap[ds.id].load()
        } catch (e) {
          // TODO: 这个错误直接吃掉？
          console.error(e)
        }
      }
    }

    await promiseSettled(allAsyncLoadings)

    // 所有的初始化请求都结束之后，调用钩子函数
    if (dataHandler) {
      dataHandler(dataSourceMap)
    }
  }
}

function isInit(ds: RuntimeDataSourceConfig) {
  return typeof ds.isInit === 'function' ? (ds as unknown as { isInit: () => boolean }).isInit() : (ds.isInit ?? true)
}
