import { applySafeDataTransform, parseSafeDataBindings } from './contract.mjs'

export interface DashboardRendererDataSource {
  readonly page?: Readonly<Record<string, unknown>>
}

interface ResolveDashboardMaterialBindingOptions {
  readonly bindingField: 'data' | 'text'
  readonly dataBindings?: unknown
  readonly dataSource?: DashboardRendererDataSource
  readonly fallback: unknown
}

/**
 * Resolves a declarative material binding from the renderer-provided page data.
 * Materials stay presentation-only: fetching and credential handling remain in
 * the shared datasource runtime.
 */
export const resolveDashboardMaterialBinding = ({
  bindingField,
  dataBindings,
  dataSource,
  fallback,
}: ResolveDashboardMaterialBindingOptions): unknown => {
  if (dataBindings === undefined) return fallback

  try {
    const parsed = parseSafeDataBindings(dataBindings)
    const field = parsed.fields[bindingField]
    if (!field) return fallback
    const page = dataSource?.page
    if (!page || !Object.hasOwn(page, field.sourceId)) return fallback
    const sourceValue = page[field.sourceId]
    if (sourceValue === undefined) return fallback
    return field.transform
      ? applySafeDataTransform(sourceValue as Parameters<typeof applySafeDataTransform>[0], field.transform)
      : sourceValue
  } catch {
    return fallback
  }
}

export const resolveDashboardText = (value: unknown, fallback = ''): string => {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

export const resolveDashboardRows = (
  value: unknown,
  fallback: ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<Record<string, unknown>> => {
  if (!Array.isArray(value)) return fallback
  const rows = value.filter(
    (row): row is Record<string, unknown> =>
      row !== null && typeof row === 'object' && !Array.isArray(row) && Object.getPrototypeOf(row) === Object.prototype,
  )
  return rows.length === value.length ? rows : fallback
}
