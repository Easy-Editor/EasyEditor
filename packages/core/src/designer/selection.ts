import { action, observable } from 'mobx'
import { type Node, PositionNO, comparePosition } from '../document'
import { createEventBus } from '../utils'
import type { Designer } from './designer'

export enum SELECTION_EVENT {
  CHANGE = 'selection:change',
}

export class Selection {
  private emitter = createEventBus('Selection')

  @observable.shallow private accessor _selected: string[] = []

  get currentDocument() {
    return this.designer.project.currentDocument!
  }

  constructor(readonly designer: Designer) {}

  get selected(): string[] {
    return this._selected
  }

  @action
  select(id: string) {
    if (this._selected.length === 1 && this._selected.indexOf(id) > -1) {
      // avoid cause reaction
      return
    }

    const node = this.currentDocument.getNode(id)

    if (!node?.canSelect()) {
      return
    }

    this._selected = [id]
    this.emitter.emit(SELECTION_EVENT.CHANGE, this._selected)
  }

  @action
  selectAll(ids: string[]) {
    const selectIds: string[] = []

    for (const id of ids) {
      const node = this.currentDocument.getNode(id)

      if (node?.canSelect()) {
        selectIds.push(id)
      }
    }

    this._selected = selectIds
    this.emitter.emit(SELECTION_EVENT.CHANGE, this._selected)
  }

  @action
  clear() {
    if (this._selected.length < 1) {
      return
    }

    this._selected = []
    this.emitter.emit(SELECTION_EVENT.CHANGE, this._selected)
  }

  /**
   * tidy selected ids(remove invalid ids)
   */
  @action
  tidy() {
    const l = this._selected.length
    let i = l
    while (i-- > 0) {
      const id = this._selected[i]
      if (!this.currentDocument.hasNode(id)) {
        this._selected.splice(i, 1)
      }
    }

    if (this._selected.length !== l) {
      this.emitter.emit(SELECTION_EVENT.CHANGE, this._selected)
    }
  }

  @action
  add(id: string) {
    if (this._selected.indexOf(id) > -1) {
      return
    }

    this._selected.push(id)
    this.emitter.emit(SELECTION_EVENT.CHANGE, this._selected)
  }

  has(id: string) {
    return this._selected.indexOf(id) > -1
  }

  @action
  remove(id: string) {
    const i = this._selected.indexOf(id)
    if (i > -1) {
      this._selected.splice(i, 1)
      this.emitter.emit(SELECTION_EVENT.CHANGE, this._selected)
    }
  }

  containsNode(node: Node, excludeRoot = false) {
    for (const id of this._selected) {
      const parent = this.currentDocument.getNode(id)
      if (excludeRoot && parent?.contains(this.currentDocument.rootNode!)) {
        continue
      }
      if (parent?.contains(node)) {
        return true
      }
    }
    return false
  }

  getNodes(): Node[] {
    const nodes: Node[] = []
    for (const id of this._selected) {
      const node = this.currentDocument.getNode(id)
      if (node) {
        nodes.push(node)
      }
    }
    return nodes
  }

  getTopNodes(includeRoot = false) {
    const nodes = []
    for (const id of this._selected) {
      const node = this.currentDocument.getNode(id)
      // exclude root node
      if (!node || (!includeRoot && node.contains(this.currentDocument.rootNode!))) {
        continue
      }
      let i = nodes.length
      let isTop = true
      while (i-- > 0) {
        const n = comparePosition(nodes[i], node)
        // nodes[i] contains node
        if (n === PositionNO.Contains || n === PositionNO.TheSame) {
          isTop = false
          break
        } else if (n === PositionNO.ContainedBy) {
          // node contains nodes[i], delete nodes[i]
          nodes.splice(i, 1)
        }
      }
      // node is top item, push to nodes
      if (isTop) {
        nodes.push(node)
      }
    }
    return nodes
  }

  onSelectionChange(listener: (ids: string[]) => void): () => void {
    this.emitter.on(SELECTION_EVENT.CHANGE, listener)

    return () => {
      this.emitter.off(SELECTION_EVENT.CHANGE, listener)
    }
  }
}
