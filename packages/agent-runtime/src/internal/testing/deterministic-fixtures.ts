import type { Clock, IdFactory } from '../../contracts.js'

export class DeterministicClock implements Clock {
  #current: number
  readonly #step: number

  constructor(start = 0, step = 1) {
    this.#current = start
    this.#step = step
  }

  now(): number {
    this.#current += this.#step
    return this.#current
  }

  peek(): number {
    return this.#current
  }
}

export class DeterministicIdFactory implements IdFactory {
  readonly #counts = new Map<string, number>()
  readonly #prefix: string

  constructor(prefix = '') {
    this.#prefix = prefix
  }

  next(kind: Parameters<IdFactory['next']>[0]): string {
    const sequence = (this.#counts.get(kind) ?? 0) + 1
    this.#counts.set(kind, sequence)
    return `${this.#prefix}${kind}-${sequence}`
  }
}

export const createDeterministicClock = (start = 0, step = 1): DeterministicClock => new DeterministicClock(start, step)

export const createDeterministicIdFactory = (prefix = ''): DeterministicIdFactory => new DeterministicIdFactory(prefix)
