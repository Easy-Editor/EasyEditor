import type { Materials } from './materials'
import type { MaterialRegistryTransactionState } from './registry/transaction-boundary'

interface MaterialsTransactionOperations {
  begin(): MaterialRegistryTransactionState
  commit(state: MaterialRegistryTransactionState): void
  restore(state: MaterialRegistryTransactionState): void
}

const operations = new WeakMap<Materials, MaterialsTransactionOperations>()

export function installMaterialsTransactionOperations(
  materials: Materials,
  transactionOperations: MaterialsTransactionOperations,
): void {
  if (operations.has(materials)) throw new Error('Materials transaction operations are already installed')
  operations.set(materials, transactionOperations)
}

const requireOperations = (materials: Materials): MaterialsTransactionOperations => {
  const transactionOperations = operations.get(materials)
  if (!transactionOperations) throw new Error('Materials transaction operations are not installed')
  return transactionOperations
}

export const beginMaterialsTransaction = (materials: Materials): MaterialRegistryTransactionState =>
  requireOperations(materials).begin()

export const commitMaterialsTransaction = (materials: Materials, state: MaterialRegistryTransactionState): void =>
  requireOperations(materials).commit(state)

export const restoreMaterialsTransaction = (materials: Materials, state: MaterialRegistryTransactionState): void =>
  requireOperations(materials).restore(state)
