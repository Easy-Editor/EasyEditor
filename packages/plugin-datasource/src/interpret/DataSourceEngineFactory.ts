import { RuntimeDataSourceItem } from '../core/RuntimeDataSourceItem'
import { adapt2Runtime } from '../core/adapter'
import { reloadDataSourceFactory } from '../core/reloadDataSourceFactory'
import { getRequestHandler } from '../helpers'
import type {
  DataHandler,
  IDataSourceRuntimeContext,
  IRuntimeDataSource,
  InterpretDataSource,
  RequestHandlersMap,
  RuntimeDataSource,
  RuntimeDataSourceConfig,
} from '../types'

/**
 * @param dataSource
 * @param context
 * @param extraConfig: { requestHandlersMap }
 */

export default (
  dataSource: InterpretDataSource,
  context: IDataSourceRuntimeContext,
  extraConfig: {
    requestHandlersMap: RequestHandlersMap<{ data: unknown }>
    defaultDataHandler?: DataHandler
  } = { requestHandlersMap: {} },
) => {
  const { requestHandlersMap } = extraConfig

  const runtimeDataSource: RuntimeDataSource = adapt2Runtime(dataSource, context, {
    defaultDataHandler: extraConfig.defaultDataHandler,
  })

  const dataSourceMap = runtimeDataSource.list.reduce(
    (prev: Record<string, IRuntimeDataSource>, current: RuntimeDataSourceConfig) => {
      prev[current.id] = new RuntimeDataSourceItem(current, getRequestHandler(current, requestHandlersMap), context)
      return prev
    },
    {},
  )

  return {
    dataSourceMap,
    reloadDataSource: reloadDataSourceFactory(runtimeDataSource, dataSourceMap, runtimeDataSource.dataHandler),
  }
}
