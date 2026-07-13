export class RemoteResourceScope {
  #abortControllers = new Set()
  #authorize
  #disposePromise
  #generation = 0
  #nodes = new Set()
  #sockets = new Set()
  #state = 'created'
  #timers = new Set()

  constructor(authorize) {
    this.#authorize = authorize
  }

  get isActive() {
    return this.#state === 'active'
  }

  assertActive() {
    this.#assertActive()
  }

  activate() {
    if (this.#state === 'active') return
    if (this.#state === 'disposed') {
      throw new Error('Remote resource scope is disposed')
    }
    this.#generation += 1
    this.#state = 'active'
  }

  beginOperation(label = 'remote operation') {
    this.#assertActive()
    const abortController = new AbortController()
    const operation = {
      abortController,
      generation: this.#generation,
      label,
    }
    this.#abortControllers.add(abortController)
    return operation
  }

  finishOperation(operation) {
    this.#abortControllers.delete(operation.abortController)
  }

  assertCurrent(operation) {
    if (
      this.#state !== 'active' ||
      operation.generation !== this.#generation ||
      operation.abortController.signal.aborted
    ) {
      throw new Error(`${operation.label} completed after its remote resource scope was disposed`)
    }
  }

  perform(request, effect) {
    this.#assertActive()
    this.#authorize(request)
    return effect()
  }

  ownNode(node) {
    this.#assertActive()
    this.#nodes.add(node)
  }

  removeOwnedNode(node) {
    node.remove()
    this.#nodes.delete(node)
  }

  ownSocket(socket) {
    this.#assertActive()
    this.#sockets.add(socket)
  }

  releaseSocket(socket) {
    this.#sockets.delete(socket)
  }

  setTimer(callback, delay) {
    this.#assertActive()
    const timer = setTimeout(() => {
      this.#timers.delete(timer)
      if (this.#state === 'active') callback()
    }, delay)
    this.#timers.add(timer)
    return timer
  }

  clearTimer(timer) {
    clearTimeout(timer)
    this.#timers.delete(timer)
  }

  dispose() {
    if (this.#disposePromise) return this.#disposePromise

    this.#state = 'disposed'
    this.#generation += 1

    for (const controller of this.#abortControllers) controller.abort()
    this.#abortControllers.clear()

    for (const timer of this.#timers) clearTimeout(timer)
    this.#timers.clear()

    const failures = []
    for (const socket of this.#sockets) {
      try {
        socket.close()
        this.#sockets.delete(socket)
      } catch (error) {
        failures.push(error)
      }
    }

    for (const node of this.#nodes) {
      try {
        node.remove()
        this.#nodes.delete(node)
      } catch (error) {
        failures.push(error)
      }
    }

    const attempt = failures.length
      ? Promise.reject(new AggregateError(failures, 'Remote resource scope disposal failed'))
      : Promise.resolve()
    this.#disposePromise = attempt
    void attempt.catch(() => {
      if (this.#disposePromise === attempt) this.#disposePromise = undefined
    })
    return attempt
  }

  #assertActive() {
    if (this.#state !== 'active') {
      throw new Error(`Remote resource scope is ${this.#state}`)
    }
  }
}
