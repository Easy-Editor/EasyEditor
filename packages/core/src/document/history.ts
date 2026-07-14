import { reaction, untracked } from 'mobx'
import { createDesignerEventBus } from '../designer/event-bus'
import { inheritLifecycleMutationGuard, sealLifecycleMutations } from '../lifecycle/mutation-barrier'
import { lockReadonlyProperties } from '../lifecycle/readonly-properties'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import { ProjectMutationCommittedError, withoutProjectMutationAuthority } from '../project/mutation-authority'
import type { RootSchema } from '../types'
import { type EventBus, createEventBus } from '../utils'
import type { Document } from './document'
import { installHistoryTransactionOperations } from './history-transaction-boundary'

const appendErrors = (target: unknown[], error: unknown): void => {
  if (error instanceof AggregateError) {
    for (const nested of error.errors) appendErrors(target, nested)
    return
  }
  target.push(error)
}

export interface Serialization<K = RootSchema, T = string> {
  serialize(data: K): T
  unserialize(data: T): K
}

export enum HISTORY_EVENT {
  STATE_CHANGE = 'history:state.change',
  CURSOR_CHANGE = 'history:cursor.change',
}

export class History<T = RootSchema> {
  emitter: EventBus

  /** current record */
  #session: Session

  /** all records */
  #records: Session[]

  /** as a cursor of records to go back and forward */
  #savePointSession: Session | null = null

  #asleep = false

  #invalidError?: AggregateError

  #transactionDepth = 0

  #transactionStartData?: string

  #transactionPendingData?: string

  readonly #dataFn: () => T | null

  #redoer: (data: T) => void

  readonly #postRestore?: () => void

  /** current recorded data */
  get hotData() {
    return this.#session.data
  }

  #timeGap = 1000

  #serialization: Serialization<T, string> = {
    serialize(data: T): string {
      return JSON.stringify(data)
    },
    unserialize(data: string) {
      return JSON.parse(data)
    },
  }

  setSerialization(serialization: Serialization<T, string>) {
    this.#assertOperational('history.setSerialization')
    this.#assertNoActiveTransaction('history.setSerialization')
    this.#serialization = serialization
  }

  #disposer: () => void

  constructor(
    dataFn: () => T | null,
    redoer: (data: T) => void,
    readonly document?: Document,
    postRestore?: () => void,
  ) {
    this.#dataFn = dataFn
    this.#redoer = redoer
    this.#postRestore = postRestore
    lockReadonlyProperties(this, ['document'])
    this.emitter = document ? createDesignerEventBus(document.designer, 'History') : createEventBus('History')
    lockReadonlyProperties(this, ['emitter'])
    installLifecycleTeardownOperation(this, () => this.#destroyInternal())
    if (document) {
      inheritLifecycleMutationGuard(document, this)
      inheritEngineTeardownOwnership(document.project, this)
      inheritEngineTeardownOwnership(this, this.emitter)
    }
    this.#session = new Session(0, '', this.#timeGap)
    this.#records = [this.#session]
    this.#savePointSession = this.#session
    installHistoryTransactionOperations(this, {
      begin: () => this.#beginTransaction(),
      cancel: () => this.#cancelTransaction(),
      commit: () => this.#commitTransaction(),
      isActive: () => this.#transactionDepth > 0,
      rollback: () => this.#rollbackTransaction(),
    })

    /**
     * listen the change of schema
     */
    this.#disposer = reaction(
      (): any => {
        return this.#dataFn()
      },
      (data: T) => {
        if (this.#asleep || this.#invalidError) return

        untracked(() => {
          const log = this.#serialization.serialize(data)

          if (this.#transactionDepth > 0) {
            this.#transactionPendingData = log
            return
          }

          if (this.hotData === log) {
            return
          }

          if (this.#session.isActive()) {
            this.#session.log(log)
          } else {
            this.#session.end()
            const lastState = this.getState()
            const cursor = this.#session.cursor + 1
            const session = new Session(cursor, log, this.#timeGap)
            this.#session = session
            this.#records.splice(cursor, this.#records.length - cursor, session)

            const currentState = this.getState()
            if (currentState !== lastState) {
              this.emitter.emit(HISTORY_EVENT.STATE_CHANGE, currentState)
            }
          }
        })
      },
      { fireImmediately: true },
    )
  }

  /**
   * check if there is unsaved change for history
   */
  isSavePoint(): boolean {
    return this.#savePointSession !== this.#session
  }

  #sleep() {
    this.#asleep = true
  }

  #wakeup() {
    this.#asleep = false
  }

  go(originalCursor: number) {
    this.#assertMutationAllowed()
    this.#assertOperational('history.go')
    this.#assertNoActiveTransaction('history.go')

    let cursor = originalCursor
    cursor = +cursor
    if (cursor < 0) {
      cursor = 0
    } else if (cursor >= this.#records.length) {
      cursor = this.#records.length - 1
    }

    const currentCursor = this.#session.cursor
    if (cursor === currentCursor) {
      return
    }

    const session = this.#records[cursor]
    const hotData = session.data
    const sourceSession = this.#session
    const sourceData = sourceSession.data
    // Parsing is preflight. A bad serializer must not close the current
    // coalescing window or touch the model.
    const targetValue = this.#serialization.unserialize(hotData)
    const sourceValue = this.#serialization.unserialize(sourceData)

    this.#sleep()
    const targetErrors: unknown[] = []
    try {
      try {
        this.#redoer(targetValue)
      } catch (error) {
        appendErrors(targetErrors, error)
      }

      const targetVerification = this.#verifyCurrentData(hotData)
      if (targetVerification.error) appendErrors(targetErrors, targetVerification.error)
      if (targetVerification.matches) {
        sourceSession.end()
        this.#session = session
        const postCommitErrors = [...targetErrors]
        try {
          this.emitter.emit(HISTORY_EVENT.CURSOR_CHANGE, hotData)
        } catch (error) {
          appendErrors(postCommitErrors, error)
        }
        if (this.#postRestore) {
          try {
            if (this.document) {
              withoutProjectMutationAuthority(this.document.project, this.#postRestore)
            } else {
              this.#postRestore()
            }
          } catch (error) {
            appendErrors(postCommitErrors, error)
          }
        }
        try {
          this.emitter.emit(HISTORY_EVENT.STATE_CHANGE, this.getState())
        } catch (error) {
          appendErrors(postCommitErrors, error)
        }
        if (postCommitErrors.length) throw new ProjectMutationCommittedError(postCommitErrors, undefined)
        return
      }

      if (targetErrors.length === 0) {
        targetErrors.push(new Error('History restore completed without producing the requested snapshot'))
      }

      const rollbackErrors: unknown[] = []
      try {
        this.#redoer(sourceValue)
      } catch (error) {
        appendErrors(rollbackErrors, error)
      }
      const sourceVerification = this.#verifyCurrentData(sourceData)
      if (sourceVerification.error) appendErrors(rollbackErrors, sourceVerification.error)
      if (sourceVerification.matches) {
        const errors = [...targetErrors, ...rollbackErrors]
        if (errors.length === 1 && !(errors[0] instanceof ProjectMutationCommittedError)) throw errors[0]
        throw new AggregateError(errors, 'History restore failed; the original snapshot was restored')
      }

      const incompleteErrors = [...targetErrors, ...rollbackErrors]
      incompleteErrors.push(new Error('History restore and rollback both failed snapshot verification'))
      this.#invalidError = new AggregateError(
        incompleteErrors,
        'History is invalid because neither the target nor original snapshot could be restored',
      )
      throw new ProjectMutationCommittedError([this.#invalidError], undefined)
    } finally {
      this.#wakeup()
    }
  }

  #verifyCurrentData(expected: string): { error?: unknown; matches: boolean } {
    try {
      const current = this.#dataFn()
      return { matches: this.#serialization.serialize(current as T) === expected }
    } catch (error) {
      return { error, matches: false }
    }
  }

  back() {
    if (!this.#session) {
      return
    }
    const cursor = this.#session.cursor - 1
    this.go(cursor)
  }

  forward() {
    if (!this.#session) {
      return
    }
    const cursor = this.#session.cursor + 1
    this.go(cursor)
  }

  savePoint() {
    this.#assertOperational('history.savePoint')
    this.#assertNoActiveTransaction('history.savePoint')
    if (!this.#session) {
      return
    }
    this.#session.end()
    this.#savePointSession = this.#session
    this.emitter.emit(HISTORY_EVENT.STATE_CHANGE, this.getState())
  }

  /**
   * Start an explicit history boundary. Nested boundaries join the outer one.
   */
  #beginTransaction() {
    this.#assertOperational('history.transaction.begin')
    if (this.#transactionDepth === 0) {
      this.#transactionStartData = this.#session.data
      this.#transactionPendingData = this.#session.data
    }
    this.#transactionDepth += 1
  }

  /**
   * Commit the outer transaction as exactly one, immediately closed session.
   */
  #commitTransaction() {
    this.#assertOperational('history.transaction.commit')
    if (this.#transactionDepth < 1) {
      throw new Error('No active history transaction')
    }
    this.#transactionDepth -= 1
    if (this.#transactionDepth > 0) return

    const startData = this.#transactionStartData
    const currentData = this.#dataFn()
    const pendingData = currentData == null ? this.#transactionPendingData : this.#serialization.serialize(currentData)
    this.#clearTransactionState()
    if (pendingData === undefined || pendingData === startData) return

    // Keep the current coalescing window intact until a transaction actually
    // commits. A rejected or net-zero transaction must be history-transparent.
    this.#session.end()
    const lastState = this.getState()
    const cursor = this.#session.cursor + 1
    const session = new Session(cursor, pendingData, this.#timeGap)
    session.end()
    this.#session = session
    this.#records.splice(cursor, this.#records.length - cursor, session)

    const currentState = this.getState()
    if (currentState !== lastState) {
      this.emitter.emit(HISTORY_EVENT.STATE_CHANGE, currentState)
    }
  }

  /** Restore the exact pre-transaction snapshot without adding a history unit. */
  #rollbackTransaction() {
    this.#assertOperational('history.transaction.rollback')
    if (this.#transactionDepth < 1) return
    const startData = this.#transactionStartData
    this.#clearTransactionState()
    if (startData === undefined) return

    const startValue = this.#serialization.unserialize(startData)
    this.#sleep()
    const restoreErrors: unknown[] = []
    try {
      try {
        this.#redoer(startValue)
      } catch (error) {
        appendErrors(restoreErrors, error)
      }
      const verification = this.#verifyCurrentData(startData)
      if (verification.error) appendErrors(restoreErrors, verification.error)
      if (!verification.matches) {
        restoreErrors.push(new Error('Transaction rollback did not restore the starting history snapshot'))
        this.#invalidError = new AggregateError(restoreErrors, 'History is invalid because transaction rollback failed')
        throw this.#invalidError
      }
      if (restoreErrors.length) {
        throw new AggregateError(restoreErrors, 'Transaction rollback restored the model but cleanup reported errors')
      }
    } finally {
      this.#wakeup()
    }
  }

  /** Close an untouched transaction without rebuilding the document model. */
  #cancelTransaction() {
    this.#assertGenerationActive()
    if (this.#transactionDepth < 1) return
    this.#clearTransactionState()
  }

  #clearTransactionState() {
    this.#transactionDepth = 0
    this.#transactionStartData = undefined
    this.#transactionPendingData = undefined
  }

  #assertNoActiveTransaction(origin: string): void {
    if (this.#transactionDepth > 0) {
      throw new Error(`Cannot ${origin} while a document transaction is active`)
    }
  }

  destroy() {
    assertPublicLifecycleTeardownAllowed(this, 'history.destroy')
    this.#destroyInternal()
  }

  #destroyInternal(): void {
    const errors: unknown[] = []
    for (const record of this.#records) {
      try {
        record.end()
      } catch (error) {
        errors.push(error)
      }
    }
    this.#clearTransactionState()
    this.#records = []
    try {
      this.#disposer()
    } catch (error) {
      errors.push(error)
    }
    sealLifecycleMutations(this.emitter, 'history event bus generation is disposed')
    try {
      runInternalLifecycleTeardown(this.emitter)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw new AggregateError(errors, 'History disposal completed with errors')
  }

  /**
   *  |    1     |     1    |    1     |
   *  | -------- | -------- | -------- |
   *  | modified | redoable | undoable |
   * eg.
   *  7 means : modified && redoable && undoable
   *  5 means : modified && undoable
   *  ...
   */
  getState(): number {
    const { cursor } = this.#session
    let state = 7
    // undoable ?
    if (cursor <= 0) {
      state -= 1
    }
    // redoable ?
    if (cursor >= this.#records.length - 1) {
      state -= 2
    }
    // modified ?
    if (this.#savePointSession === this.#session) {
      state -= 4
    }
    return state
  }

  isModified() {
    return !!(this.getState() & 4)
  }

  isRedoable() {
    return !!(this.getState() & 2)
  }

  isUndoable() {
    return !!(this.getState() & 1)
  }

  onStateChange(listener: () => void) {
    this.#assertGenerationActive()
    this.emitter.on(HISTORY_EVENT.STATE_CHANGE, listener)
    return () => {
      this.emitter.off(HISTORY_EVENT.STATE_CHANGE, listener)
    }
  }

  onCursorChange(func: () => void) {
    this.#assertGenerationActive()
    this.emitter.on(HISTORY_EVENT.CURSOR_CHANGE, func)
    return () => {
      this.emitter.off(HISTORY_EVENT.CURSOR_CHANGE, func)
    }
  }

  #assertMutationAllowed(): void {
    if (this.document) this.document.project.assertDocumentMutationAllowed(this.document)
  }

  #assertGenerationActive(): void {
    if (this.document) this.document.project.assertDocumentGenerationActive(this.document)
  }

  #assertOperational(origin: string): void {
    this.#assertGenerationActive()
    if (this.#invalidError) {
      throw new AggregateError([this.#invalidError], `Cannot ${origin}; the history restore substrate is invalid`)
    }
  }
}

/**
 * Session is a record of History
 */
export class Session<T = string> {
  private _data: T

  private activeTimer: NodeJS.Timeout | null = null

  get data() {
    return this._data
  }

  constructor(
    readonly cursor: number,
    data: T,
    private timeGap = 1000,
  ) {
    lockReadonlyProperties(this, ['cursor', 'timeGap'])
    // init data
    this._data = data
    this.setTimer()
    this.log(data)
  }

  /**
   * log data
   *  log may be executed multiple times, and it has a timeGap period, during this period,
   *  the changes will only be recorded in this Session, until the timeGap period will be reset
   *  you can see it in the reaction function of History
   */
  log(data: T) {
    if (!this.isActive()) {
      return
    }
    this._data = data
    this.setTimer()
  }

  isActive() {
    return this.activeTimer != null
  }

  end() {
    if (this.isActive()) {
      this.clearTimer()
    }
  }

  private setTimer() {
    this.clearTimer()
    this.activeTimer = setTimeout(() => this.end(), this.timeGap)
  }

  private clearTimer() {
    if (this.activeTimer) {
      clearTimeout(this.activeTimer)
    }
    this.activeTimer = null
  }
}
