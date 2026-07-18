const BLOCKED_INPUT_EVENT_TYPES = Object.freeze([
  'beforeinput',
  'change',
  'click',
  'compositionend',
  'compositionstart',
  'compositionupdate',
  'contextmenu',
  'cut',
  'dblclick',
  'dragend',
  'dragenter',
  'dragleave',
  'dragover',
  'dragstart',
  'drop',
  'input',
  'keydown',
  'keypress',
  'keyup',
  'mousedown',
  'mousemove',
  'mouseup',
  'paste',
  'pointercancel',
  'pointerdown',
  'pointermove',
  'pointerup',
  'submit',
  'touchcancel',
  'touchend',
  'touchmove',
  'touchstart',
  'wheel',
])

const requireInputTarget = value => {
  if (
    value !== undefined &&
    (!value || typeof value.addEventListener !== 'function' || typeof value.removeEventListener !== 'function')
  ) {
    throw new TypeError('Mutation quiescence inputTarget must be an EventTarget')
  }
  return value
}

const freezeSnapshot = ({ disposed, exclusiveActive, sharedCount, waitingSharedCount }) =>
  Object.freeze({
    schemaVersion: 1,
    disposed,
    exclusiveActive,
    inputBlocked: exclusiveActive,
    sharedCount,
    waitingSharedCount,
  })

export class DashboardMutationQuiescenceGateDisposedError extends Error {
  constructor() {
    super('The Dashboard mutation quiescence gate is disposed')
    this.name = 'DashboardMutationQuiescenceGateDisposedError'
  }
}

export class DashboardMutationQuiescenceGate {
  #disposed = false
  #exclusiveToken = null
  #inputTarget
  #listenersInstalled = false
  #sharedTokens = new Set()
  #waitingShared = []

  constructor({ inputTarget } = {}) {
    this.#inputTarget = requireInputTarget(inputTarget)
    this.#installInputBlocker()
  }

  #installInputBlocker() {
    if (!this.#inputTarget || this.#listenersInstalled) return
    this.#listenersInstalled = true
    for (const eventType of BLOCKED_INPUT_EVENT_TYPES) {
      this.#inputTarget.addEventListener(eventType, this.#blockInput, { capture: true, passive: false })
    }
  }

  #removeInputBlocker() {
    if (!this.#inputTarget || !this.#listenersInstalled) return
    this.#listenersInstalled = false
    for (const eventType of BLOCKED_INPUT_EVENT_TYPES) {
      this.#inputTarget.removeEventListener(eventType, this.#blockInput, true)
    }
  }

  #blockInput = event => {
    if (this.#exclusiveToken === null) return
    if (event?.cancelable && typeof event.preventDefault === 'function') event.preventDefault()
    if (typeof event?.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
    else if (typeof event?.stopPropagation === 'function') event.stopPropagation()
  }

  #createSharedLease() {
    const token = { released: false }
    this.#sharedTokens.add(token)
    return Object.freeze({
      release: () => {
        if (token.released) return false
        token.released = true
        return this.#sharedTokens.delete(token)
      },
    })
  }

  #rejectWaitingShared() {
    if (this.#waitingShared.length === 0) return
    const error = new DashboardMutationQuiescenceGateDisposedError()
    const waiting = this.#waitingShared.splice(0)
    for (const waiter of waiting) waiter.reject(error)
  }

  #releaseExclusive(token) {
    if (token.released || this.#exclusiveToken !== token) return false
    token.released = true
    this.#exclusiveToken = null
    if (this.#disposed) {
      this.#rejectWaitingShared()
      this.#removeInputBlocker()
      return true
    }

    const waiting = this.#waitingShared.splice(0)
    const grants = waiting.map(waiter => Object.freeze({ waiter, lease: this.#createSharedLease() }))
    for (const { waiter, lease } of grants) waiter.resolve(lease)
    return true
  }

  acquireShared() {
    if (this.#disposed) return Promise.reject(new DashboardMutationQuiescenceGateDisposedError())
    if (this.#exclusiveToken === null) {
      const lease = this.#createSharedLease()
      return Promise.resolve(lease)
    }
    return new Promise((resolve, reject) => this.#waitingShared.push({ resolve, reject }))
  }

  tryAcquireExclusive() {
    if (this.#disposed || this.#exclusiveToken !== null || this.#sharedTokens.size > 0) return null
    const token = { released: false }
    this.#exclusiveToken = token
    return Object.freeze({ release: () => this.#releaseExclusive(token) })
  }

  isExclusive() {
    return this.#exclusiveToken !== null
  }

  getSnapshot() {
    return freezeSnapshot({
      disposed: this.#disposed,
      exclusiveActive: this.#exclusiveToken !== null,
      sharedCount: this.#sharedTokens.size,
      waitingSharedCount: this.#waitingShared.length,
    })
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    if (this.#exclusiveToken !== null) return
    this.#rejectWaitingShared()
    this.#removeInputBlocker()
  }
}

export const createDashboardMutationQuiescenceGate = options => new DashboardMutationQuiescenceGate(options)
