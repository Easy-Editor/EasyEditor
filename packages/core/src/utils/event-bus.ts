import EventEmitter from 'events'
import {
  assertLifecycleMutationAllowed,
  assertLifecycleMutationUnsealed,
  captureLifecycleMutationGeneration,
  isLifecycleMutationSealed,
  isLifecycleMutationTicketCurrent,
} from '../lifecycle/mutation-barrier'
import { assertPublicLifecycleTeardownAllowed, installLifecycleTeardownOperation } from '../lifecycle/teardown-boundary'
import { installEventBusDeliveryOperations } from './event-bus-boundary'
import type { Disposable } from './hotkey'
import { createLogger } from './logger'

const logger = createLogger('event-bus')
const moduleLogger = createLogger('module-event-bus')

export type EventDeliveryScheduler = (deliver: () => void) => boolean

export type EventCallbackBoundary = <T>(callback: () => T) => T

type EventListener = (...args: any[]) => void

interface EventRegistration {
  event: string | symbol
  wrapped: EventListener
}

export class EventBus {
  readonly #eventEmitter: EventEmitter
  readonly #registrations = new Map<string | symbol, EventRegistration[]>()
  #deliveryGeneration = 0
  #engineSchedulerClaimed = false
  readonly #name?: string
  #scheduleDelivery?: EventDeliveryScheduler
  readonly #runCallbackBoundary?: EventCallbackBoundary
  #tearingDown = false

  /**
   * 内核触发的事件名
   */
  readonly names = []

  constructor(
    emitter: EventEmitter,
    name?: string,
    scheduleDelivery?: EventDeliveryScheduler,
    runCallbackBoundary?: EventCallbackBoundary,
  ) {
    installLifecycleTeardownOperation(this, () => this.#disposeInternal())
    this.#eventEmitter = emitter
    this.#name = name
    this.#scheduleDelivery = scheduleDelivery
    this.#runCallbackBoundary = runCallbackBoundary
    installEventBusDeliveryOperations(this, {
      claimEngineScheduler: engineScheduler => {
        if (this.#engineSchedulerClaimed) {
          throw new Error('The EventBus delivery scheduler is already owned by an EngineInstance')
        }
        this.#assertNotTearingDown('eventBus.claimEngineScheduler')
        this.#engineSchedulerClaimed = true
        this.#scheduleDelivery = engineScheduler
      },
    })
  }

  #assertNotTearingDown(origin: string): void {
    if (this.#tearingDown) throw new Error(`Cannot ${origin}; event bus teardown is in progress`)
  }

  #getMsgPrefix(type: string): string {
    if (this.#name && this.#name.length > 0) {
      return `[${this.#name}][event-${type}]`
    } else {
      return `[*][event-${type}]`
    }
  }

  #getLogger() {
    if (this.#name && this.#name.length > 0) {
      return moduleLogger
    } else {
      return logger
    }
  }

  #runCallback<T>(callback: () => T): T {
    return this.#runCallbackBoundary ? this.#runCallbackBoundary(callback) : callback()
  }
  /**
   * 监听事件
   * @param event 事件名称
   * @param listener 事件回调
   */
  on(event: string, listener: EventListener): Disposable {
    assertLifecycleMutationAllowed(this, 'eventBus.on')
    this.#assertNotTearingDown('eventBus.on')
    const registration = this.#register(event, listener, false)
    this.#getLogger().debug(`${this.#getMsgPrefix('on')} ${event}`)
    return () => {
      this.#removeRegistration(registration)
    }
  }

  prependListener(event: string, listener: EventListener): Disposable {
    assertLifecycleMutationAllowed(this, 'eventBus.prependListener')
    this.#assertNotTearingDown('eventBus.prependListener')
    const registration = this.#register(event, listener, true)
    this.#getLogger().debug(`${this.#getMsgPrefix('prependListener')} ${event}`)
    return () => {
      this.#removeRegistration(registration)
    }
  }

  /**
   * 取消监听事件
   * @param event 事件名称
   * @param listener 事件回调
   */
  off(event: string, listener: EventListener) {
    try {
      this.#runCallback(() => this.#eventEmitter.off(event, listener))
    } finally {
      this.#reconcileRegistrations(event)
    }
    this.#getLogger().debug(`${this.#getMsgPrefix('off')} ${event}`)
  }

  /**
   * 触发事件
   * @param event 事件名称
   * @param args 事件参数
   * @returns
   */
  emit(event: string, ...args: any[]) {
    assertLifecycleMutationUnsealed(this, 'eventBus.emit')
    this.#assertNotTearingDown('eventBus.emit')
    const lifecycleTicket = captureLifecycleMutationGeneration(this)
    const deliveryGeneration = this.#deliveryGeneration
    if (
      this.#scheduleDelivery?.(() => {
        // The event was valid when queued, but its generation may have been
        // retired by a later command or Engine restart. Drop that stale
        // delivery instead of reviving the resource or turning a committed
        // transaction into a post-commit observer failure.
        if (deliveryGeneration !== this.#deliveryGeneration) return
        if (!isLifecycleMutationTicketCurrent(this, lifecycleTicket) || isLifecycleMutationSealed(this)) return
        this.#emitImmediately(event, args)
      })
    ) {
      return
    }
    this.#emitImmediately(event, args)
  }

  #emitImmediately(event: string, args: any[]) {
    assertLifecycleMutationUnsealed(this, 'eventBus.emit')
    this.#assertNotTearingDown('eventBus.emit')
    const listeners = this.#eventEmitter.rawListeners(event)
    if (listeners.length === 0 && event === 'error') {
      this.#eventEmitter.emit(event, ...args)
      return
    }

    const errors: unknown[] = []
    for (const listener of listeners) {
      try {
        this.#runCallback(() => Reflect.apply(listener, this.#eventEmitter, args))
      } catch (error) {
        errors.push(error)
      }
    }
    this.#getLogger().debug(`${this.#getMsgPrefix('emit')} name: ${event}, args: `, ...args)
    if (errors.length) {
      throw new AggregateError(errors, `One or more listeners for "${event}" failed`)
    }
  }

  removeListener(event: string | symbol, listener: EventListener) {
    try {
      this.#runCallback(() => this.#eventEmitter.removeListener(event, listener))
    } finally {
      this.#reconcileRegistrations(event)
    }
    return this
  }

  addListener(event: string | symbol, listener: EventListener) {
    assertLifecycleMutationAllowed(this, 'eventBus.addListener')
    this.#assertNotTearingDown('eventBus.addListener')
    this.#register(event, listener, false)
    return this
  }

  setMaxListeners(n: number) {
    assertLifecycleMutationAllowed(this, 'eventBus.setMaxListeners')
    this.#assertNotTearingDown('eventBus.setMaxListeners')
    this.#eventEmitter.setMaxListeners(n)
    return this
  }

  removeAllListeners(event?: string | symbol) {
    assertPublicLifecycleTeardownAllowed(this, 'eventBus.removeAllListeners')
    this.#removeAllListenersInternal(event)
    return this
  }

  /** Read-only diagnostics without exposing the mutable EventEmitter handle. */
  listenerCount(event?: string | symbol): number {
    if (event !== undefined) return this.#eventEmitter.listenerCount(event)
    return this.#eventEmitter
      .eventNames()
      .reduce((count, eventName) => count + this.#eventEmitter.listenerCount(eventName), 0)
  }

  dispose(): void {
    assertPublicLifecycleTeardownAllowed(this, 'eventBus.dispose')
    this.#disposeInternal()
  }

  #disposeInternal(): void {
    this.#deliveryGeneration += 1
    this.#removeAllListenersInternal()
  }

  #register(event: string | symbol, listener: EventListener, prepend: boolean): EventRegistration {
    this.#reconcileRegistrations(event)
    const wrapped = (...args: any[]) => Reflect.apply(listener, undefined, args)
    Object.defineProperty(wrapped, 'listener', { value: listener })
    const registration = { event, wrapped }
    if (prepend) {
      this.#runCallback(() => this.#eventEmitter.prependListener(event, wrapped))
    } else {
      this.#runCallback(() => this.#eventEmitter.on(event, wrapped))
    }
    const registrations = this.#registrations.get(event)
    if (registrations) {
      registrations.push(registration)
    } else {
      this.#registrations.set(event, [registration])
    }
    return registration
  }

  #removeRegistration(registration: EventRegistration): void {
    const registrations = this.#registrations.get(registration.event)
    if (!registrations?.includes(registration)) return
    try {
      this.#runCallback(() => this.#eventEmitter.removeListener(registration.event, registration.wrapped))
    } finally {
      const index = registrations.indexOf(registration)
      if (index !== -1) registrations.splice(index, 1)
      if (registrations.length === 0) this.#registrations.delete(registration.event)
    }
  }

  #reconcileRegistrations(event: string | symbol): void {
    const registrations = this.#registrations.get(event)
    if (!registrations) return
    const activeListeners = new Set(this.#eventEmitter.rawListeners(event))
    const activeRegistrations = registrations.filter(registration => activeListeners.has(registration.wrapped))
    if (activeRegistrations.length > 0) {
      this.#registrations.set(event, activeRegistrations)
    } else {
      this.#registrations.delete(event)
    }
  }

  #removeAllListenersInternal(event?: string | symbol): void {
    this.#assertNotTearingDown('eventBus.removeAllListeners')
    this.#tearingDown = true
    const errors: unknown[] = []
    const eventNames =
      event === undefined
        ? this.#eventEmitter
            .eventNames()
            .sort((left, right) => Number(left === 'removeListener') - Number(right === 'removeListener'))
        : [event]
    try {
      for (const eventName of eventNames) {
        const listeners = this.#eventEmitter.rawListeners(eventName) as EventListener[]
        for (const listener of listeners.reverse()) {
          try {
            this.#runCallback(() => EventEmitter.prototype.removeListener.call(this.#eventEmitter, eventName, listener))
          } catch (error) {
            errors.push(error)
          }
        }
      }
    } finally {
      if (event === undefined) this.#registrations.clear()
      else this.#registrations.delete(event)
      this.#tearingDown = false
    }
    if (errors.length) throw new AggregateError(errors, 'One or more EventBus listeners failed during removal')
  }
}

/**
 * 创建一个独立模块事件总线
 * @param name 模块名称
 */
export const createEventBus = (
  name: string,
  maxListeners?: number,
  scheduleDelivery?: EventDeliveryScheduler,
  runCallbackBoundary?: EventCallbackBoundary,
) => {
  const emitter = new EventEmitter()
  if (maxListeners) {
    emitter.setMaxListeners(maxListeners)
  }
  return new EventBus(emitter, name, scheduleDelivery, runCallbackBoundary)
}
