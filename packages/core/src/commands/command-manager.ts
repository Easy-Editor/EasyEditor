import type { TransactionManager } from './transaction-manager'
import type { EditorCommand, TransactionResult } from './types'

export class CommandManager {
  constructor(private readonly transactions: TransactionManager) {}

  execute(command: EditorCommand): TransactionResult {
    return this.transactions.run([command])
  }
}
