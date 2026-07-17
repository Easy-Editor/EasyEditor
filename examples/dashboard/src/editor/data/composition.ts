import type { DataSource, DataSourceItem, ProjectSchema, RootSchema } from '@easy-editor/core'
import { parseSafeDataCatalog } from './contract.mjs'

export const DASHBOARD_SAFE_DATA_SOURCE_TYPE = 'dashboard-safe-v1'

interface ComposeDashboardDataSourceOptions {
  readonly safeDataEnabled?: boolean
}

type LegacyDataSource = DataSource & {
  readonly dataHandler?: unknown
  readonly list?: readonly DataSourceItem[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const readLegacyList = (dataSource: unknown): readonly DataSourceItem[] => {
  if (!isRecord(dataSource)) return []
  return Array.isArray(dataSource.list) ? (dataSource.list as DataSourceItem[]) : []
}

const assertLegacyId = (item: DataSourceItem): string => {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length === 0) {
    throw new Error('Dashboard legacy datasource entries require a non-empty id')
  }
  return item.id
}

export const composeDashboardDataSource = (
  projectDataSource: unknown,
  rootDataSource: unknown,
  safeCatalogValue: unknown,
  { safeDataEnabled = false }: ComposeDashboardDataSourceOptions = {},
): DataSource => {
  const mergedLegacy = new Map<string, DataSourceItem>()
  for (const item of readLegacyList(projectDataSource)) mergedLegacy.set(assertLegacyId(item), item)
  for (const item of readLegacyList(rootDataSource)) mergedLegacy.set(assertLegacyId(item), item)

  const safeCatalog = safeDataEnabled
    ? parseSafeDataCatalog(safeCatalogValue ?? { schemaVersion: 1, sources: [] })
    : { schemaVersion: 1 as const, sources: [] }
  const compiledSafe = safeCatalog.sources.map(descriptor => {
    if (mergedLegacy.has(descriptor.id)) {
      throw new Error(`Safe datasource id collides with a legacy datasource: ${descriptor.id}`)
    }
    return {
      id: descriptor.id,
      isInit: true,
      isSync: false,
      type: DASHBOARD_SAFE_DATA_SOURCE_TYPE,
      options: {
        uri: `dashboard-safe://${encodeURIComponent(descriptor.id)}`,
        descriptor,
      },
    } as unknown as DataSourceItem
  })

  const project = isRecord(projectDataSource) ? (projectDataSource as LegacyDataSource) : undefined
  const root = isRecord(rootDataSource) ? (rootDataSource as LegacyDataSource) : undefined
  return {
    list: [...mergedLegacy.values(), ...compiledSafe],
    ...(root?.dataHandler !== undefined
      ? { dataHandler: root.dataHandler }
      : project?.dataHandler !== undefined
        ? { dataHandler: project.dataHandler }
        : {}),
  } as DataSource
}

export const composeDashboardRootSchema = (
  project: ProjectSchema,
  root: RootSchema,
  options: ComposeDashboardDataSourceOptions = {},
): RootSchema => ({
  ...root,
  dataSource: composeDashboardDataSource(project.dataSource, root.dataSource, root.props?.dataSources, options),
})
