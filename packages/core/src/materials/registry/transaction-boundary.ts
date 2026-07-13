import type { Component } from '../../types'
import type { ComponentMeta } from '../component-meta'
import type { ComponentMetaTransactionState } from '../component-meta-transaction'
import type { MaterialRegistry } from './material-registry'
import type { MaterialSource, MaterialStatus } from './types'

export interface MaterialEntryTransactionState {
  readonly component?: Component
  readonly componentName: string
  readonly extensions?: ReadonlyMap<string, unknown>
  readonly lastAccessedAt: number
  readonly loadedAt: number
  readonly meta: ComponentMeta
  readonly metaState: ComponentMetaTransactionState
  readonly source: MaterialSource
  readonly status: MaterialStatus
  readonly usageCount: number
  readonly version?: string
}

export interface MaterialRegistryTransactionState {
  readonly entries: Map<string, MaterialEntryTransactionState>
  readonly pendingEntries: Map<string, MaterialEntryTransactionState>
  readonly token: object
  readonly version: number
}

interface MaterialRegistryTransactionOperations {
  begin(): MaterialRegistryTransactionState
  commit(state: MaterialRegistryTransactionState): void
  restore(state: MaterialRegistryTransactionState): void
}

const operations = new WeakMap<MaterialRegistry, MaterialRegistryTransactionOperations>()

export function installMaterialRegistryTransactionOperations(
  registry: MaterialRegistry,
  transactionOperations: MaterialRegistryTransactionOperations,
): void {
  if (operations.has(registry)) throw new Error('Material registry transaction operations are already installed')
  operations.set(registry, transactionOperations)
}

const requireOperations = (registry: MaterialRegistry): MaterialRegistryTransactionOperations => {
  const transactionOperations = operations.get(registry)
  if (!transactionOperations) throw new Error('Material registry transaction operations are not installed')
  return transactionOperations
}

export const beginMaterialRegistryTransaction = (registry: MaterialRegistry): MaterialRegistryTransactionState =>
  requireOperations(registry).begin()

export const commitMaterialRegistryTransaction = (
  registry: MaterialRegistry,
  state: MaterialRegistryTransactionState,
): void => requireOperations(registry).commit(state)

export const restoreMaterialRegistryTransaction = (
  registry: MaterialRegistry,
  state: MaterialRegistryTransactionState,
): void => requireOperations(registry).restore(state)
