import { action, observable } from 'mobx'
import type { Designer } from '..'
import type { Document, Node } from '../document'
import { createEventBus } from '../utils'

export enum DETECTING_EVENT {
  CHANGE = 'detecting:change',
}

export class Detecting {
  private emitter = createEventBus('Detecting')

  @observable.ref private accessor _enable = true

  /**
   * control whether to show the hover effect when the outline tree is hovered
   * TODO: extract this logic from the designer
   */
  get enable() {
    return this._enable
  }

  @action
  set enable(flag: boolean) {
    this._enable = flag
    if (!flag) {
      this._current = null
    }
  }

  @observable.ref private accessor _current: Node | null = null

  get current() {
    return this._current
  }

  constructor(readonly designer: Designer) {}

  @action
  capture(node: Node | null) {
    if (this._current !== node) {
      this._current = node
      this.emitter.emit(DETECTING_EVENT.CHANGE, this.current)
    }
  }

  @action
  release(node: Node | null) {
    if (this._current === node) {
      this._current = null
      this.emitter.emit(DETECTING_EVENT.CHANGE, this.current)
    }
  }

  @action
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
