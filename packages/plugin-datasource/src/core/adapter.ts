import { defaultDataHandler, defaultWillFetch } from '../helpers'
import type {
  DataSourceMap,
  ExtraConfig,
  IDataSourceRuntimeContext,
  InterpretDataSource,
  InterpretDataSourceConfig,
  RuntimeDataSourceConfig,
} from '../types'
import { buildOptions, buildShouldFetch, getRuntimeJsValue, getRuntimeValueFromConfig } from './../utils'

const adapt2Runtime = (
  dataSource: InterpretDataSource,
  context: IDataSourceRuntimeContext,
  extraConfig: ExtraConfig,
) => {
  const { list: interpretConfigList, dataHandler: interpretDataHandler } = dataSource
  const expressionEvaluator = extraConfig.expressionEvaluator
  const dataHandler: (dataMap?: DataSourceMap) => void = interpretDataHandler
    ? getRuntimeJsValue(interpretDataHandler, context, expressionEvaluator)
    : undefined

  // 为空判断
  if (!interpretConfigList || !interpretConfigList.length) {
    return {
      list: [],
      dataHandler,
    }
  }
  const list: RuntimeDataSourceConfig[] = interpretConfigList.map((el: InterpretDataSourceConfig) => {
    const { defaultDataHandler: customDataHandler } = extraConfig
    const finalDataHandler = customDataHandler || defaultDataHandler
    return {
      id: el.id,
      isInit: getRuntimeValueFromConfig('boolean', el.isInit, context, expressionEvaluator), // 默认 true
      isSync: getRuntimeValueFromConfig('boolean', el.isSync, context, expressionEvaluator), // 默认 false
      type: el.type || 'fetch',
      willFetch: el.willFetch ? getRuntimeJsValue(el.willFetch, context, expressionEvaluator) : defaultWillFetch,
      shouldFetch: buildShouldFetch(el, context, expressionEvaluator),
      dataHandler: el.dataHandler ? getRuntimeJsValue(el.dataHandler, context, expressionEvaluator) : finalDataHandler,
      errorHandler: el.errorHandler ? getRuntimeJsValue(el.errorHandler, context, expressionEvaluator) : undefined,
      requestHandler: el.requestHandler
        ? getRuntimeJsValue(el.requestHandler, context, expressionEvaluator)
        : undefined,
      options: buildOptions(el, context, expressionEvaluator),
    }
  })

  return {
    list,
    dataHandler,
  }
}

export { adapt2Runtime }
