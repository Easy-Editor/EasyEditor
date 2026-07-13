export type Disposer = () => void | Promise<void>

export interface DisposalFailure {
  label: string
  cause: unknown
}

export class DisposalError extends Error {
  readonly name = 'DisposalError'

  constructor(readonly failures: DisposalFailure[]) {
    super(`Failed to dispose ${failures.length} resource${failures.length === 1 ? '' : 's'}`)
  }
}

interface DisposalEntry {
  active: boolean
  disposer: Disposer
  label: string
  promise?: Promise<void>
}

/**
 * Owns cleanup callbacks for one lifecycle scope.
 *
 * Entries are released in reverse acquisition order. Both individual removal
 * handles and the ledger itself are idempotent.
 */
export class DisposalLedger {
  private entries: DisposalEntry[] = []

  private disposing = false

  private rollingBack = false

  private sealed = false

  private disposed = false

  private disposePromise?: Promise<void>

  private rollbackPromise?: Promise<void>

  private rollbackCheckpoint?: number

  get isDisposed() {
    return this.disposed
  }

  add(disposer: Disposer, label = 'anonymous'): Disposer {
    if (this.disposing || this.rollingBack || this.sealed || this.disposed) {
      throw new Error(`Cannot register "${label}" on a disposed lifecycle scope`)
    }

    const entry: DisposalEntry = { active: true, disposer, label }
    this.entries.push(entry)

    return () => this.disposeEntry(entry)
  }

  checkpoint(): number {
    return this.entries.length
  }

  rollback(checkpoint: number): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.disposePromise) return this.disposePromise
    if (this.sealed) return Promise.reject(new Error('Cannot roll back a lifecycle scope after disposal has started'))
    const normalizedCheckpoint = Math.max(0, checkpoint)
    if (this.rollbackPromise) {
      if (this.rollbackCheckpoint === normalizedCheckpoint) return this.rollbackPromise
      return Promise.reject(
        new Error(
          `A rollback is already in progress at checkpoint ${this.rollbackCheckpoint}; checkpoint ${normalizedCheckpoint} was not applied`,
        ),
      )
    }

    this.rollingBack = true
    this.rollbackCheckpoint = normalizedCheckpoint
    const rollbackPromise = Promise.resolve()
      .then(async () => {
        const failures = await this.disposeRange(normalizedCheckpoint)
        if (failures.length > 0) throw new DisposalError(failures)
      })
      .finally(() => {
        this.rollingBack = false
        this.rollbackCheckpoint = undefined
        this.rollbackPromise = undefined
      })
    this.rollbackPromise = rollbackPromise
    return rollbackPromise
  }

  child(label: string): DisposalLedger {
    const child = new DisposalLedger()
    this.add(() => child.dispose(), label)
    return child
  }

  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.disposePromise) return this.disposePromise

    this.sealed = true
    this.disposing = true
    const disposePromise = Promise.resolve()
      .then(async () => {
        if (this.rollbackPromise) {
          try {
            await this.rollbackPromise
          } catch {
            // Failed rollback entries remain active in the ledger. Full
            // disposal retries them while still attempting every unrelated
            // cleanup entry, preserving best-effort teardown semantics.
          }
        }
        const failures = await this.disposeRange(0)
        if (failures.length > 0) throw new DisposalError(failures)
        this.disposed = true
      })
      .finally(() => {
        this.disposing = false
        this.disposePromise = undefined
      })
    this.disposePromise = disposePromise
    return disposePromise
  }

  private async disposeRange(start: number): Promise<DisposalFailure[]> {
    const failures: DisposalFailure[] = []
    const entries = this.entries.splice(start)

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (!entry.active) continue
      try {
        await this.disposeEntry(entry)
      } catch (cause) {
        failures.push({ cause, label: entry.label })
      }
    }

    this.entries.push(...entries.filter(entry => entry.active))

    return failures
  }

  private disposeEntry(entry: DisposalEntry): Promise<void> {
    if (!entry.active) return Promise.resolve()
    if (entry.promise) return entry.promise

    let resolveAttempt!: () => void
    let rejectAttempt!: (cause: unknown) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolveAttempt = resolve
      rejectAttempt = reject
    })
    entry.promise = promise

    const clearAttempt = () => {
      if (entry.promise === promise) entry.promise = undefined
    }
    void promise.then(clearAttempt, clearAttempt)

    try {
      Promise.resolve(entry.disposer()).then(() => {
        entry.active = false
        resolveAttempt()
      }, rejectAttempt)
    } catch (cause) {
      rejectAttempt(cause)
    }

    return promise
  }
}
