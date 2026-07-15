import type { PluginContext, PluginCreator } from '@easy-editor/core'
import type { ExpressionEvaluator } from './expression-evaluator'
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
  return createInterpret(dataSource, engine, {
    ...options,
    expressionEvaluator: options?.expressionEvaluator,
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

const dataSourceCapabilityGeneration = Symbol('DataSourcePlugin.capabilityGeneration')

type DataSourceEngineCapability = Readonly<{
  [dataSourceCapabilityGeneration]: symbol
  createRuntime: (...args: Parameters<typeof createRuntime>) => ReturnType<typeof createRuntime>
  createInterpret: (...args: Parameters<typeof createInterpret>) => ReturnType<typeof createInterpret>
  createDataSourceEngine: (
    dataSource: InterpretDataSource,
    engine: IDataSourceRuntimeContext,
  ) => ReturnType<typeof createDataSourceEngine>
}>

interface DataSourcePluginState {
  capability: DataSourceEngineCapability
  capabilityGeneration: symbol
  deactivate: () => void
  hadPreviousCapability: boolean
  previousCapability: unknown
}

const DataSourcePlugin: PluginCreator<DataSourcePluginOptions> = options => {
  const configKey = 'dataSourceEngine'
  const states = new WeakMap<PluginContext, DataSourcePluginState>()

  return {
    name: 'DataSourcePlugin',
    deps: [],
    init(ctx) {
      const { config } = ctx
      const hadPreviousCapability = config.has(configKey)
      const previousCapability = config.get(configKey)
      const capabilityGeneration = Symbol('DataSourcePlugin.generation')
      let active = true
      const assertActive = () => {
        if (!active) throw new Error('DataSourcePlugin capability is disposed or stale')
      }
      const capability: DataSourceEngineCapability = Object.freeze({
        [dataSourceCapabilityGeneration]: capabilityGeneration,
        createRuntime(...args: Parameters<typeof createRuntime>): ReturnType<typeof createRuntime> {
          assertActive()
          return createRuntime(...args)
        },
        createInterpret(...args: Parameters<typeof createInterpret>): ReturnType<typeof createInterpret> {
          assertActive()
          return createInterpret(...args)
        },
        createDataSourceEngine(dataSource: InterpretDataSource, engine: IDataSourceRuntimeContext) {
          assertActive()
          return createDataSourceEngine(dataSource, engine, options)
        },
      })
      const state: DataSourcePluginState = {
        capability,
        capabilityGeneration,
        deactivate: () => {
          active = false
        },
        hadPreviousCapability,
        previousCapability,
      }
      states.set(ctx, state)

      ctx.onDispose(() => {
        state.deactivate()
        states.delete(ctx)
      })

      try {
        config.set(configKey, capability)
      } catch (error) {
        state.deactivate()
        states.delete(ctx)
        try {
          if (config.get(configKey) === capability) {
            config.set(configKey, hadPreviousCapability ? previousCapability : undefined)
          }
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'DataSourcePlugin capability publication failed to roll back',
          )
        }
        throw error
      }
    },
    destroy(ctx) {
      const state = states.get(ctx)
      if (!state) return

      state.deactivate()
      const { config } = ctx
      let currentCapability: unknown
      try {
        currentCapability = config.get(configKey)
      } catch {
        // Engine disposal retires PluginContext capability views before plugin
        // hooks run. The root Config is cleared later by the engine; only the
        // locally retained datasource capability still needs revocation here.
        states.delete(ctx)
        return
      }
      if (
        currentCapability &&
        (typeof currentCapability === 'object' || typeof currentCapability === 'function') &&
        Reflect.get(currentCapability, dataSourceCapabilityGeneration) === state.capabilityGeneration
      ) {
        config.set(configKey, state.hadPreviousCapability ? state.previousCapability : undefined)
      }
      states.delete(ctx)
    },
  }
}

export default DataSourcePlugin
