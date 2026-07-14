import type { Document } from '../document'
import type { BoundTransactionOptions, TransactionManager } from './transaction-manager'
import type { EditorCommand, TransactionResult } from './types'

interface TransactionBoundaryOperations {
  isActive(): boolean
  runValidatedOnDocument(
    document: Document,
    commands: readonly EditorCommand[],
    options: BoundTransactionOptions,
  ): TransactionResult
}

const transactionBoundaryOperations = new WeakMap<TransactionManager, TransactionBoundaryOperations>()

/** Package-private construction authority for engine-owned transaction roots. */
export const transactionManagerConstructionAuthority: unique symbol = Symbol('TransactionManagerConstructionAuthority')

export function installTransactionBoundaryOperations(
  manager: TransactionManager,
  operations: TransactionBoundaryOperations,
): void {
  if (transactionBoundaryOperations.has(manager))
    throw new Error('Transaction boundary operations are already installed')
  transactionBoundaryOperations.set(manager, operations)
}

export function runValidatedTransactionOnDocument(
  manager: TransactionManager,
  document: Document,
  commands: readonly EditorCommand[],
  options: BoundTransactionOptions,
): TransactionResult {
  const operations = transactionBoundaryOperations.get(manager)
  if (!operations) throw new Error('Transaction boundary operations are not installed')
  return operations.runValidatedOnDocument(document, commands, options)
}

/** Package-private lifecycle gate; transactions never expose their mutable context. */
export function isTransactionBoundaryActive(manager: TransactionManager): boolean {
  const operations = transactionBoundaryOperations.get(manager)
  if (!operations) throw new Error('Transaction boundary operations are not installed')
  return operations.isActive()
}
