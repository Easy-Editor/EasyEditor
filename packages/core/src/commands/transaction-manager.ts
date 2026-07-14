import { transaction as mobxTransaction } from 'mobx'
import type { Document } from '../document'
import {
  beginHistoryTransaction,
  cancelHistoryTransaction,
  commitHistoryTransaction,
  rollbackHistoryTransaction,
} from '../document/history-transaction-boundary'
import type { Materials } from '../materials'
import {
  beginMaterialsTransaction,
  commitMaterialsTransaction,
  restoreMaterialsTransaction,
} from '../materials/transaction-boundary'
import type { Project } from '../project'
import { beginDocumentMutationBoundary } from '../project/document-mutation-boundary'
import { withProjectMutationAuthority } from '../project/mutation-authority'
import { PolicyViolation, type TrustPolicy, findExecutableValue } from '../trust'
import type { EventTransactionCoordinator } from '../utils/event-transaction'
import { applyCommand } from './apply-command'
import { validateCommands } from './command-validator'
import { installTransactionBoundaryOperations, transactionManagerConstructionAuthority } from './transaction-boundary'
import type { CommandResult, EditorCommand, TransactionResult } from './types'

export interface TransactionHost {
  assertCompositionMutationAllowed?(origin: string): void
  assertTrustBoundaryIntegrity?(origin: string): void
  readonly lifecycleState: string
  readonly materials: Materials
  readonly project: Project
  readonly trustPolicy: TrustPolicy
}

interface ActiveTransaction {
  acceptsNestedOperations: boolean
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

export class TransactionCommittedError<T = unknown> extends AggregateError {
  readonly name = 'TransactionCommittedError'

  readonly committed = true

  constructor(
    errors: readonly unknown[],
    readonly result: T,
  ) {
    super(errors, 'The transaction committed, but one or more post-commit observers failed')
  }
}

export class TransactionRollbackIncompleteError extends AggregateError {
  readonly name = 'TransactionRollbackIncompleteError'

  readonly rollbackComplete = false

  constructor(
    readonly cause: unknown,
    readonly rollbackErrors: readonly unknown[],
  ) {
    super([cause, ...rollbackErrors], 'The transaction failed and rollback was incomplete')
  }
}

export type TransactionPrecondition = (document: Document) => void

export type TransactionPostcondition = (document: Document, result: TransactionResult) => void

export interface BoundTransactionOptions {
  readonly precondition?: TransactionPrecondition
  readonly postcondition?: TransactionPostcondition
  /** Re-run a pure invariant after MobX reactions settle but before commit. */
  readonly settledPostcondition?: TransactionPostcondition
  readonly invokeNodeCallbacks?: boolean
  /** Agent boundaries discard executable domain-event observers. */
  readonly publishEvents?: boolean
}

interface InternalTransactionOptions extends BoundTransactionOptions {
  /** Typed commands always bind mutation authority to exactly one document. */
  readonly restrictDocumentMutations?: boolean
}

export class TransactionManager {
  #active?: ActiveTransaction

  readonly #events: EventTransactionCoordinator

  readonly #host: TransactionHost

  constructor(host: TransactionHost, events: EventTransactionCoordinator, authority: unknown) {
    if (authority !== transactionManagerConstructionAuthority) {
      throw new TypeError('TransactionManager can only be constructed by an EngineInstance')
    }
    this.#host = host
    this.#events = events
    installTransactionBoundaryOperations(this, {
      isActive: () => this.#active !== undefined,
      runValidatedOnDocument: (document, commands, options) => this.#runOnDocumentInternal(document, commands, options),
    })
    Object.freeze(this)
  }

  run(commands: readonly EditorCommand[]): TransactionResult {
    this.#assertMutable()
    this.#assertCommands(commands)
    const document = this.#requireDocument()
    return this.#executeCommands(document, commands)
  }

  runOnDocument(
    documentOrId: Document | string,
    commands: readonly EditorCommand[],
    preconditionOrOptions?: TransactionPrecondition | BoundTransactionOptions,
  ): TransactionResult {
    this.#assertMutable()
    this.#assertCommands(commands)
    if (this.#active) {
      throw new Error('runOnDocument requires an independent top-level transaction')
    }
    const document = this.#requireBoundDocument(documentOrId)
    const options = this.#normalizeBoundOptions(preconditionOrOptions)
    this.#assertExecutableBoundOptionsAllowed(options)
    return this.#executeCommands(document, commands, options)
  }

  #runOnDocumentInternal(
    document: Document,
    commands: readonly EditorCommand[],
    options: BoundTransactionOptions,
  ): TransactionResult {
    this.#assertMutable()
    this.#assertCommands(commands)
    if (this.#active) throw new Error('runOnDocument requires an independent top-level transaction')
    return this.#executeCommands(this.#requireBoundDocument(document), commands, options)
  }

  #executeCommands(
    document: Document,
    commands: readonly EditorCommand[],
    options: BoundTransactionOptions = {},
  ): TransactionResult {
    const transactionOptions: InternalTransactionOptions = {
      ...options,
      // This invariant is deliberately assigned after caller options. Typed
      // commands have no public escape hatch for cross-document mutation.
      restrictDocumentMutations: true,
    }
    this.#preflight(commands, document)
    return this.#withTransaction(
      document,
      () => {
        const results = withProjectMutationAuthority(this.#host.project, () =>
          commands.map(command =>
            applyCommand(document, command, { invokeNodeCallbacks: transactionOptions.invokeNodeCallbacks }),
          ),
        )
        const result = this.#createResult(results)
        this.#runSynchronousBoundary(transactionOptions.postcondition, [document, result], 'postcondition')
        return result
      },
      transactionOptions,
    )
  }

  runSync<T>(operation: () => T): T {
    this.#assertMutable()
    if (typeof operation !== 'function') {
      throw new Error('runSync requires a function')
    }
    if (!this.#host.trustPolicy.allowExecutableCommands) {
      throw new PolicyViolation({
        capability: 'command.executable',
        message: 'Callback transactions are disabled by the engine trust policy; use typed commands',
        origin: 'transactions.runSync',
        rule: `${this.#host.trustPolicy.name}.command.executable.deny`,
      })
    }
    if (operation.constructor.name === 'AsyncFunction') {
      throw new AsyncTransactionNotSupportedError()
    }

    const document = this.#requireDocument()
    return this.#withTransaction(
      document,
      () => {
        const result = operation()
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          throw new AsyncTransactionNotSupportedError()
        }
        return result
      },
      // A callback transaction may retain the legacy direct-model contract,
      // but it must never replace the Project or another Document while the
      // current Document's rollback substrate is active.
      { restrictDocumentMutations: true },
    )
  }

  #withTransaction<T>(document: Document, operation: () => T, options: InternalTransactionOptions = {}): T {
    if (this.#active) {
      if (!this.#active.acceptsNestedOperations) {
        throw new Error('Cannot start nested work while a transaction is settling')
      }
      if (this.#active.failure.occurred) throw this.#active.failure.error
      try {
        const result = operation()
        if (this.#active.failure.occurred) throw this.#active.failure.error
        return result
      } catch (error) {
        this.#active.failure = { error, occurred: true }
        throw error
      }
    }

    const selection = document.designer.selection.selected.slice()
    // Capture every pure preflight value before acquiring transaction-owned
    // resources. A failing export must not strand the material registry lock.
    const startSchema = JSON.stringify(document.exportRaw())
    const startMutationVersion = document.mutationVersion
    const context: ActiveTransaction = {
      acceptsNestedOperations: true,
      document,
      failure: { error: undefined, occurred: false },
    }

    let materialState!: ReturnType<typeof beginMaterialsTransaction>
    let mutationBoundary: ReturnType<typeof beginDocumentMutationBoundary> | undefined
    let eventTransaction!: ReturnType<EventTransactionCoordinator['begin']>
    try {
      materialState = beginMaterialsTransaction(this.#host.materials)
      mutationBoundary = options.restrictDocumentMutations
        ? beginDocumentMutationBoundary(this.#host.project, document)
        : undefined
      eventTransaction = this.#events.begin()
    } catch (error) {
      const acquisitionRollbackErrors: unknown[] = []
      if (eventTransaction) {
        try {
          this.#events.rollback(eventTransaction)
        } catch (rollbackError) {
          acquisitionRollbackErrors.push(rollbackError)
        }
      }
      if (mutationBoundary) {
        try {
          mutationBoundary.release()
        } catch (rollbackError) {
          acquisitionRollbackErrors.push(rollbackError)
        }
      }
      if (materialState) {
        try {
          restoreMaterialsTransaction(this.#host.materials, materialState)
        } catch (rollbackError) {
          acquisitionRollbackErrors.push(rollbackError)
        }
      }
      if (acquisitionRollbackErrors.length) {
        throw new TransactionRollbackIncompleteError(error, acquisitionRollbackErrors)
      }
      throw error
    }
    this.#active = context
    let result!: T
    let failed = false
    let failure: unknown
    let modelCommitted = false
    let mobxExitError: unknown
    const rollbackErrors: unknown[] = []
    let historyStarted = false
    let rollbackAttempted = false
    const delayCommitUntilSettled = options.settledPostcondition !== undefined

    const rollbackModel = (restoreDocument = true) => {
      if (rollbackAttempted) return
      rollbackAttempted = true
      if (historyStarted) {
        try {
          withProjectMutationAuthority(this.#host.project, () => {
            if (restoreDocument) rollbackHistoryTransaction(document.history)
            else cancelHistoryTransaction(document.history)
          })
          historyStarted = false
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      try {
        restoreMaterialsTransaction(this.#host.materials, materialState)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      try {
        document.designer.selection.clear()
        document.designer.selection.selectAll(selection)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      try {
        if (JSON.stringify(document.exportRaw()) !== startSchema) {
          rollbackErrors.push(new Error('Transaction rollback did not restore the original document schema'))
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }

    const rollbackWithinMobx = () => {
      try {
        mobxTransaction(() => {
          mutationBoundary?.allowMutations()
          try {
            rollbackModel()
          } finally {
            mutationBoundary?.seal()
          }
        })
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }

    try {
      try {
        mobxTransaction(() => {
          try {
            beginHistoryTransaction(document.history)
            historyStarted = true
            mutationBoundary?.allowMutations()
            this.#runSynchronousBoundary(options.precondition, [document], 'precondition')
            result = operation()
            if (context.failure.occurred) throw context.failure.error
            if (!delayCommitUntilSettled) {
              commitHistoryTransaction(document.history)
              historyStarted = false
              modelCommitted = true
            }
          } catch (error) {
            failed = true
            failure = error
            if (historyStarted) rollbackModel(document.mutationVersion !== startMutationVersion)
          } finally {
            mutationBoundary?.seal()
          }
        })
      } catch (error) {
        mobxExitError = error
      }

      if (modelCommitted) {
        // Legacy/general transactions preserve their established contract:
        // MobX reaction failures after the model commit are observer errors.
      } else if (!failed && mobxExitError) {
        failed = true
        failure = mobxExitError
        rollbackWithinMobx()
      } else if (!failed) {
        try {
          this.#runSynchronousBoundary(options.settledPostcondition, [document, result], 'settled postcondition')
          commitHistoryTransaction(document.history)
          historyStarted = false
          modelCommitted = true
        } catch (error) {
          failed = true
          failure = error
          rollbackWithinMobx()
        }
      } else if (mobxExitError) {
        rollbackErrors.push(mobxExitError)
      }
    } finally {
      // The transaction remains active through material commit and deferred
      // event delivery. Nested lifecycle or command work during that settling
      // phase must not observe a half-closed rollback substrate.
      context.acceptsNestedOperations = false
    }

    try {
      if (modelCommitted) {
        const postCommitErrors: unknown[] = []
        if (mobxExitError) postCommitErrors.push(mobxExitError)
        try {
          commitMaterialsTransaction(this.#host.materials, materialState)
        } catch (error) {
          postCommitErrors.push(error)
        }
        try {
          if (options.publishEvents === false) this.#events.rollback(eventTransaction)
          else this.#events.commit(eventTransaction)
        } catch (error) {
          if (error instanceof AggregateError) {
            postCommitErrors.push(...error.errors)
          } else {
            postCommitErrors.push(error)
          }
        }
        try {
          if (postCommitErrors.length) throw new TransactionCommittedError(postCommitErrors, result)
          return result
        } finally {
          mutationBoundary?.release()
        }
      }

      if (failed) {
        try {
          this.#events.rollback(eventTransaction)
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        } finally {
          mutationBoundary?.release()
        }
        if (rollbackErrors.length) {
          throw new TransactionRollbackIncompleteError(failure, rollbackErrors)
        }
        throw failure
      }

      try {
        this.#events.rollback(eventTransaction)
      } catch (rollbackError) {
        throw new AggregateError([rollbackError], 'Transaction exited without a commit and event cleanup failed')
      } finally {
        mutationBoundary?.release()
      }
      throw new Error('Transaction exited without committing or reporting a failure')
    } finally {
      this.#active = undefined
    }
  }

  #assertMutable(): void {
    this.#host.assertCompositionMutationAllowed?.('transactions.run')
    this.#host.assertTrustBoundaryIntegrity?.('transactions.run')
    if (
      this.#host.lifecycleState === 'disposing' ||
      this.#host.lifecycleState === 'disposed' ||
      this.#host.lifecycleState === 'failed'
    ) {
      throw new Error(`Cannot start a transaction while engine is ${this.#host.lifecycleState}`)
    }
  }

  #assertCommands(commands: readonly EditorCommand[]): void {
    if (!Array.isArray(commands) || commands.length < 1) {
      throw new Error('A transaction requires at least one command')
    }
  }

  #requireDocument(): Document {
    const document = this.#active?.document || this.#host.project.currentDocument
    return this.#requireUsableDocument(document)
  }

  #requireBoundDocument(documentOrId: Document | string): Document {
    const document =
      typeof documentOrId === 'string'
        ? this.#host.project.getDocument(documentOrId)
        : documentOrId && typeof documentOrId === 'object'
          ? documentOrId
          : undefined

    if (!document || this.#host.project.getDocument(document.id) !== document) {
      throw new Error('The bound document does not belong to this engine project')
    }
    return this.#requireUsableDocument(document)
  }

  #requireUsableDocument(document?: Document): Document {
    if (!document?.root) {
      throw new Error('A V1 transaction requires an active document with a root node')
    }
    return document
  }

  #normalizeBoundOptions(
    value: TransactionPrecondition | BoundTransactionOptions | undefined,
  ): BoundTransactionOptions {
    if (value === undefined) return {}
    if (typeof value === 'function') return { precondition: value }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Bound transaction options must be an object or precondition function')
    }
    return value
  }

  #assertExecutableBoundOptionsAllowed(options: BoundTransactionOptions): void {
    if (this.#host.trustPolicy.allowExecutableCommands) return
    if (!options.precondition && !options.postcondition && !options.settledPostcondition) return
    throw new PolicyViolation({
      capability: 'command.executable',
      message: 'Executable transaction validators are disabled by the engine trust policy',
      origin: 'transactions.runOnDocument',
      rule: `${this.#host.trustPolicy.name}.command.executable.deny`,
    })
  }

  #runSynchronousBoundary(
    boundary: TransactionPrecondition | TransactionPostcondition | undefined,
    args: unknown[],
    name: string,
  ): void {
    if (boundary === undefined) return
    if (typeof boundary !== 'function') {
      throw new Error(`Transaction ${name} must be a function`)
    }
    if (boundary.constructor.name === 'AsyncFunction') {
      throw new AsyncTransactionNotSupportedError()
    }
    const result = Reflect.apply(boundary, undefined, args)
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      throw new AsyncTransactionNotSupportedError()
    }
  }

  #preflight(commands: readonly EditorCommand[], document: Document) {
    for (const command of commands) {
      const executable = findExecutableValue(command)
      if (executable && !this.#host.trustPolicy.allowExecutableCommands) {
        throw new PolicyViolation({
          capability: 'command.executable',
          details: executable,
          message: `Executable command value ${executable.type} is not allowed at ${executable.path}`,
          origin: 'commands.execute',
          path: executable.path,
          rule: `${this.#host.trustPolicy.name}.command.executable.deny`,
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

  #createResult(results: CommandResult[]): TransactionResult {
    return {
      affectedNodeIds: [...new Set(results.flatMap(result => result.affectedNodeIds))],
      commandCount: results.length,
      ok: true,
    }
  }
}

Object.defineProperty(TransactionManager.prototype, 'constructor', {
  configurable: false,
  enumerable: false,
  value: undefined,
  writable: false,
})
Object.freeze(TransactionManager.prototype)
