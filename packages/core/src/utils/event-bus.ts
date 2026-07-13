import EventEmitter from 'events'
import type { Disposable } from './hotkey'
import { createLogger } from './logger'

const logger = createLogger('event-bus')
const moduleLogger = createLogger('module-event-bus')

export type EventDeliveryScheduler = (deliver: () => void) => boolean

export class EventBus {
  private readonly eventEmitter: EventEmitter
  private readonly name?: string
  private scheduleDelivery?: EventDeliveryScheduler

  /**
   * 内核触发的事件名
   */
  readonly names = []

  constructor(emitter: EventEmitter, name?: string, scheduleDelivery?: EventDeliveryScheduler) {
    this.eventEmitter = emitter
    this.name = name
    this.scheduleDelivery = scheduleDelivery
  }

  setDeliveryScheduler(scheduleDelivery?: EventDeliveryScheduler): void {
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
  on(event: string, listener: (...args: any[]) => void): Disposable {
    this.eventEmitter.on(event, listener)
    this.getLogger().debug(`${this.getMsgPrefix('on')} ${event}`)
    return () => {
      this.off(event, listener)
    }
  }

  prependListener(event: string, listener: (...args: any[]) => void) {
    this.eventEmitter.prependListener(event, listener)
    this.getLogger().debug(`${this.getMsgPrefix('prependListener')} ${event}`)
    return () => {
      this.off(event, listener)
    }
  }

  /**
   * 取消监听事件
   * @param event 事件名称
   * @param listener 事件回调
   */
  off(event: string, listener: (...args: any[]) => void) {
    this.eventEmitter.off(event, listener)
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
    const listeners = this.eventEmitter.rawListeners(event)
    if (listeners.length === 0 && event === 'error') {
      this.eventEmitter.emit(event, ...args)
      return
    }

    const errors: unknown[] = []
    for (const listener of listeners) {
      try {
        Reflect.apply(listener, this.eventEmitter, args)
      } catch (error) {
        errors.push(error)
      }
    }
    this.getLogger().debug(`${this.getMsgPrefix('emit')} name: ${event}, args: `, ...args)
    if (errors.length) {
      throw new AggregateError(errors, `One or more listeners for "${event}" failed`)
    }
  }

  removeListener(event: string | symbol, listener: (...args: any[]) => void) {
    return this.eventEmitter.removeListener(event, listener)
  }

  addListener(event: string | symbol, listener: (...args: any[]) => void) {
    return this.eventEmitter.addListener(event, listener)
  }

  setMaxListeners(n: number) {
    return this.eventEmitter.setMaxListeners(n)
  }

  removeAllListeners(event?: string | symbol) {
    return this.eventEmitter.removeAllListeners(event)
  }

  dispose(): void {
    this.eventEmitter.removeAllListeners()
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

export const commonEvent = new EventBus(new EventEmitter())
