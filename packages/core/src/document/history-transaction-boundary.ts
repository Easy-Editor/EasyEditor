import type { History } from './history'

interface HistoryTransactionOperations {
  begin(): void
  cancel(): void
  commit(): void
  isActive(): boolean
  rollback(): void
}

const historyTransactionOperations = new WeakMap<object, HistoryTransactionOperations>()

export function installHistoryTransactionOperations<T>(
  history: History<T>,
  operations: HistoryTransactionOperations,
): void {
  if (historyTransactionOperations.has(history)) {
    throw new Error('History transaction operations are already installed')
  }
  historyTransactionOperations.set(history, operations)
}

const requireOperations = <T>(history: History<T>): HistoryTransactionOperations => {
  const operations = historyTransactionOperations.get(history)
  if (!operations) throw new Error('History transaction operations are not installed')
  return operations
}

export const beginHistoryTransaction = <T>(history: History<T>): void => requireOperations(history).begin()

export const cancelHistoryTransaction = <T>(history: History<T>): void => requireOperations(history).cancel()

export const commitHistoryTransaction = <T>(history: History<T>): void => requireOperations(history).commit()

export const isHistoryTransactionActive = <T>(history: History<T>): boolean => requireOperations(history).isActive()

export const rollbackHistoryTransaction = <T>(history: History<T>): void => requireOperations(history).rollback()
