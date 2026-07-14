import { lockReadonlyProperties } from '../lifecycle/readonly-properties'

type DeferredEvent = () => void

export interface EventTransactionScope {
  readonly events: DeferredEvent[]
}

/**
 * Buffers observable domain events for one engine instance.
 *
 * V1 transactions are synchronous, so a LIFO stack is sufficient and avoids
 * leaking one engine's transaction state into another engine in the same realm.
 */
export class EventTransactionCoordinator {
  readonly #scopes: EventTransactionScope[] = []

  readonly defer = (deliver: DeferredEvent): boolean => {
    const scope = this.#scopes[this.#scopes.length - 1]
    if (!scope) return false
    scope.events.push(deliver)
    return true
  }

  constructor() {
    lockReadonlyProperties(this, ['defer'])
  }

  begin(): EventTransactionScope {
    const scope: EventTransactionScope = { events: [] }
    lockReadonlyProperties(scope, ['events'])
    this.#scopes.push(scope)
    return scope
  }

  commit(scope: EventTransactionScope): void {
    this.requireCurrentScope(scope)
    this.#scopes.pop()

    const parent = this.#scopes[this.#scopes.length - 1]
    if (parent) {
      parent.events.push(...scope.events)
      scope.events.length = 0
      return
    }

    const errors: unknown[] = []
    for (const deliver of scope.events.splice(0)) {
      try {
        deliver()
      } catch (error) {
        if (error instanceof AggregateError) {
          errors.push(...error.errors)
        } else {
          errors.push(error)
        }
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, 'One or more committed event deliveries failed')
    }
  }

  rollback(scope: EventTransactionScope): void {
    this.requireCurrentScope(scope)
    this.#scopes.pop()
    scope.events.length = 0
  }

  private requireCurrentScope(scope: EventTransactionScope): void {
    if (this.#scopes[this.#scopes.length - 1] !== scope) {
      throw new Error('Event transactions must close in last-in-first-out order')
    }
  }
}
