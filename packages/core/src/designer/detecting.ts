import type { Document, Node } from '@/document'
import { createEventBus } from '@/utils'
import { observable } from 'mobx'

export enum DETECTING_EVENT {
  CHANGE = 'detecting:change',
}

export class Detecting {
  @observable.ref private _enable = true

  /**
   * 控制大纲树 hover 时是否出现悬停效果
   * TODO: 将该逻辑从设计器中抽离出来
   */
  get enable() {
    return this._enable
  }

  set enable(flag: boolean) {
    this._enable = flag
    if (!flag) {
      this._current = null
    }
  }

  @observable.ref xRayMode = false

  @observable.ref private _current: Node | null = null

  private emitter = createEventBus('Detecting')

  get current() {
    return this._current
  }

  capture(node: Node | null) {
    if (this._current !== node) {
      this._current = node
      this.emitter.emit(DETECTING_EVENT.CHANGE, this.current)
    }
  }

  release(node: Node | null) {
    if (this._current === node) {
      this._current = null
      this.emitter.emit(DETECTING_EVENT.CHANGE, this.current)
    }
  }

  leave(document: Document | undefined) {
    if (this.current && this.current.document === document) {
      this._current = null
    }
  }

  onDetectingChange(fn: (node: Node) => void) {
    this.emitter.on(DETECTING_EVENT.CHANGE, fn)

    return () => {
      this.emitter.off(DETECTING_EVENT.CHANGE, fn)
    }
  }
}
