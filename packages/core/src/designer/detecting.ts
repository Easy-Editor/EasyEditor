import { action, observable } from 'mobx'
import type { Document, Node } from '../document'
import { assertLifecycleMutationAllowed } from '../lifecycle/mutation-barrier'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import type { EventBus } from '../utils'
import type { Designer } from './designer'

export enum DETECTING_EVENT {
  CHANGE = 'detecting:change',
}

export class Detecting {
  private emitter: EventBus

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
    assertLifecycleMutationAllowed(this.designer, 'detecting.enable')
    this._enable = flag
    if (!flag) {
      this._current = null
    }
  }

  @observable.ref private accessor _current: Node | null = null

  get current() {
    return this._current
  }

  constructor(readonly designer: Designer) {
    this.emitter = designer.createEventBus('Detecting')
    installLifecycleTeardownOperation(
      this,
      action(() => this.#disposeInternal()),
    )
    inheritEngineTeardownOwnership(this, this.emitter)
  }

  @action
  capture(node: Node | null) {
    assertLifecycleMutationAllowed(this.designer, 'detecting.capture')
    if (this._current !== node) {
      this._current = node
      this.emitter.emit(DETECTING_EVENT.CHANGE, this.current)
    }
  }

  @action
  release(node: Node | null) {
    assertLifecycleMutationAllowed(this.designer, 'detecting.release')
    if (this._current === node) {
      this._current = null
      this.emitter.emit(DETECTING_EVENT.CHANGE, this.current)
    }
  }

  @action
  leave(document: Document | undefined) {
    assertLifecycleMutationAllowed(this.designer, 'detecting.leave')
    if (this.current && this.current.document === document) {
      this._current = null
    }
  }

  onDetectingChange(fn: (node: Node) => void) {
    assertLifecycleMutationAllowed(this.designer, 'detecting.onDetectingChange')
    return this.emitter.on(DETECTING_EVENT.CHANGE, fn)
  }

  @action
  dispose(): void {
    assertPublicLifecycleTeardownAllowed(this, 'detecting.dispose')
    this.#disposeInternal()
  }

  #disposeInternal(): void {
    this._enable = true
    this._current = null
    runInternalLifecycleTeardown(this.emitter)
  }
}
