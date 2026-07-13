import type { ComponentMetadata } from '../types'
import type { ComponentMeta } from './component-meta'

export interface ComponentMetaTransactionState {
  readonly disposeCompleted: boolean
  readonly disposeStarted: boolean
  readonly metadata: Readonly<ComponentMetadata>
}

interface ComponentMetaTransactionOperations {
  capture(): ComponentMetaTransactionState
  replace(metadata: ComponentMetadata): void
  restore(state: ComponentMetaTransactionState): void
}

const operations = new WeakMap<ComponentMeta, ComponentMetaTransactionOperations>()

export function installComponentMetaTransactionOperations(
  meta: ComponentMeta,
  transactionOperations: ComponentMetaTransactionOperations,
): void {
  if (operations.has(meta)) throw new Error('Component metadata transaction operations are already installed')
  operations.set(meta, transactionOperations)
}

const requireOperations = (meta: ComponentMeta): ComponentMetaTransactionOperations => {
  const transactionOperations = operations.get(meta)
  if (!transactionOperations) throw new Error('Component metadata transaction operations are not installed')
  return transactionOperations
}

export const captureComponentMetaTransactionState = (meta: ComponentMeta): ComponentMetaTransactionState =>
  requireOperations(meta).capture()

export const replaceComponentMetaMetadata = (meta: ComponentMeta, metadata: ComponentMetadata): void =>
  requireOperations(meta).replace(metadata)

export const restoreComponentMetaTransactionState = (meta: ComponentMeta, state: ComponentMetaTransactionState): void =>
  requireOperations(meta).restore(state)
