export class RetryableDisposal {
  #completed = new Set()
  #inFlight
  #steps

  constructor(steps) {
    const names = new Set()
    for (const step of steps) {
      if (names.has(step.name)) throw new Error(`Duplicate disposal step: ${step.name}`)
      names.add(step.name)
    }
    this.#steps = [...steps]
  }

  dispose() {
    if (this.#inFlight) return this.#inFlight

    let resolveAttempt
    let rejectAttempt
    const attempt = new Promise((resolve, reject) => {
      resolveAttempt = resolve
      rejectAttempt = reject
    })
    this.#inFlight = attempt
    const clearAttempt = () => {
      if (this.#inFlight === attempt) this.#inFlight = undefined
    }
    void this.#runPendingSteps().then(
      () => {
        clearAttempt()
        resolveAttempt()
      },
      error => {
        clearAttempt()
        rejectAttempt(error)
      },
    )
    return attempt
  }

  async #runPendingSteps() {
    const failures = []
    for (const step of this.#steps) {
      if (this.#completed.has(step.name)) continue
      try {
        await step.run()
        this.#completed.add(step.name)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Retryable disposal completed with errors')
  }
}
