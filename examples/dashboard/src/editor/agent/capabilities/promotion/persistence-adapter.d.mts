import type {
  DashboardAgentPersistenceBatchV1,
  DashboardAgentPersistenceCommitResultV1,
  DashboardAgentPersistenceReadRequestV1,
  DashboardAgentPersistenceReadResultV1,
} from '../../../../lib/storage/contracts.mjs'
import type { DashboardLocalGrantCheckV1, DashboardLocalGrantDecisionV1 } from '../../../../lib/storage/lifecycle.mjs'
import type {
  DashboardLocalMaterialPromotionCapabilityServiceOptions,
  LocalMaterialPromotionPersistencePort,
} from './service.mjs'

export interface DashboardLocalMaterialPromotionPersistenceFacade
  extends Pick<
    LocalMaterialPromotionPersistencePort,
    'readArtifact' | 'recoverDurableAgentReceipt' | 'runDurableAgentWrite'
  > {
  readAgentPersistence(request: DashboardAgentPersistenceReadRequestV1): Promise<DashboardAgentPersistenceReadResultV1>
  commitAgentPersistence(batch: DashboardAgentPersistenceBatchV1): Promise<DashboardAgentPersistenceCommitResultV1>
  checkLocalGrant(request: DashboardLocalGrantCheckV1): Promise<DashboardLocalGrantDecisionV1>
}

export type DashboardLocalMaterialPromotionPersistenceAdapter = LocalMaterialPromotionPersistencePort &
  Pick<DashboardLocalMaterialPromotionPersistenceFacade, 'checkLocalGrant'>

export declare const createDashboardLocalMaterialPromotionPersistenceAdapter: (options: {
  readonly authority: DashboardLocalMaterialPromotionCapabilityServiceOptions['authority']
  readonly persistence: DashboardLocalMaterialPromotionPersistenceFacade
}) => DashboardLocalMaterialPromotionPersistenceAdapter
