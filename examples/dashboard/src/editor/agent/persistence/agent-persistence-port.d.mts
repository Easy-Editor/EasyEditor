import type { AgentPersistencePort } from '@easy-editor/agent-runtime'
import type {
  DashboardAgentPersistenceBatchV1,
  DashboardAgentPersistenceCommitResultV1,
  DashboardAgentPersistenceReadRequestV1,
  DashboardAgentPersistenceReadResultV1,
} from '../../../lib/storage/contracts.mjs'
import type { DashboardAgentTelemetryLedger } from '../telemetry/index.mjs'

export interface DashboardAgentPersistenceFacade {
  readAgentPersistence(request: DashboardAgentPersistenceReadRequestV1): Promise<DashboardAgentPersistenceReadResultV1>
  commitAgentPersistence(batch: DashboardAgentPersistenceBatchV1): Promise<DashboardAgentPersistenceCommitResultV1>
}

export declare const createDashboardAgentPersistencePort: (
  persistence: DashboardAgentPersistenceFacade,
  options?: Readonly<{
    telemetry?: Pick<DashboardAgentTelemetryLedger, 'record'>
    now?: () => number
  }>,
) => AgentPersistencePort
