import type { DashboardDataJsonValue } from './contract.mjs'

export interface DashboardRendererDataSourceValue {
  readonly page?: Readonly<Record<string, unknown>>
}

export declare const resolveDashboardMaterialBindingValue: (options: {
  readonly bindingField: 'data' | 'text'
  readonly dataBindings?: unknown
  readonly dataSource?: DashboardRendererDataSourceValue
  readonly fallback: unknown
}) => DashboardDataJsonValue | unknown
