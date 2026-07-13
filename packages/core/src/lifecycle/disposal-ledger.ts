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

  private disposed = false

  get isDisposed() {
    return this.disposed
  }

  add(disposer: Disposer, label = 'anonymous'): Disposer {
    if (this.disposing || this.disposed) {
      throw new Error(`Cannot register "${label}" on a disposed lifecycle scope`)
    }

    const entry: DisposalEntry = { active: true, disposer, label }
    this.entries.push(entry)

    return async () => {
      if (!entry.active) return
      entry.active = false
      await entry.disposer()
    }
  }

  checkpoint(): number {
    return this.entries.length
  }

  async rollback(checkpoint: number): Promise<void> {
    if (this.disposing || this.disposed) return
    const failures = await this.disposeRange(Math.max(0, checkpoint))
    if (failures.length > 0) {
      throw new DisposalError(failures)
    }
  }

  child(label: string): DisposalLedger {
    const child = new DisposalLedger()
    this.add(() => child.dispose(), label)
    return child
  }

  async dispose(): Promise<void> {
    if (this.disposing || this.disposed) return
    this.disposing = true
    const failures = await this.disposeRange(0)
    this.disposing = false
    this.disposed = true
    if (failures.length > 0) {
      throw new DisposalError(failures)
    }
  }

  private async disposeRange(start: number): Promise<DisposalFailure[]> {
    const failures: DisposalFailure[] = []
    const entries = this.entries.splice(start)

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (!entry.active) continue
      entry.active = false
      try {
        await entry.disposer()
      } catch (cause) {
        failures.push({ cause, label: entry.label })
      }
    }

    return failures
  }
}
