import type { Editor } from '../types'
import type { EventBus } from './event-bus'
import type { Disposable } from './hotkey'
import { isPluginEventName } from './is'
import { createLogger } from './logger'

const logger = createLogger('Event')

interface EventOptions {
  prefix: string
}

export class Event {
  private readonly options: EventOptions

  constructor(
    readonly eventBus: EventBus,
    options: EventOptions,
    public workspaceMode = false,
  ) {
    this.options = options
    if (!this.options.prefix) {
      logger.warn('prefix is required while initializing Event')
    }
  }

  /**
   * 监听事件
   * @param event 事件名称
   * @param listener 事件回调
   */
  on(event: string, listener: (...args: any[]) => void): Disposable {
    if (isPluginEventName(event)) {
      return this.eventBus.on(event, listener)
    } else {
      logger.warn(`fail to monitor on event ${event}, event should have a prefix like 'somePrefix:eventName'`)
      return () => {}
    }
  }

  /**
   * 监听事件，会在其他回调函数之前执行
   * @param event 事件名称
   * @param listener 事件回调
   */
  prependListener(event: string, listener: (...args: any[]) => void): Disposable {
    if (isPluginEventName(event)) {
      return this.eventBus.prependListener(event, listener)
    } else {
      logger.warn(`fail to prependListener event ${event}, event should have a prefix like 'somePrefix:eventName'`)
      return () => {}
    }
  }

  /**
   * 取消监听事件
   * @param event 事件名称
   * @param listener 事件回调
   */
  off(event: string, listener: (...args: any[]) => void) {
    this.eventBus.off(event, listener)
  }

  /**
   * 触发事件
   * @param event 事件名称
   * @param args 事件参数
   * @returns
   */
  emit(event: string, ...args: any[]) {
    if (!this.options.prefix) {
      logger.warn('Event#emit has been forbidden while prefix is not specified')
      return
    }
    this.eventBus.emit(`${this.options.prefix}:${event}`, ...args)
  }
}

export const getEvent = (editor: Editor, options: any = { prefix: 'common' }) => {
  return new Event(editor.eventBus, options)
}
