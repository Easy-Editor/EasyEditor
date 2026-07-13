import EventEmitter from 'events'
import { assertLifecycleMutationAllowed } from '../lifecycle/mutation-barrier'
import { assertPublicLifecycleTeardownAllowed, installLifecycleTeardownOperation } from '../lifecycle/teardown-boundary'
import type { Disposable } from './hotkey'
import { createLogger } from './logger'

const logger = createLogger('event-bus')
const moduleLogger = createLogger('module-event-bus')

export type EventDeliveryScheduler = (deliver: () => void) => boolean

type EventListener = (...args: any[]) => void

interface EventRegistration {
  event: string | symbol
  wrapped: EventListener
}

export class EventBus {
  readonly #eventEmitter: EventEmitter
  readonly #registrations = new Map<string | symbol, EventRegistration[]>()
  private readonly name?: string
  private scheduleDelivery?: EventDeliveryScheduler

  /**
   * 内核触发的事件名
   */
  readonly names = []

  constructor(emitter: EventEmitter, name?: string, scheduleDelivery?: EventDeliveryScheduler) {
    installLifecycleTeardownOperation(this, () => this.#disposeInternal())
    this.#eventEmitter = emitter
    this.name = name
    this.scheduleDelivery = scheduleDelivery
  }

  setDeliveryScheduler(scheduleDelivery?: EventDeliveryScheduler): void {
    assertLifecycleMutationAllowed(this, 'eventBus.setDeliveryScheduler')
    this.scheduleDelivery = scheduleDelivery
  }

  private getMsgPrefix(type: string): string {
    if (this.name && this.name.length > 0) {
      return `[${this.name}][event-${type}]`
    } else {
      return `[*][event-${type}]`
    }
  }

  private getLogger() {
    if (this.name && this.name.length > 0) {
      return moduleLogger
    } else {
      return logger
    }
  }
  /**
   * 监听事件
   * @param event 事件名称
   * @param listener 事件回调
   */
  on(event: string, listener: EventListener): Disposable {
    assertLifecycleMutationAllowed(this, 'eventBus.on')
    const registration = this.#register(event, listener, false)
    this.getLogger().debug(`${this.getMsgPrefix('on')} ${event}`)
    return () => {
      this.#removeRegistration(registration)
    }
  }

  prependListener(event: string, listener: EventListener): Disposable {
    assertLifecycleMutationAllowed(this, 'eventBus.prependListener')
    const registration = this.#register(event, listener, true)
    this.getLogger().debug(`${this.getMsgPrefix('prependListener')} ${event}`)
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
    this.#eventEmitter.off(event, listener)
    this.#reconcileRegistrations(event)
    this.getLogger().debug(`${this.getMsgPrefix('off')} ${event}`)
  }

  /**
   * 触发事件
   * @param event 事件名称
   * @param args 事件参数
   * @returns
   */
  emit(event: string, ...args: any[]) {
    if (this.scheduleDelivery?.(() => this.emitImmediately(event, args))) return
    this.emitImmediately(event, args)
  }

  private emitImmediately(event: string, args: any[]) {
    const listeners = this.#eventEmitter.rawListeners(event)
    if (listeners.length === 0 && event === 'error') {
      this.#eventEmitter.emit(event, ...args)
      return
    }

    const errors: unknown[] = []
    for (const listener of listeners) {
      try {
        Reflect.apply(listener, this.#eventEmitter, args)
      } catch (error) {
        errors.push(error)
      }
    }
    this.getLogger().debug(`${this.getMsgPrefix('emit')} name: ${event}, args: `, ...args)
    if (errors.length) {
      throw new AggregateError(errors, `One or more listeners for "${event}" failed`)
    }
  }

  removeListener(event: string | symbol, listener: EventListener) {
    this.#eventEmitter.removeListener(event, listener)
    this.#reconcileRegistrations(event)
    return this
  }

  addListener(event: string | symbol, listener: EventListener) {
    assertLifecycleMutationAllowed(this, 'eventBus.addListener')
    this.#register(event, listener, false)
    return this
  }

  setMaxListeners(n: number) {
    assertLifecycleMutationAllowed(this, 'eventBus.setMaxListeners')
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
    this.#removeAllListenersInternal()
  }

  #register(event: string | symbol, listener: EventListener, prepend: boolean): EventRegistration {
    this.#reconcileRegistrations(event)
    const wrapped = function (this: unknown, ...args: any[]) {
      return Reflect.apply(listener, this, args)
    }
    Object.defineProperty(wrapped, 'listener', { value: listener })
    const registration = { event, wrapped }
    if (prepend) {
      this.#eventEmitter.prependListener(event, wrapped)
    } else {
      this.#eventEmitter.on(event, wrapped)
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
    this.#eventEmitter.removeListener(registration.event, registration.wrapped)
    const index = registrations.indexOf(registration)
    if (index !== -1) registrations.splice(index, 1)
    if (registrations.length === 0) this.#registrations.delete(registration.event)
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
    if (event === undefined) {
      EventEmitter.prototype.removeAllListeners.call(this.#eventEmitter)
      this.#registrations.clear()
    } else {
      EventEmitter.prototype.removeAllListeners.call(this.#eventEmitter, event)
      this.#registrations.delete(event)
    }
  }
}

/**
 * 创建一个独立模块事件总线
 * @param name 模块名称
 */
export const createEventBus = (name: string, maxListeners?: number, scheduleDelivery?: EventDeliveryScheduler) => {
  const emitter = new EventEmitter()
  if (maxListeners) {
    emitter.setMaxListeners(maxListeners)
  }
  return new EventBus(emitter, name, scheduleDelivery)
}
