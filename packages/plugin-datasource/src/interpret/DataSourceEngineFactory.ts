import { RuntimeDataSourceItem } from '../core/RuntimeDataSourceItem'
import { adapt2Runtime } from '../core/adapter'
import { reloadDataSourceFactory } from '../core/reloadDataSourceFactory'
import { type ExpressionEvaluator, legacyTrustedExpressionEvaluator } from '../expression-evaluator'
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
    expressionEvaluator?: ExpressionEvaluator
  } = { requestHandlersMap: {} },
) => {
  const { requestHandlersMap } = extraConfig
  const expressionEvaluator = Object.hasOwn(extraConfig, 'expressionEvaluator')
    ? extraConfig.expressionEvaluator
    : legacyTrustedExpressionEvaluator

  const runtimeDataSource: RuntimeDataSource = adapt2Runtime(dataSource, context, {
    defaultDataHandler: extraConfig.defaultDataHandler,
    expressionEvaluator,
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
