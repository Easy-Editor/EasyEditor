import type { WorkerTelemetrySink } from '@easy-editor/agent-runtime/worker'

export type DashboardTelemetryEventType =
  | 'dashboard.call.observed'
  | 'dashboard.snapshot.captured'
  | 'dashboard.screen.prepare'
  | 'dashboard.screen.commit'
  | 'dashboard.screen.verify'
  | 'dashboard.screen.stale'
  | 'dashboard.receipt.recovery'
  | 'dashboard.persistence.read'
  | 'dashboard.persistence.commit'
  | 'dashboard.compensation.result'
  | 'dashboard.iframe.batch'
  | 'dashboard.iframe.fault'
  | 'dashboard.iframe.restart'
  | 'dashboard.artifact.resolution'
  | 'dashboard.artifact.revision'
  | 'dashboard.promotion.status'

export interface DashboardAgentTelemetryEvent {
  readonly schemaVersion: 1
  readonly eventType: string
  readonly timestampMs: number
  readonly durationMs?: number
  readonly byteCount?: number
  readonly status?: string
  readonly errorCode?: string
  readonly diagnosticCode?: string
  readonly sessionId?: string
  readonly taskId?: string
  readonly stepId?: string
  readonly callId?: string
  readonly modelRequestId?: string
  readonly changeSetId?: string
  readonly artifactId?: string
  readonly sourceRevision?: string
  readonly artifactRevision?: string
  readonly projectRevision?: string
  readonly expectedProjectRevision?: string
  readonly currentProjectRevision?: string
  readonly snapshotMode?: 'full' | 'delta'
  readonly receiptClassification?: 'committed' | 'failed' | 'missing' | 'indeterminate'
  readonly persistenceGeneration?: number
  readonly recordCount?: number
  readonly appliedCount?: number
  readonly conflictCount?: number
  readonly surfaceId?: string
  readonly batchSize?: number
  readonly instanceCount?: number
  readonly revisionKey?: string
  readonly payloadHash?: `sha256:${string}`
  readonly dependencyLockDigest?: `sha256:${string}`
  readonly promotionStatus?: 'prepared' | 'registry-active' | 'committed' | 'failed' | 'recovered'
  readonly resolutionStatus?: 'resolved' | 'rejected' | 'failed'
  readonly phase?: 'BLUEPRINT' | 'PLAN_STEP' | 'REPAIR' | 'COMPENSATION' | 'RECOVERY'
  readonly tokenBudget?: number
  readonly disposition?: 'yielded' | 'repair' | 'paused'
  readonly reason?: string
  readonly receiptDisposition?:
    | 'missing'
    | 'applied'
    | 'not-applied'
    | 'rejected'
    | 'indeterminate'
    | 'resume-safe-retry'
}

export interface DashboardAgentTelemetryQuery {
  readonly sessionId?: string
  readonly taskId?: string
  readonly stepId?: string
  readonly callId?: string
  readonly changeSetId?: string
  readonly modelRequestId?: string
  readonly artifactId?: string
  readonly sourceRevision?: string
  readonly artifactRevision?: string
  readonly eventType?: string
}

export interface DashboardAgentTelemetryStats {
  readonly capacity: number
  readonly size: number
  readonly accepted: number
  readonly dropped: number
  readonly failed: number
}

export interface DashboardAgentTelemetryLedger {
  append(input: unknown): DashboardAgentTelemetryEvent
  record(input: unknown): DashboardAgentTelemetryEvent | null
  query(filter: DashboardAgentTelemetryQuery): readonly DashboardAgentTelemetryEvent[]
  stats(): DashboardAgentTelemetryStats
  readonly sink: WorkerTelemetrySink
}

export declare const createDashboardAgentTelemetryLedger: (options?: {
  readonly capacity?: number
}) => DashboardAgentTelemetryLedger
