import { observable } from 'mobx'
import { type Node, isNode } from '../document'
import type { ComponentInstance } from '../types'
import { createEventBus } from '../utils'
import type { LocationDetail } from './location'

export interface ActiveTarget {
  node: Node
  detail?: LocationDetail
  instance?: ComponentInstance
}

export class ActiveTracker {
  @observable.ref private accessor _target: ActiveTarget | Node

  private emitter = createEventBus('ActiveTracker')

  track(originalTarget: ActiveTarget | Node) {
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
    this.emitter.on('change', fn)
    return () => {
      this.emitter.off('change', fn)
    }
  }
}
