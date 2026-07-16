const ACTIVITY_KINDS = new Set(['keyboard', 'pointer'])

const requireActivityKind = value => {
  if (!ACTIVITY_KINDS.has(value)) throw new TypeError('activity kind must be pointer or keyboard')
  return value
}

const requirePositiveInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer`)
  return value
}

const requireFunction = (value, label) => {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`)
  return value
}

export class HumanActivityLeaseDisposedError extends Error {
  constructor() {
    super('The human activity lease is disposed')
    this.name = 'HumanActivityLeaseDisposedError'
  }
}

export class HumanActivityLease {
  #activeUntil = 0
  #clearTimer
  #disposed = false
  #generation = 0
  #holds = new Set()
  #idleMs
  #now
  #setTimer
  #timer = null
  #waiters = new Set()

  constructor({
    idleMs = 250,
    now = Date.now,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer),
  } = {}) {
    this.#idleMs = requirePositiveInteger(idleMs, 'idleMs')
    this.#now = requireFunction(now, 'now')
    this.#setTimer = requireFunction(setTimer, 'setTimer')
    this.#clearTimer = requireFunction(clearTimer, 'clearTimer')
  }

  #assertActive() {
    if (this.#disposed) throw new HumanActivityLeaseDisposedError()
  }

  #isWithinIdleWindow() {
    return this.#now() < this.#activeUntil
  }

  #clearScheduledTimer() {
    if (this.#timer === null) return
    this.#clearTimer(this.#timer)
    this.#timer = null
  }

  #flushIdleWaiters() {
    if (this.#holds.size || this.#isWithinIdleWindow()) return
    this.#clearScheduledTimer()
    const result = Object.freeze({ generation: this.#generation })
    for (const waiter of this.#waiters) waiter.resolve(result)
    this.#waiters.clear()
  }

  #scheduleIdleCheck() {
    this.#clearScheduledTimer()
    if (this.#holds.size) return
    const delay = Math.max(0, this.#activeUntil - this.#now())
    if (delay === 0) {
      this.#flushIdleWaiters()
      return
    }
    this.#timer = this.#setTimer(() => {
      this.#timer = null
      this.#flushIdleWaiters()
      if (this.#waiters.size && !this.#holds.size) this.#scheduleIdleCheck()
    }, delay)
  }

  #markActivity() {
    this.#generation += 1
    this.#activeUntil = Math.max(this.#activeUntil, this.#now() + this.#idleMs)
    this.#scheduleIdleCheck()
    return this.#generation
  }

  recordActivity(kind) {
    this.#assertActive()
    requireActivityKind(kind)
    return this.#markActivity()
  }

  acquire(kind) {
    this.#assertActive()
    const normalizedKind = requireActivityKind(kind)
    const hold = { kind: normalizedKind, released: false }
    this.#holds.add(hold)
    this.#markActivity()
    return Object.freeze({
      renew: () => {
        this.#assertActive()
        if (hold.released) throw new Error('Cannot renew a released human activity lease')
        return this.#markActivity()
      },
      release: () => {
        if (hold.released) return false
        hold.released = true
        if (this.#disposed) return false
        this.#holds.delete(hold)
        this.#markActivity()
        return true
      },
    })
  }

  isActive() {
    if (this.#disposed) return false
    return this.#holds.size > 0 || this.#isWithinIdleWindow()
  }

  waitUntilIdle() {
    try {
      this.#assertActive()
    } catch (error) {
      return Promise.reject(error)
    }
    if (!this.isActive()) return Promise.resolve(Object.freeze({ generation: this.#generation }))
    return new Promise((resolve, reject) => {
      this.#waiters.add({ resolve, reject })
      this.#scheduleIdleCheck()
    })
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#clearScheduledTimer()
    this.#holds.clear()
    const error = new HumanActivityLeaseDisposedError()
    for (const waiter of this.#waiters) waiter.reject(error)
    this.#waiters.clear()
  }

  get generation() {
    return this.#generation
  }

  get disposed() {
    return this.#disposed
  }
}

export const createHumanActivityLease = options => new HumanActivityLease(options)
