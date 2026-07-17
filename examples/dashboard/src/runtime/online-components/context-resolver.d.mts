import type { OnlineComponentJsonValue } from './surface-protocol.mjs'

export interface DashboardOnlineComponentResolvedContext {
  readonly props: Readonly<Record<string, OnlineComponentJsonValue>>
  readonly data: OnlineComponentJsonValue
  readonly theme: Readonly<Record<string, OnlineComponentJsonValue>>
  readonly assets: readonly OnlineComponentJsonValue[]
}

export declare const sanitizeDashboardOnlineComponentProps: (
  props: Readonly<Record<string, unknown>>,
) => Readonly<Record<string, OnlineComponentJsonValue>>

export declare const resolveDashboardOnlineComponentContext: (
  props: Readonly<Record<string, unknown>>,
) => DashboardOnlineComponentResolvedContext
