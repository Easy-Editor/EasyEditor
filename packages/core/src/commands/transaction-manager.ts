import { transaction as mobxTransaction } from 'mobx'
import type { Document } from '../document'
import type { Materials } from '../materials'
import type { Project } from '../project'
import { PolicyViolation, type TrustPolicy, findExecutableValue } from '../trust'
import { EventTransactionCoordinator } from '../utils/event-transaction'
import { applyCommand } from './apply-command'
import { validateCommands } from './command-validator'
import type { CommandResult, EditorCommand, TransactionResult } from './types'

export interface TransactionHost {
  assertTrustBoundaryIntegrity?(origin: string): void
  readonly lifecycleState: string
  readonly materials: Materials
  readonly project: Project
  readonly trustPolicy: TrustPolicy
}

interface ActiveTransaction {
  document: Document
  failure: {
    error: unknown
    occurred: boolean
  }
}

export class AsyncTransactionNotSupportedError extends Error {
  readonly name = 'AsyncTransactionNotSupportedError'

  constructor() {
    super('V1 transactions are synchronous; promise-returning callbacks are not supported')
  }
}

export class TransactionCommittedError extends AggregateError {
  readonly name = 'TransactionCommittedError'

  readonly committed = true

  constructor(errors: readonly unknown[]) {
    super(errors, 'The transaction committed, but one or more post-commit observers failed')
  }
}

export class TransactionManager {
  private active?: ActiveTransaction

  constructor(
    private readonly host: TransactionHost,
    private readonly events = new EventTransactionCoordinator(),
  ) {}

  run(commands: readonly EditorCommand[]): TransactionResult {
    this.assertMutable()
    if (!Array.isArray(commands) || commands.length < 1) {
      throw new Error('A transaction requires at least one command')
    }

    const document = this.requireDocument()
    this.preflight(commands, document)
    return this.withTransaction(document, () => {
      const results = commands.map(command => applyCommand(document, command))
      return this.createResult(results)
    })
  }

  runSync<T>(operation: () => T): T {
    this.assertMutable()
    if (typeof operation !== 'function') {
      throw new Error('runSync requires a function')
    }
    if (!this.host.trustPolicy.allowExecutableCommands) {
      throw new PolicyViolation({
        capability: 'command.executable',
        message: 'Callback transactions are disabled by the engine trust policy; use typed commands',
        origin: 'transactions.runSync',
        rule: `${this.host.trustPolicy.name}.command.executable.deny`,
      })
    }
    if (operation.constructor.name === 'AsyncFunction') {
      throw new AsyncTransactionNotSupportedError()
    }

    const document = this.requireDocument()
    return this.withTransaction(document, () => {
      const result = operation()
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new AsyncTransactionNotSupportedError()
      }
      return result
    })
  }

  private withTransaction<T>(document: Document, operation: () => T): T {
    if (this.active) {
      if (this.active.failure.occurred) throw this.active.failure.error
      try {
        const result = operation()
        if (this.active.failure.occurred) throw this.active.failure.error
        return result
      } catch (error) {
        this.active.failure = { error, occurred: true }
        throw error
      }
    }

    const selection = document.designer.selection.selected.slice()
    const materialState = this.host.materials.captureTransactionState()
    const context: ActiveTransaction = {
      document,
      failure: { error: undefined, occurred: false },
    }
    const eventTransaction = this.events.begin()
    this.active = context
    let result!: T
    let failed = false
    let failure: unknown
    let modelCommitted = false
    let mobxExitError: unknown
    const rollbackErrors: unknown[] = []
    try {
      try {
        mobxTransaction(() => {
          let historyStarted = false
          try {
            document.history.beginTransaction()
            historyStarted = true
            result = operation()
            if (context.failure.occurred) throw context.failure.error
            document.history.commitTransaction()
            historyStarted = false
            modelCommitted = true
          } catch (error) {
            failed = true
            failure = error
            if (historyStarted) {
              try {
                document.history.rollbackTransaction()
              } catch (rollbackError) {
                rollbackErrors.push(rollbackError)
              }
            }
            try {
              this.host.materials.restoreTransactionState(materialState)
            } catch (rollbackError) {
              rollbackErrors.push(rollbackError)
            }
            try {
              document.designer.selection.clear()
              document.designer.selection.selectAll(selection)
            } catch (rollbackError) {
              rollbackErrors.push(rollbackError)
            }
          }
        })
      } catch (error) {
        mobxExitError = error
      }
    } finally {
      this.active = undefined
    }

    if (modelCommitted) {
      const postCommitErrors: unknown[] = []
      if (mobxExitError) postCommitErrors.push(mobxExitError)
      try {
        this.events.commit(eventTransaction)
      } catch (error) {
        if (error instanceof AggregateError) {
          postCommitErrors.push(...error.errors)
        } else {
          postCommitErrors.push(error)
        }
      }
      if (postCommitErrors.length) throw new TransactionCommittedError(postCommitErrors)
      return result
    }

    if (mobxExitError) {
      if (failed) {
        rollbackErrors.push(mobxExitError)
      } else {
        failed = true
        failure = mobxExitError
      }
    }

    if (failed) {
      try {
        this.events.rollback(eventTransaction)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      if (rollbackErrors.length) {
        throw new AggregateError([failure, ...rollbackErrors], 'Transaction failed and rollback was incomplete')
      }
      throw failure
    }

    try {
      this.events.rollback(eventTransaction)
    } catch (rollbackError) {
      throw new AggregateError([rollbackError], 'Transaction exited without a commit and event cleanup failed')
    }
    throw new Error('Transaction exited without committing or reporting a failure')
  }

  private assertMutable(): void {
    this.host.assertTrustBoundaryIntegrity?.('transactions.run')
    if (
      this.host.lifecycleState === 'disposing' ||
      this.host.lifecycleState === 'disposed' ||
      this.host.lifecycleState === 'failed'
    ) {
      throw new Error(`Cannot start a transaction while engine is ${this.host.lifecycleState}`)
    }
  }

  private requireDocument(): Document {
    const document = this.active?.document || this.host.project.currentDocument
    if (!document?.root) {
      throw new Error('A V1 transaction requires an active document with a root node')
    }
    return document
  }

  private preflight(commands: readonly EditorCommand[], document: Document) {
    for (const command of commands) {
      const executable = findExecutableValue(command)
      if (executable && !this.host.trustPolicy.allowExecutableCommands) {
        throw new PolicyViolation({
          capability: 'command.executable',
          details: executable,
          message: `Executable command value ${executable.type} is not allowed at ${executable.path}`,
          origin: 'commands.execute',
          path: executable.path,
          rule: `${this.host.trustPolicy.name}.command.executable.deny`,
        })
      }
    }
    validateCommands(commands)
    for (const command of commands) {
      if (command.documentId && command.documentId !== document.id) {
        throw new Error(`Cross-document command is not allowed in V1: ${command.documentId}`)
      }
    }
  }

  private createResult(results: CommandResult[]): TransactionResult {
    return {
      affectedNodeIds: [...new Set(results.flatMap(result => result.affectedNodeIds))],
      commandCount: results.length,
      ok: true,
    }
  }
}
