import type { DataSource } from '@easy-editor/core'
import {
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
  reloadDataSources(): Promise<void>
  refreshAfterRerender(
    rerenderAndWaitForCommit: (signal: AbortSignal) => void | Promise<void>,
    rerenderAndWaitForReloadCommit?: (signal: AbortSignal) => void | Promise<void>,
  ): Promise<void>
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
  let reloadDataSources: (() => Promise<void>) | null = null
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
  const assertActive = () => {
    if (lifecycle.signal.aborted) throw new Error('Dashboard data runtime is disposed')
  }
  const dataSourceEngine = Object.freeze({
    createDataSourceEngine: (dataSource: DataSource, engine: unknown) => {
      assertActive()
      const runtime = createDataSourceEngine(
        dataSource as Parameters<typeof createDataSourceEngine>[0],
        engine as Parameters<typeof createDataSourceEngine>[1],
        pluginOptions,
      )
      // React renderer compatibility seam: only PageRenderer owns the page-level
      // datasource closure; component renderers use the sibling `component` namespace.
      if ((engine as { readonly __namespace?: unknown } | null)?.__namespace === 'page') {
        reloadDataSources = runtime.reloadDataSource
      }
      return runtime
    },
  })

  const dashboardDataRuntime: DashboardDataRuntime = {
    dataSourceEngine,
    async reloadDataSources() {
      assertActive()
      if (!reloadDataSources) throw new Error('Dashboard data runtime is not connected to a renderer')
      await reloadDataSources()
    },
    async refreshAfterRerender(rerenderAndWaitForCommit, rerenderAndWaitForReloadCommit) {
      assertActive()
      if (typeof rerenderAndWaitForCommit !== 'function') {
        throw new TypeError('Dashboard data refresh requires a renderer commit fence')
      }
      if (rerenderAndWaitForReloadCommit !== undefined && typeof rerenderAndWaitForReloadCommit !== 'function') {
        throw new TypeError('Dashboard data refresh reload commit fence must be a function')
      }
      await rerenderAndWaitForCommit(lifecycle.signal)
      assertActive()
      await dashboardDataRuntime.reloadDataSources()
      if (rerenderAndWaitForReloadCommit) {
        assertActive()
        await rerenderAndWaitForReloadCommit(lifecycle.signal)
        assertActive()
      }
    },
    dispose: () => {
      if (lifecycle.signal.aborted) return
      reloadDataSources = null
      const error = new Error('Dashboard data runtime is disposed')
      lifecycle.abort(error)
    },
  }
  return Object.freeze(dashboardDataRuntime)
}
