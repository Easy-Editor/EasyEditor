import type { DataSource } from '@easy-editor/core'
import DataSourcePlugin, {
  type DataSourcePluginOptions,
  createDataSourceEngine,
  defaultRequestHandlersMap,
} from '@easy-editor/plugin-datasource'
import { DASHBOARD_SAFE_DATA_SOURCE_TYPE } from './composition'
import { createDashboardSameOriginDataResolver, parseSafeDataDescriptor } from './contract.mjs'

interface DashboardDataRuntimeOptions {
  readonly expressionEvaluator: NonNullable<DataSourcePluginOptions['expressionEvaluator']>
  readonly fetchImpl?: typeof fetch
  readonly getProjectId: () => string | null | undefined
  readonly safeDataEnabled?: boolean
}

interface DashboardSafeRequestHandlerOptions {
  readonly fetchImpl: typeof fetch
  readonly getProjectId: () => string | null | undefined
  readonly safeDataEnabled: boolean
  readonly signal: AbortSignal
}

export interface DashboardDataRuntime {
  readonly dataSourceEngine: Readonly<{
    createDataSourceEngine(dataSource: DataSource, engine: unknown): ReturnType<typeof createDataSourceEngine>
  }>
  readonly plugin: ReturnType<typeof DataSourcePlugin>
  dispose(): void
}

export const createDashboardSafeRequestHandler = ({
  fetchImpl,
  getProjectId,
  safeDataEnabled,
  signal,
}: DashboardSafeRequestHandlerOptions): NonNullable<DataSourcePluginOptions['requestHandlersMap']>[string] => {
  const resolver = createDashboardSameOriginDataResolver({ fetchImpl })
  return async (options: Parameters<NonNullable<DataSourcePluginOptions['requestHandlersMap']>[string]>[0]) => {
    if (signal.aborted) throw new Error('Dashboard data runtime is disposed')
    if (!safeDataEnabled) throw new Error('Dashboard safe data feature is disabled')
    const descriptor = parseSafeDataDescriptor(options.descriptor)
    const projectId = getProjectId() ?? undefined
    const data = await resolver.resolve(descriptor, {
      signal,
      ...(descriptor.kind === 'credentialed-http-json' ? { projectId } : {}),
    })
    return { data }
  }
}

export const createDashboardDataRuntime = ({
  expressionEvaluator,
  fetchImpl = window.fetch.bind(window),
  getProjectId,
  safeDataEnabled = false,
}: DashboardDataRuntimeOptions): DashboardDataRuntime => {
  const lifecycle = new AbortController()
  const safeRequestHandler = createDashboardSafeRequestHandler({
    fetchImpl,
    getProjectId,
    safeDataEnabled,
    signal: lifecycle.signal,
  })
  const pluginOptions: DataSourcePluginOptions = {
    expressionEvaluator,
    requestHandlersMap: {
      ...defaultRequestHandlersMap,
      [DASHBOARD_SAFE_DATA_SOURCE_TYPE]: safeRequestHandler,
    },
  }
  const dataSourceEngine = Object.freeze({
    createDataSourceEngine: (dataSource: DataSource, engine: unknown) =>
      createDataSourceEngine(
        dataSource as Parameters<typeof createDataSourceEngine>[0],
        engine as Parameters<typeof createDataSourceEngine>[1],
        pluginOptions,
      ),
  })

  return Object.freeze({
    dataSourceEngine,
    plugin: DataSourcePlugin(pluginOptions),
    dispose: () => lifecycle.abort(new Error('dashboard-data-runtime-disposed')),
  })
}
