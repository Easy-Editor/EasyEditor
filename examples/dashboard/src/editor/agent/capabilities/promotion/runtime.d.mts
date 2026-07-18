import type { DashboardLocalGrantCheckV1, DashboardLocalGrantDecisionV1 } from '../../../../lib/storage/lifecycle.mjs'
import type { AgentRuntimeFeatureFlags } from '../../feature-flags.mjs'
import type { DashboardSameOriginLocalMaterialPromotionClient } from './client.mjs'
import type {
  DashboardLocalMaterialPromotionCapabilityService,
  DashboardLocalMaterialPromotionCapabilityServiceOptions,
} from './service.mjs'

export type LocalMaterialPromotionAvailabilityReason =
  | 'agent-runtime-disabled'
  | 'online-component-feature-disabled'
  | 'promotion-feature-disabled'
  | 'promotion-requires-node-20'
  | 'promotion-server-unavailable'
  | 'promotion-local-grant-required'

export declare const LOCAL_MATERIAL_PROMOTION_AVAILABILITY_REASON: Readonly<{
  runtimeDisabled: 'agent-runtime-disabled'
  onlineDisabled: 'online-component-feature-disabled'
  featureDisabled: 'promotion-feature-disabled'
  nodeVersionUnsupported: 'promotion-requires-node-20'
  serverUnavailable: 'promotion-server-unavailable'
  localGrantRequired: 'promotion-local-grant-required'
}>

export declare const LOCAL_MATERIAL_PROMOTION_POLICY: Readonly<{
  scope: 'material.promote.local'
  policyVersion: 'dashboard-local-material-promotion/1'
  providerId: 'dashboard-same-origin-promotion'
  providerFingerprint: 'same-origin:/api/materials/promote'
}>

export interface LocalMaterialPromotionGrantIdentity {
  readonly userId: string
  readonly scope?: 'material.promote.local'
  readonly policyVersion: string | number
  readonly providerId: string
  readonly providerFingerprint: string
}

export interface DashboardLocalMaterialPromotionRuntime {
  readonly promotionService: DashboardLocalMaterialPromotionCapabilityService | null
  readonly promotionAvailability: () => Promise<
    Readonly<{ available: boolean; reason: LocalMaterialPromotionAvailabilityReason | null }>
  >
}

export declare const createDashboardLocalMaterialPromotionRuntime: (options: {
  readonly authority: DashboardLocalMaterialPromotionCapabilityServiceOptions['authority']
  readonly featureFlags: AgentRuntimeFeatureFlags
  readonly client?: DashboardSameOriginLocalMaterialPromotionClient
  readonly core?: DashboardLocalMaterialPromotionCapabilityServiceOptions['core']
  readonly crypto?: Crypto
  readonly grantIdentity?: LocalMaterialPromotionGrantIdentity
  readonly persistence?: DashboardLocalMaterialPromotionCapabilityServiceOptions['persistence'] & {
    checkLocalGrant(request: DashboardLocalGrantCheckV1): Promise<DashboardLocalGrantDecisionV1>
  }
  readonly now?: () => number
  readonly isTransactionCommittedError?: (error: unknown) => boolean
  readonly isTransactionRollbackIncompleteError?: (error: unknown) => boolean
}) => DashboardLocalMaterialPromotionRuntime
