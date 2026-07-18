import type {
  DashboardDurableAgentCommitResult,
  DashboardDurableAgentWriteSession,
  DashboardPersistenceRuntime,
} from '../../persistence-runtime.js'
import type { ReceiptIntentV1 } from '../persistence/receipt-ledger.mjs'
import type { DashboardAgentHostPersistence } from './index.mjs'

export declare const createDashboardHostPersistenceFacade: (
  persistence: Pick<
    DashboardPersistenceRuntime,
    | 'runAgentMutation'
    | 'readCompensationRun'
    | 'readCompensationTargetClaim'
    | 'commitCompensationRunState'
    | 'recoverDurableAgentReceipt'
    | 'runDurableAgentWrite'
  >,
  options?: Readonly<{
    afterRecordIntent?: (intent: ReceiptIntentV1) => void | PromiseLike<void>
    afterCommitBatch?: (result: DashboardDurableAgentCommitResult) => void | PromiseLike<void>
  }>,
) => DashboardAgentHostPersistence &
  Readonly<{
    runDurableAgentWrite<T>(operation: (session: DashboardDurableAgentWriteSession) => Promise<T>): Promise<T>
  }>
