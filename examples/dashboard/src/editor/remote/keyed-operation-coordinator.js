export class OperationInvalidatedError extends Error {
  constructor(key) {
    super(`Operation for ${key} was invalidated`)
    this.name = 'OperationInvalidatedError'
  }
}

/**
 * Tracks the single latest operation for each key. Beginning or invalidating
 * work aborts the previous token synchronously, while late completions can be
 * rejected with an identity check before they mutate shared state.
 */
export class LatestOperationRegistry {
  #current = new Map()

  begin(key) {
    this.invalidate(key)
    const abortController = new AbortController()
    const operation = Object.freeze({
      abortController,
      key,
      signal: abortController.signal,
    })
    this.#current.set(key, operation)
    return operation
  }

  isCurrent(operation) {
    return this.#current.get(operation.key) === operation && !operation.signal.aborted
  }

  assertCurrent(operation) {
    if (!this.isCurrent(operation)) throw new OperationInvalidatedError(operation.key)
  }

  finish(operation) {
    if (this.#current.get(operation.key) === operation) this.#current.delete(operation.key)
  }

  invalidate(key) {
    const operation = this.#current.get(key)
    if (!operation) return
    this.#current.delete(key)
    operation.abortController.abort()
  }

  invalidateAll() {
    for (const key of [...this.#current.keys()]) this.invalidate(key)
  }
}

/**
 * Coalesces concurrent work by key. The task starts in a microtask so the
 * shared promise is published before user code can re-enter `run`.
 */
export class SingleFlight {
  #flights = new Map()

  run(key, task) {
    const current = this.#flights.get(key)
    if (current) return current.promise

    const entry = {}
    const promise = Promise.resolve().then(() => {
      if (this.#flights.get(key) !== entry) throw new OperationInvalidatedError(key)
      return task()
    })
    entry.promise = promise
    this.#flights.set(key, entry)

    const clear = () => {
      if (this.#flights.get(key) === entry) this.#flights.delete(key)
    }
    void promise.then(clear, clear)
    return promise
  }

  forget(key) {
    this.#flights.delete(key)
  }

  clear() {
    this.#flights.clear()
  }
}
