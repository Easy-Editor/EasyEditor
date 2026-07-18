export interface DashboardTelemetryChannel {
  readonly enabled: boolean
  start(): number | null
  emit(event: Readonly<Record<string, unknown>>, startedAt?: number | null): void
}

export declare const createDashboardTelemetryChannel: (
  telemetry?: Readonly<{ record(event: Readonly<Record<string, unknown>>): unknown }> | null,
  clock?: () => number,
) => DashboardTelemetryChannel
