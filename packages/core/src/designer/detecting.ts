import type { Designer } from '..'
import type { Document, Node } from '../document'

import { observable } from 'mobx'
import { createEventBus } from '../utils'

export enum DETECTING_EVENT {
  CHANGE = 'detecting:change',
}

export class Detecting {
  @observable.ref private accessor _enable = true

  /**
   * control whether to show the hover effect when the outline tree is hovered
   * TODO: extract this logic from the designer
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

  @observable.ref accessor xRayMode = false

  @observable.ref private accessor _current: Node | null = null

  private emitter = createEventBus('Detecting')

  get current() {
    return this._current
  }

  constructor(readonly designer: Designer) {}

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
