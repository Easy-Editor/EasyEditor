import { action, computed, observable } from 'mobx'
import { DESIGNER_EVENT, type Designer, type Point } from '../designer'
import { ScrollTarget } from '../designer/scroller'
import { assertLifecycleMutationAllowed, sealLifecycleMutations } from '../lifecycle/mutation-barrier'
import { lockReadonlyProperties } from '../lifecycle/readonly-properties'
import { assertPublicLifecycleTeardownAllowed, installLifecycleTeardownOperation } from '../lifecycle/teardown-boundary'
import type { Disposable } from '../utils'

export type AutoFit = '100%'
export const AutoFit: AutoFit = '100%'

export class Viewport {
  @observable.ref private accessor rect: DOMRect

  private _bounds?: DOMRect

  private boundsFrame?: number

  get bounds(): DOMRect {
    assertLifecycleMutationAllowed(this, 'viewport.bounds')
    if (this._bounds) {
      return this._bounds
    }
    this._bounds = this.viewportElement!.getBoundingClientRect()
    const view = this.viewportElement?.ownerDocument.defaultView
    const requestFrame = view?.requestAnimationFrame?.bind(view) || globalThis.requestAnimationFrame
    this.boundsFrame = requestFrame(() => {
      this._bounds = undefined
      this.boundsFrame = undefined
    })
    return this._bounds
  }

  get contentBounds(): DOMRect {
    const { bounds, scale } = this
    return new DOMRect(0, 0, bounds.width / scale, bounds.height / scale)
  }

  private viewportElement?: HTMLElement

  constructor(readonly designer: Designer) {
    installLifecycleTeardownOperation(this, () => this.#disposeInternal())
    lockReadonlyProperties(this, ['designer'])
  }

  mount(viewportElement: HTMLElement | null) {
    assertLifecycleMutationAllowed(this, 'viewport.mount')
    if (!viewportElement || this.viewportElement === viewportElement) {
      return
    }
    this.viewportElement = viewportElement
    this.touch()

    this.designer.postEvent(DESIGNER_EVENT.VIEWPORT_MOUNT, {
      viewport: this,
      viewportElement,
    })
  }

  @action
  touch() {
    assertLifecycleMutationAllowed(this, 'viewport.touch')
    if (this.viewportElement) {
      this.rect = this.bounds
    }
  }

  @computed
  get height() {
    if (!this.rect) {
      return 600
    }
    return this.rect.height
  }

  set height(newHeight: number) {
    assertLifecycleMutationAllowed(this, 'viewport.height')
    this._contentHeight = newHeight / this.scale
    if (this.viewportElement) {
      this.viewportElement.style.height = `${newHeight}px`
      this.touch()
    }
  }

  @computed
  get width() {
    if (!this.rect) {
      return 1000
    }
    return this.rect.width
  }

  set width(newWidth: number) {
    assertLifecycleMutationAllowed(this, 'viewport.width')
    this._contentWidth = newWidth / this.scale
    if (this.viewportElement) {
      this.viewportElement.style.width = `${newWidth}px`
      this.touch()
    }
  }

  @observable.ref private accessor _scale = 1

  @computed
  get scale() {
    return this._scale
  }

  @action
  set scale(newScale: number) {
    assertLifecycleMutationAllowed(this, 'viewport.scale')
    if (Number.isNaN(newScale) || newScale <= 0) {
      throw new Error(`invalid new scale "${newScale}"`)
    }

    this._scale = newScale
    this._contentWidth = this.width / this.scale
    this._contentHeight = this.height / this.scale
  }

  @observable.ref private accessor _contentWidth: number | AutoFit = AutoFit

  @observable.ref private accessor _contentHeight: number | AutoFit = AutoFit

  @computed
  get contentHeight(): number | AutoFit {
    return this._contentHeight
  }

  set contentHeight(newContentHeight: number | AutoFit) {
    assertLifecycleMutationAllowed(this, 'viewport.contentHeight')
    this._contentHeight = newContentHeight
  }

  @computed
  get contentWidth(): number | AutoFit {
    return this._contentWidth
  }

  set contentWidth(val: number | AutoFit) {
    assertLifecycleMutationAllowed(this, 'viewport.contentWidth')
    this._contentWidth = val
  }

  @observable.ref private accessor _scrollX = 0

  @observable.ref private accessor _scrollY = 0

  get scrollX() {
    return this._scrollX
  }

  get scrollY() {
    return this._scrollY
  }

  private _scrollTarget?: ScrollTarget

  private scrollDisposer?: Disposable

  /**
   * 滚动对象
   */
  get scrollTarget() {
    return this._scrollTarget
  }

  @observable private accessor _scrolling = false

  get scrolling() {
    return this._scrolling
  }

  setScrollTarget(target: Window): Disposable {
    assertLifecycleMutationAllowed(this, 'viewport.setScrollTarget')
    this.#clearScrollTargetInternal()
    const scrollTarget = new ScrollTarget(target)

    let scrollTimer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      assertLifecycleMutationAllowed(this, 'viewport.scroll')
      this._scrollX = scrollTarget.left
      this._scrollY = scrollTarget.top
      this._scrolling = true
      if (scrollTimer !== undefined) {
        clearTimeout(scrollTimer)
      }
      scrollTimer = setTimeout(() => {
        this._scrolling = false
      }, 80)
    }
    const onResize = () => this.touch()
    const listeners = {
      resize: onResize,
      scroll: onScroll,
    }
    const pendingListenerRemovals = new Set<keyof typeof listeners>()
    let disposed = false
    const dispose = () => {
      if (disposed) {
        return
      }

      const failures: unknown[] = []
      for (const eventType of [...pendingListenerRemovals]) {
        try {
          target.removeEventListener(eventType, listeners[eventType])
          pendingListenerRemovals.delete(eventType)
        } catch (error) {
          failures.push(error)
        }
      }
      if (scrollTimer !== undefined) {
        try {
          clearTimeout(scrollTimer)
          scrollTimer = undefined
        } catch (error) {
          failures.push(error)
        }
      }

      if (pendingListenerRemovals.size === 0 && scrollTimer === undefined) {
        disposed = true
      }
      if (disposed && this.scrollDisposer === dispose) {
        this.scrollDisposer = undefined
        this._scrollTarget = undefined
        this._scrolling = false
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Viewport scroll target disposal failed')
      }
    }
    this.scrollDisposer = dispose

    try {
      target.addEventListener('scroll', onScroll)
      pendingListenerRemovals.add('scroll')
      target.addEventListener('resize', onResize)
      pendingListenerRemovals.add('resize')
    } catch (acquisitionError) {
      try {
        dispose()
      } catch (rollbackError) {
        throw new AggregateError(
          [acquisitionError, rollbackError],
          'Viewport scroll target setup failed and rollback was incomplete',
        )
      }
      throw acquisitionError
    }

    this._scrollX = scrollTarget.left
    this._scrollY = scrollTarget.top
    this._scrollTarget = scrollTarget
    return dispose
  }

  clearScrollTarget(): void {
    assertLifecycleMutationAllowed(this, 'viewport.clearScrollTarget')
    this.#clearScrollTargetInternal()
  }

  dispose(): void {
    assertPublicLifecycleTeardownAllowed(this, 'viewport.dispose')
    this.#disposeInternal()
  }

  #clearScrollTargetInternal(): void {
    this.scrollDisposer?.()
  }

  #disposeInternal(): void {
    this.#clearScrollTargetInternal()
    const view = this.viewportElement?.ownerDocument.defaultView
    if (this.boundsFrame !== undefined) {
      const cancelFrame = view?.cancelAnimationFrame?.bind(view) || globalThis.cancelAnimationFrame
      cancelFrame(this.boundsFrame)
      this.boundsFrame = undefined
    }
    this._bounds = undefined
    this.viewportElement = undefined
    sealLifecycleMutations(this, 'viewport generation is disposed')
  }

  toGlobalPoint(point: Point): Point {
    if (!this.viewportElement) {
      return point
    }

    const rect = this.bounds
    return {
      clientX: point.clientX * this.scale + rect.left,
      clientY: point.clientY * this.scale + rect.top,
    }
  }

  toLocalPoint(point: Point): Point {
    if (!this.viewportElement) {
      return point
    }

    const rect = this.bounds
    return {
      clientX: (point.clientX - rect.left) / this.scale,
      clientY: (point.clientY - rect.top) / this.scale,
    }
  }
}
