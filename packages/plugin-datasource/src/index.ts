import type { PluginCreator } from '@easy-editor/core'
import { type ExpressionEvaluator, legacyTrustedExpressionEvaluator } from './expression-evaluator'
import { createFetchHandler } from './handlers/fetch'
import createInterpret from './interpret/DataSourceEngineFactory'
import createRuntime from './runtime/RuntimeDataSourceEngineFactory'
import type { DataHandler, IDataSourceRuntimeContext, InterpretDataSource, RequestHandlersMap } from './types'

export { createInterpret, createRuntime }

export * from './expression-evaluator'
export * from './type'
export * from './types'

export const defaultRequestHandlersMap = {
  fetch: createFetchHandler(),
}

export const createDataSourceEngine = (
  dataSource: InterpretDataSource,
  engine: IDataSourceRuntimeContext,
  options?: DataSourcePluginOptions,
) => {
  const expressionEvaluator =
    options && Object.hasOwn(options, 'expressionEvaluator')
      ? options.expressionEvaluator
      : legacyTrustedExpressionEvaluator
  return createInterpret(dataSource, engine, {
    ...options,
    expressionEvaluator,
    requestHandlersMap: options?.requestHandlersMap || defaultRequestHandlersMap,
  })
}

export interface DataSourcePluginOptions {
  /**
   * 请求处理器映射
   * @default
   * {
   *   fetch: createFetchHandler()
   * }
   */
  requestHandlersMap?: RequestHandlersMap<{ data: unknown }>

  /**
   * 默认数据处理器
   */
  defaultDataHandler?: DataHandler

  /** Policy boundary for executable expressions embedded in datasource schema. */
  expressionEvaluator?: ExpressionEvaluator
}

const DataSourcePlugin: PluginCreator<DataSourcePluginOptions> = options => {
  return {
    name: 'DataSourcePlugin',
    extensionFingerprint: 'DataSourcePlugin:v1',
    deps: [],
    init(ctx) {
      const { config } = ctx

      config.set('dataSourceEngine', {
        createRuntime,
        createInterpret,
        createDataSourceEngine: (dataSource: InterpretDataSource, engine: IDataSourceRuntimeContext) => {
          return createDataSourceEngine(dataSource, engine, options)
        },
      })
    },
    extend({ extend }) {
      extend('Project', {
        dataSource: {
          get() {
            return this.get('dataSource')
          },
        },
      })
    },
  }
}

export default DataSourcePlugin
