import { transactionManagerConstructionAuthority } from './transaction-boundary'
import type { TransactionManager } from './transaction-manager'
import type { EditorCommand, TransactionResult } from './types'

export class CommandManager {
  readonly #transactions: TransactionManager

  constructor(transactions: TransactionManager, authority: unknown) {
    if (authority !== transactionManagerConstructionAuthority) {
      throw new TypeError('CommandManager can only be constructed by an EngineInstance')
    }
    this.#transactions = transactions
    Object.freeze(this)
  }

  execute(command: EditorCommand): TransactionResult {
    return this.#transactions.run([command])
  }
}

Object.defineProperty(CommandManager.prototype, 'constructor', {
  configurable: false,
  enumerable: false,
  value: undefined,
  writable: false,
})
Object.freeze(CommandManager.prototype)
