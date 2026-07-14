import { action, observable } from 'mobx'
import { type Node, isNode } from '../document'
import { assertLifecycleMutationAllowed } from '../lifecycle/mutation-barrier'
import { lockReadonlyProperties } from '../lifecycle/readonly-properties'
import {
  assertPublicLifecycleTeardownAllowed,
  inheritEngineTeardownOwnership,
  installLifecycleTeardownOperation,
  runInternalLifecycleTeardown,
} from '../lifecycle/teardown-boundary'
import type { ComponentInstance } from '../types'
import type { EventBus } from '../utils'
import type { Designer } from './designer'
import type { LocationDetail } from './location'

export interface ActiveTarget {
  node: Node
  detail?: LocationDetail
  instance?: ComponentInstance
}

export class ActiveTracker {
  @observable.ref private accessor _target: ActiveTarget | Node | undefined

  private emitter: EventBus

  constructor(private readonly designer: Designer) {
    this.emitter = designer.createEventBus('ActiveTracker')
    lockReadonlyProperties(this, ['designer', 'emitter'])
    installLifecycleTeardownOperation(
      this,
      action(() => this.#disposeInternal()),
    )
    inheritEngineTeardownOwnership(this, this.emitter)
  }

  track(originalTarget: ActiveTarget | Node) {
    assertLifecycleMutationAllowed(this.designer, 'activeTracker.track')
    let target = originalTarget
    if (isNode(originalTarget)) {
      target = { node: originalTarget as Node }
    }
    this._target = target
    this.emitter.emit('change', target)
  }

  get currentNode() {
    return (this._target as ActiveTarget)?.node
  }

  get detail() {
    return (this._target as ActiveTarget)?.detail
  }

  get instance() {
    return (this._target as ActiveTarget)?.instance
  }

  onChange(fn: (target: ActiveTarget) => void): () => void {
    assertLifecycleMutationAllowed(this.designer, 'activeTracker.onChange')
    return this.emitter.on('change', fn)
  }

  @action
  dispose(): void {
    assertPublicLifecycleTeardownAllowed(this, 'activeTracker.dispose')
    this.#disposeInternal()
  }

  #disposeInternal(): void {
    this._target = undefined
    runInternalLifecycleTeardown(this.emitter)
  }
}
