import { reaction, untracked } from 'mobx'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import type { RootSchema } from '../types'
import { type EventBus, createEventBus, createLogger } from '../utils'
import type { Document } from './document'

const logger = createLogger('History')

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
  private session: Session

  /** all records */
  private records: Session[]

  /** as a cursor of records to go back and forward */
  private savePointSession: Session | null = null

  private asleep = false

  private transactionDepth = 0

  private transactionStartData?: string

  private transactionPendingData?: string

  /** current recorded data */
  get hotData() {
    return this.session.data
  }

  private timeGap = 1000

  private serialization: Serialization<T, string> = {
    serialize(data: T): string {
      return JSON.stringify(data)
    },
    unserialize(data: string) {
      return JSON.parse(data)
    },
  }

  setSerialization(serialization: Serialization<T, string>) {
    this.assertGenerationActive()
    this.serialization = serialization
  }

  private disposer: () => void

  constructor(
    private readonly dataFn: () => T | null,
    private redoer: (data: T) => void,
    readonly document?: Document,
  ) {
    this.emitter = document?.designer.createEventBus('History') || createEventBus('History')
    installLifecycleTeardownOperation(this, () => this.#destroyInternal())
    if (document) {
      inheritEngineTeardownOwnership(document.project, this)
      inheritEngineTeardownOwnership(this, this.emitter)
    }
    this.session = new Session(0, '', this.timeGap)
    this.records = [this.session]
    this.savePointSession = this.session

    /**
     * listen the change of schema
     */
    this.disposer = reaction(
      (): any => {
        return this.dataFn()
      },
      (data: T) => {
        if (this.asleep) return

        untracked(() => {
          const log = this.serialization.serialize(data)

          if (this.transactionDepth > 0) {
            this.transactionPendingData = log
            return
          }

          if (this.hotData === log) {
            return
          }

          if (this.session.isActive()) {
            this.session.log(log)
          } else {
            this.session.end()
            const lastState = this.getState()
            const cursor = this.session.cursor + 1
            const session = new Session(cursor, log, this.timeGap)
            this.session = session
            this.records.splice(cursor, this.records.length - cursor, session)

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
    return this.savePointSession !== this.session
  }

  private sleep() {
    this.asleep = true
  }

  private wakeup() {
    this.asleep = false
  }

  go(originalCursor: number) {
    this.assertMutationAllowed()
    this.session.end()

    let cursor = originalCursor
    cursor = +cursor
    if (cursor < 0) {
      cursor = 0
    } else if (cursor >= this.records.length) {
      cursor = this.records.length - 1
    }

    const currentCursor = this.session.cursor
    if (cursor === currentCursor) {
      return
    }

    const session = this.records[cursor]
    const hotData = session.data

    this.sleep()
    let restored = false
    try {
      this.redoer(this.serialization.unserialize(hotData))
      this.emitter.emit(HISTORY_EVENT.CURSOR_CHANGE, hotData)
      restored = true
    } catch (e) {
      logger.error('History', e)
    } finally {
      this.wakeup()
    }

    if (!restored) return
    this.session = session
    this.emitter.emit(HISTORY_EVENT.STATE_CHANGE, this.getState())
  }

  back() {
    if (!this.session) {
      return
    }
    const cursor = this.session.cursor - 1
    this.go(cursor)
  }

  forward() {
    if (!this.session) {
      return
    }
    const cursor = this.session.cursor + 1
    this.go(cursor)
  }

  savePoint() {
    this.assertGenerationActive()
    if (!this.session) {
      return
    }
    this.session.end()
    this.savePointSession = this.session
    this.emitter.emit(HISTORY_EVENT.STATE_CHANGE, this.getState())
  }

  /**
   * Start an explicit history boundary. Nested boundaries join the outer one.
   */
  beginTransaction() {
    this.assertGenerationActive()
    if (this.transactionDepth === 0) {
      this.transactionStartData = this.session.data
      this.transactionPendingData = this.session.data
    }
    this.transactionDepth += 1
  }

  /**
   * Commit the outer transaction as exactly one, immediately closed session.
   */
  commitTransaction() {
    this.assertGenerationActive()
    if (this.transactionDepth < 1) {
      throw new Error('No active history transaction')
    }
    this.transactionDepth -= 1
    if (this.transactionDepth > 0) return

    const startData = this.transactionStartData
    const currentData = this.dataFn()
    const pendingData = currentData == null ? this.transactionPendingData : this.serialization.serialize(currentData)
    this.clearTransactionState()
    if (pendingData === undefined || pendingData === startData) return

    // Keep the current coalescing window intact until a transaction actually
    // commits. A rejected or net-zero transaction must be history-transparent.
    this.session.end()
    const lastState = this.getState()
    const cursor = this.session.cursor + 1
    const session = new Session(cursor, pendingData, this.timeGap)
    session.end()
    this.session = session
    this.records.splice(cursor, this.records.length - cursor, session)

    const currentState = this.getState()
    if (currentState !== lastState) {
      this.emitter.emit(HISTORY_EVENT.STATE_CHANGE, currentState)
    }
  }

  /** Restore the exact pre-transaction snapshot without adding a history unit. */
  rollbackTransaction() {
    this.assertGenerationActive()
    if (this.transactionDepth < 1) return
    const startData = this.transactionStartData
    this.clearTransactionState()
    if (startData === undefined) return

    this.sleep()
    try {
      this.redoer(this.serialization.unserialize(startData))
    } finally {
      this.wakeup()
    }
  }

  /** Close an untouched transaction without rebuilding the document model. */
  cancelTransaction() {
    this.assertGenerationActive()
    if (this.transactionDepth < 1) return
    this.clearTransactionState()
  }

  private clearTransactionState() {
    this.transactionDepth = 0
    this.transactionStartData = undefined
    this.transactionPendingData = undefined
  }

  destroy() {
    assertPublicLifecycleTeardownAllowed(this, 'history.destroy')
    this.#destroyInternal()
  }

  #destroyInternal(): void {
    this.records.forEach(record => record.end())
    this.clearTransactionState()
    this.records = []
    this.disposer()
    runInternalLifecycleTeardown(this.emitter)
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
    const { cursor } = this.session
    let state = 7
    // undoable ?
    if (cursor <= 0) {
      state -= 1
    }
    // redoable ?
    if (cursor >= this.records.length - 1) {
      state -= 2
    }
    // modified ?
    if (this.savePointSession === this.session) {
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
    this.assertGenerationActive()
    this.emitter.on(HISTORY_EVENT.STATE_CHANGE, listener)
    return () => {
      this.emitter.off(HISTORY_EVENT.STATE_CHANGE, listener)
    }
  }

  onCursorChange(func: () => void) {
    this.assertGenerationActive()
    this.emitter.on(HISTORY_EVENT.CURSOR_CHANGE, func)
    return () => {
      this.emitter.off(HISTORY_EVENT.CURSOR_CHANGE, func)
    }
  }

  private assertMutationAllowed(): void {
    if (this.document) this.document.project.assertDocumentMutationAllowed(this.document)
  }

  private assertGenerationActive(): void {
    if (this.document) this.document.project.assertDocumentGenerationActive(this.document)
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
