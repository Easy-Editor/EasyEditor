import type { WorkerTelemetryEvent, WorkerTelemetrySink } from '@easy-editor/agent-runtime/worker'

export declare const parseWorkerTelemetryControlEvent: (value: unknown) => WorkerTelemetryEvent

export interface MainThreadWorkerTelemetryDelivery {
  emit(event: WorkerTelemetryEvent): void
  stats(): Readonly<{ pending: number; dropped: number; failed: number }>
}

export declare const createMainThreadWorkerTelemetryDelivery: (
  sink: WorkerTelemetrySink | undefined,
  options?: Readonly<{ maxPending?: number }>,
) => MainThreadWorkerTelemetryDelivery
