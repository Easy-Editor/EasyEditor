import type { ComponentMetadata, NpmInfo } from '../types'
import type { ComponentMeta } from './component-meta'

export interface ComponentMetaTransactionState {
  readonly componentName?: string
  readonly descriptor?: string
  readonly disposeCompleted: boolean
  readonly disposeStarted: boolean
  readonly isContainer?: boolean
  readonly isMinimalRenderUnit?: boolean
  readonly metadata?: ComponentMetadata
  readonly npm?: NpmInfo
  readonly title?: string
}

interface ComponentMetaTransactionOperations {
  capture(): ComponentMetaTransactionState
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

export const restoreComponentMetaTransactionState = (meta: ComponentMeta, state: ComponentMetaTransactionState): void =>
  requireOperations(meta).restore(state)
